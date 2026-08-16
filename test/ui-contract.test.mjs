/* UI contract tests for public/style.css + public/app.js.
   The UI is dependency-free vanilla JS with no DOM test runtime available
   (house rule: zero deps, nothing npm-installed), so these assert the
   *source-level contracts* whose violation produced real UAT defects.
   Each test names the defect it guards and the geometry/stacking rule that
   was actually verified in a live browser when the fix landed. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Comments are stripped so a `/* … */` above a rule is not read as part of
// its selector list.
const CSS = readFileSync(join(ROOT, 'public/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const APP = readFileSync(join(ROOT, 'public/app.js'), 'utf8');

/* Minimal CSS reader: every declaration block whose selector list contains
   `selector` as a whole comma-separated part, merged in source order. */
function rulesFor(selector) {
  const out = {};
  for (const [, sels, body] of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const parts = sels.split(',').map((s) => s.trim());
    if (!parts.includes(selector)) continue;
    for (const decl of body.split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
    }
  }
  return out;
}

const px = (v) => Number.parseFloat(String(v));

test('rulesFor reads merged declarations for a selector', () => {
  // #main is declared twice in style.css; both declarations must merge.
  const main = rulesFor('#main');
  assert.equal(main.position, 'relative');
  assert.ok(main.padding, '#main should still declare padding');
  assert.deepEqual(rulesFor('#no-such-selector'), {});
});

/* ---------- defect: collapsed left nav could not be re-opened ----------
   #ws-rail is position:sticky, which ALWAYS creates a stacking context, so
   #nav-expand's z-index is scoped inside the rail. #main (position:relative,
   z-index:auto) is a later sibling, so it painted over the fixed expand
   chevron at left:60px and swallowed the click. The rail therefore needs its
   own positive z-index. Verified live: elementsFromPoint at the chevron
   returned [main, nav-expand] before, [nav-expand, main] after. */

test('#ws-rail carries a positive z-index so the expand chevron stays clickable', () => {
  const rail = rulesFor('#ws-rail');
  assert.equal(rail.position, 'sticky', 'rail is sticky — it creates a stacking context');
  assert.ok(rail['z-index'], '#ws-rail must declare a z-index or #main paints over #nav-expand');
  assert.ok(px(rail['z-index']) > 0, `#ws-rail z-index must be > 0, got ${rail['z-index']}`);
});

test('#nav-expand paints inside the rail stacking context, not above it', () => {
  const rail = px(rulesFor('#ws-rail')['z-index']);
  const expand = rulesFor('#nav-expand');
  assert.equal(expand.position, 'fixed');
  // The chevron overhangs the rail (left > rail width), so the rail — not the
  // chevron's own z-index — is what has to clear #main.
  assert.ok(px(expand.left) >= px(rulesFor('#ws-rail').width), 'chevron overhangs the rail');
  assert.ok(rail >= px(expand['z-index'] ?? 0) || rail > 0);
});

test('the first rail chip is centred on the sidebar wordmark', () => {
  // Both centrelines are measured from the viewport top, so they must agree.
  const sidebarPadTop = px(rulesFor('#sidebar').padding.split(/\s+/)[0]);
  const wordmark = px(rulesFor('.ws-wordmark')['line-height']);
  const chip = px(rulesFor('.ws-icon.ws-weave').height);
  const railPadTop = rulesFor('#ws-rail').padding.match(/calc\(([^)]*)\)/)?.[1];
  assert.ok(railPadTop, '#ws-rail top padding must be derived, not a bare constant');
  // calc(14px + 22px / 2 - 40px / 2) — the terms must be the real ones.
  const terms = railPadTop.match(/[\d.]+/g).map(Number);
  assert.deepEqual(terms, [sidebarPadTop, wordmark, 2, chip, 2],
    'rail padding must be built from the sidebar padding, wordmark and chip sizes');
  const railPad = terms[0] + wordmark / 2 - chip / 2;
  assert.equal(railPad + chip / 2, sidebarPadTop + wordmark / 2, 'centrelines must coincide');
  // The rail is a column flexbox: without flex-shrink:0 a declared chip height
  // is only a maximum, chips shrink to their content, and the calc goes stale.
  // Measured live: the 46px mark rendered at 42px until this was set.
  assert.equal(rulesFor('.ws-icon')['flex-shrink'], '0');
});

/* The trash badge is decoration on a long-lived server that serves public/
   straight from disk — a page newer than its routes must still open. */
test('an unavailable trash count cannot stop a table from rendering', () => {
  assert.match(APP, /api\('GET', `\/tables\/\$\{db\.id\}\/trash`\)\.catch\(\(\) => \(\{ total: 0 \}\)\)/);
});

test('.hidden beats id-selector display rules', () => {
  // #nav-expand sets display:flex via an id selector; only !important hides it.
  assert.match(rulesFor('.hidden').display ?? '', /none\s*!important/);
});

test('wireNavCollapse wires both directions and persists the state', () => {
  const fn = APP.slice(APP.indexOf('function wireNavCollapse'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
  assert.match(body, /collapse\.addEventListener\('click',\s*\(\)\s*=>\s*apply\(true\)\)/);
  assert.match(body, /expand\.addEventListener\('click',\s*\(\)\s*=>\s*apply\(false\)\)/);
  assert.match(body, /localStorage\.setItem\('weave-nav-collapsed'/);
  assert.match(body, /localStorage\.getItem\('weave-nav-collapsed'\)/);
});

/* ---------- defect: clicking a select/workflow cell opened the entity ----------
   The chip is a small button inside a full-width <td>; the row's click handler
   only skipped navigation when the click landed exactly on the chip, so every
   click on the surrounding cell padding routed to openEntity. Picker cells must
   be tagged and the row handler must open the picker instead of navigating. */

const PICKER_TYPES = ['select', 'multiselect', 'workflow'];

test('picker-type cells are tagged so the row handler can route clicks', () => {
  assert.match(APP, /const PICKER_FIELD_TYPES = \[([^\]]*)\]/);
  const listed = APP.match(/const PICKER_FIELD_TYPES = \[([^\]]*)\]/)[1];
  for (const t of PICKER_TYPES) assert.ok(listed.includes(`'${t}'`), `${t} must be a picker type`);
  assert.match(APP, /cell-pick/, 'picker cells need the cell-pick class');
});

test('row click on a picker cell opens the picker instead of the entity', () => {
  // Every clickable row surface (grid <tr>, list-row, board card) routes
  // through rowClickTarget before it may navigate.
  const routed = [...APP.matchAll(/const pick = rowClickTarget\(e\);\s*\n\s*if \(pick === 'ignore'\) return;\s*\n\s*if \(pick\) return openCellPicker\(pick\);\s*\n\s*openEntity\(/g)];
  assert.equal(routed.length, 3, 'grid, list and board rows must all route clicks');
  assert.equal((APP.match(/openEntity\(item\.id\)/g) ?? []).length, routed.length,
    'no row surface may call openEntity without routing first');
  assert.match(APP, /function rowClickTarget/);
  assert.match(APP, /function openCellPicker/);
  const fn = APP.slice(APP.indexOf('function openCellPicker'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
  assert.match(body, /\.chip-trigger/, 'chip pickers open by clicking their trigger');
  assert.match(body, /showPicker/, 'native <select> cells open their own dropdown');
});

test('picker cells advertise themselves as clickable', () => {
  assert.ok(rulesFor('.wv-grid td.cell-pick').cursor, 'cell-pick needs a pointer cursor');
});

/* ---------- defect: computed fields looked editable ----------
   lookup/rollup/formula/document cells render read-only text that was styled
   the same as an editable cell, so users clicked them expecting a picker. */

test('computed/read-only field types are enumerated once', () => {
  assert.match(APP, /const READONLY_FIELD_TYPES = \[([^\]]*)\]/);
  const listed = APP.match(/const READONLY_FIELD_TYPES = \[([^\]]*)\]/)[1];
  for (const t of ['lookup', 'rollup', 'formula']) {
    assert.ok(listed.includes(`'${t}'`), `${t} must be read-only`);
  }
});

test('computed cells are visually differentiated from editable cells', () => {
  const cell = rulesFor('.wv-grid td.cell-computed');
  assert.ok(Object.keys(cell).length, '.wv-grid td.cell-computed must be styled');
  assert.equal(cell.cursor, 'default', 'computed cells must not look clickable');
  assert.ok(cell.color || cell.background, 'computed cells need a muted colour or shading');
  assert.match(APP, /cell-computed/, 'the td must be tagged cell-computed');
  // A glyph marks the kind of computation inline in compact (grid) cells.
  assert.match(APP, /computedMark/);
});

/* ---------- defect: the id column ate horizontal space ---------- */

test('the # column shrinks to its content and is left-aligned', () => {
  const pid = rulesFor('.wv-grid td.pid-cell');
  assert.ok(Object.keys(pid).length, '.wv-grid td.pid-cell must be styled');
  assert.equal(pid.width, '1%', 'width:1% collapses the column to its content');
  assert.equal(pid['white-space'], 'nowrap');
  assert.equal(pid['text-align'], 'left');
  assert.equal(rulesFor('.wv-grid th.pid-head').width, '1%');
  // The id cell must no longer be a right-aligned numeric cell.
  assert.match(APP, /class: 'pid-cell'/);
  assert.doesNotMatch(APP, /el\('td', \{ class: 'num' \},\s*\n\s*el\('a', \{ class: 'open-link'/);
});

/* ---------- create affordances live inside the grid ----------
   Table view carries both "+" controls in the grid itself: fields at the end
   of the header bar, entities as the last row. Board and list have no grid to
   host them, so they keep the header buttons. */

test('table view moves both create controls into the grid', () => {
  // Header buttons are suppressed in table view only.
  const guarded = [...APP.matchAll(/state\.route\.view === 'table' \? null\s*\n\s*: el\('button'/g)];
  assert.equal(guarded.length, 2, 'both ⚙ Fields and + New are table-view guarded');
  assert.match(APP, /class: 'add-field-head'/, 'header bar ends with the field "+" cell');
  assert.match(APP, /function addFieldMenuButton/);
  assert.match(APP, /class: 'add-entity-row'/, 'the grid ends with the new-entity row');
  // The detached bar it replaced must be gone from both surfaces.
  assert.doesNotMatch(APP, /add-row-bar/);
  assert.doesNotMatch(CSS, /add-row-bar/);
});

test('the field "+" keeps relations and field management reachable', () => {
  // It replaces "⚙ Fields" in table view, so a bare add-field dialog would
  // strand relation creation and field deletion.
  const fn = APP.slice(APP.indexOf('function addFieldMenuButton'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
  for (const target of ['addFieldDialog', 'addRelationDialog', 'openSchemaEditor']) {
    assert.match(body, new RegExp(`${target}\\(db\\)`), `field menu must reach ${target}`);
  }
});

test('full-width grid rows derive their span from one column count', () => {
  // The header gained a column; a restated `cols.length + N` would silently
  // under-span the doc and new-entity rows.
  assert.match(APP, /const colCount = cols\.length \+ 3;/);
  assert.doesNotMatch(APP, /colspan: String\(cols\.length/);
  assert.equal((APP.match(/colspan: String\(colCount\)/g) ?? []).length, 2);
});

test('grid create controls are styled', () => {
  assert.equal(rulesFor('.wv-grid th.add-field-head').width, '1%', 'the "+" cell must not eat column width');
  assert.ok(rulesFor('.add-field-btn').cursor);
  assert.ok(rulesFor('.add-entity-btn').width, 'the new-entity row spans the grid');
});

/* ---------- defect: repeated create clicks stacked blank inputs ---------- */

test('only one inline create input can be open at a time', () => {
  const fn = APP.slice(APP.indexOf('function inlineNameInput'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
  assert.match(body, /querySelectorAll\('\.nav-inline-add'\)\.forEach\(\(n\) => n\.remove\(\)\)/,
    'opening a create input must clear any other one');
  assert.match(body, /addEventListener\('blur'/, 'an abandoned empty input must not linger');
  assert.match(body, /input\.disabled = true/, 'commit must lock the input against double submits');
});

test('only one modal can be open at a time', () => {
  const fn = APP.slice(APP.indexOf('function modal('));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
  assert.match(body, /querySelector\('#modal-back'\)\?\.remove\(\)/,
    'a second modal must replace the first, not stack another backdrop');
  assert.match(body, /e\.key === 'Escape'/, 'modals must close on Escape');
});

test('spaces and tables have exactly one create flow', () => {
  // The unreachable modal variants were a second, differently-styled design
  // for the same action.
  assert.doesNotMatch(APP, /function newSpaceModal/);
  assert.doesNotMatch(APP, /function newTableModal/);
  assert.match(APP, /function inlineNameInput/);
  assert.ok(rulesFor('.nav-inline-add').padding, 'the inline input must be styled as a nav row');
});

test('one popover implementation serves every anchored menu', () => {
  assert.match(APP, /function showPopover/);
  const fn = APP.slice(APP.indexOf('function showPopover'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
  assert.match(body, /querySelector\('\.chip-pop'\)\?\.remove\(\)/, 'never two popovers at once');
  assert.match(body, /Escape/);
  // Both callers go through it rather than rebuilding the popover inline.
  assert.equal((APP.match(/showPopover\(/g) ?? []).length, 3, 'definition + chipPicker + field menu');
});

/* ---------- keyboard: fill in a record without the mouse ---------- */

test('popover options are keyboard navigable', () => {
  const fn = APP.slice(APP.indexOf('function showPopover'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
  assert.match(body, /ArrowDown/);
  assert.match(body, /ArrowUp/);
  // Rows are <button>s, so Enter/Space commit natively — what has to be
  // explicit is that focus lands in the popover on open.
  assert.match(body, /\.focus\(\)/, 'opening must move focus into the popover');
  assert.match(body, /chip-pop-check/, 'focus opens on the current value when there is one');
  assert.match(body, /ev\.key === 'Tab'/, 'Tab must close and carry on along the row');
  assert.match(body, /trigger\.focus\(\)/, 'Escape must hand focus back to the trigger');
});

test('focus survives the redraw a pick causes', () => {
  // drawDatabase replaces every row, so without this a keyboard pick drops
  // focus to the document and Tab restarts from the top of the page.
  assert.match(APP, /state\.refocus/);
  assert.match(APP, /function restoreGridFocus/);
  assert.match(APP, /drawDatabase\(db, fresh\.items\);\s*\n\s*restoreGridFocus\(\);/);
  assert.match(APP, /refocus: null/, 'state must declare the slot');
});

test('the focused popover row is as visible as the hovered one', () => {
  assert.ok(rulesFor('.chip-pop-row:focus').background, 'focus must be styled, not only hover');
  assert.ok(rulesFor('.chip-pop-row:focus-visible')['box-shadow']);
});

/* ---------- destructive actions confirm in-place, not via the browser ---------- */

test('no window.confirm anywhere in the UI', () => {
  // The browser dialog cannot be styled and breaks the page's design.
  // Matches a bare `confirm(` — not `holdToConfirm(` (letter before) and not
  // `window.confirm()` inside a comment (dot before).
  assert.doesNotMatch(APP, /[^\w.]confirm\(/, 'use holdToConfirm instead of window.confirm');
});

test('hold-to-confirm fires only on a completed hold', () => {
  assert.match(APP, /function holdToConfirm/);
  const fn = APP.slice(APP.indexOf('function holdToConfirm'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
  assert.match(body, /transitionend/, 'completion is what fires it');
  assert.match(body, /if \(!armed \|\| e\.propertyName !== 'transform'\) return;/,
    'a stray transition must not delete anything');
  for (const ev of ['pointerup', 'pointerleave', 'blur']) {
    assert.ok(body.includes(`'${ev}'`), `releasing via ${ev} must cancel`);
  }
  assert.match(body, /keydown/, 'keyboard users must be able to hold too');
  // Collapsing must be untransitioned or releasing early would still fire.
  // Swept with a transform, not an animated width: width/height animations
  // thrash layout every frame, transforms composite.
  const rest = rulesFor('.hold-fill');
  assert.equal(rest.transition, 'transform 0s');
  assert.equal(rest.transform, 'scaleX(0)');
  assert.equal(rest['transform-origin'], 'left', 'the sweep must start at the left edge');
  assert.match(rulesFor('.hold-btn.holding .hold-fill').transition, /transform \.\ds linear/);
  assert.doesNotMatch(rest.transition, /width|height|padding|margin/, 'no layout-property animation');
  assert.equal(rulesFor('.hold-btn').overflow, 'hidden', 'the fill must be clipped to the button');
});

test('destructive actions use it', () => {
  // A count, not an exact number: new destructive actions adopting the helper
  // is the desired direction, so only the floor is pinned. The real guard
  // against regressing to a browser dialog is the no-window.confirm test.
  const uses = (APP.match(/holdToConfirm\(/g) ?? []).length - 1; // minus the definition
  assert.ok(uses >= 2, `expected at least two hold-to-confirm call sites, found ${uses}`);
});

test('the entity menu sits in the corner with a vertical ellipsis', () => {
  const corner = rulesFor('.entity-dl-corner');
  assert.ok(px(corner.left) <= 4, `menu should hug the left edge, got ${corner.left}`);
  assert.ok(px(corner.top) <= 8);
  assert.match(APP, /dots-btn.*'⋮'/s, 'the glyph must be the vertical ellipsis');
  assert.doesNotMatch(APP, /'⋯'/, 'no horizontal ellipsis left behind');
  assert.ok(rulesFor('.dots-btn').padding, 'the vertical glyph needs its own button metrics');
});

/* ---------- Feature #38: soft delete in the UI ----------
   Deleting is recoverable, so the entity menu must offer a plain undoable
   action rather than a hold-to-confirm, and the one irreversible control
   (purge) must live behind the hold, in the trash. */

test('the entity menu moves to trash with an undo, not a hold-to-confirm', () => {
  assert.match(APP, /'Move to trash'/);
  assert.doesNotMatch(APP, /holdToConfirm\('Delete entity'/,
    'a recoverable delete must not demand a hold');
  assert.match(APP, /label: 'Undo'[\s\S]{0,200}\/restore/, 'the toast must offer restore');
  assert.match(APP, /function toast\(msg, isErr = false, action = null\)/);
  assert.ok(rulesFor('.toast-action').cursor, '.toast-action must be styled as a control');
});

test('purging keeps the hold-to-confirm and is the only hard delete in the UI', () => {
  assert.match(APP, /holdToConfirm\('Delete forever'/);
  const hard = [...APP.matchAll(/\?hard=1/g)];
  assert.equal(hard.length, 1, 'exactly one call site may purge');
  assert.match(APP, /function showTrash/);
  assert.match(APP, /#\\?\/trash\\?\/\(\[\^\/\?\]\+\)/, 'trash needs a route');
});

test('the trash entry point appears only when there is something in it', () => {
  const draw = APP.slice(APP.indexOf('function drawDatabase'));
  assert.match(draw.slice(0, draw.indexOf('function renderTable')),
    /trashCount\s*\n?\s*\?\s*el\('a'.*?#\/trash\//s,
    'the 🗑 control must be conditional on trashCount');
  assert.match(APP, /api\('GET', `\/tables\/\$\{db\.id\}\/trash`\)/);
});

/* ---------- defect: the description block was oversized ---------- */

test('the description block is compact', () => {
  const desc = rulesFor('.view-desc');
  const edit = rulesFor('.view-desc-edit');
  assert.ok(px(desc['margin-top']) <= 3, `view-desc margin-top too large: ${desc['margin-top']}`);
  assert.ok(px(desc['font-size']) <= 12.5, `view-desc font-size too large: ${desc['font-size']}`);
  assert.ok(px(edit['min-height']) <= 40, `editor min-height too large: ${edit['min-height']}`);
  assert.ok(px(edit.padding) <= 4, `editor padding too large: ${edit.padding}`);
  // The autosize floor in app.js must match the CSS min-height.
  const floor = Number(APP.match(/Math\.max\((\d+), ta\.scrollHeight\)/)?.[1]);
  assert.equal(floor, px(edit['min-height']), 'autosize floor must match CSS min-height');
});

/* ---------- defect: edits did not appear without a hard reload ---------- */

test('static UI assets are served revalidating', async () => {
  // No Cache-Control meant heuristic caching served a stale app.js/style.css
  // after every edit — the UI looked unchanged until a manual hard reload.
  const { Weave } = await import('../src/engine.js');
  const { startServer } = await import('../src/server.js');
  const { server, port } = await startServer(new Weave(), { port: 0 });
  try {
    for (const asset of ['/app.js', '/style.css', '/index.html']) {
      const res = await fetch(`http://127.0.0.1:${port}${asset}`);
      assert.equal(res.status, 200, asset);
      assert.equal(res.headers.get('cache-control'), 'no-cache', `${asset} must revalidate`);
    }
  } finally {
    server.close();
  }
});

/* ---------- overflow menus on tables and spaces (Kyle, 2026-08-16) ----------
   Export and delete are occasional, and one of them is irreversible, so they
   belong in an overflow menu rather than the header toolbar. */

test('one dotsMenu implementation serves entity, table and space', () => {
  assert.match(APP, /function dotsMenu\(/);
  // Every ⋮ trigger comes from the helper — no hand-rolled second menu.
  assert.equal((APP.match(/dots-btn/g) ?? []).length, 1, 'only dotsMenu may build the ⋮ button');
  assert.equal((APP.match(/class: `dl-menu hidden/g) ?? []).length, 1, 'only dotsMenu may build the panel');
  for (const t of ["title: 'Entity actions'", "title: 'Table actions'", "title: 'Space actions'"]) {
    assert.ok(APP.includes(t), `${t} must be a dotsMenu call`);
  }
});

test('table and space menus carry CSV export and delete', () => {
  assert.ok(APP.includes("label: 'Export CSV'"), 'the table menu exports CSV');
  // A space has no CSV of its own, so it offers one export per table it holds.
  assert.match(APP, /space\.tables\.map\(\(d\) => \(\{[\s\S]{0,40}label: `Export \$\{d\.name\}\.csv`/);
  assert.match(APP, /api\('DELETE', `\/tables\/\$\{db\.id\}`\)/);
  assert.match(APP, /api\('DELETE', `\/spaces\/\$\{spaceId\}`\)/);
  // The toolbar CSV button moved into the menu — it must not remain in both.
  assert.doesNotMatch(APP, /class: 'btn btn-sm', href: `\$\{WS_PREFIX\}\/api\/tables\/\$\{db\.id\}\/export\.csv`/);
});

test('deleting a table or a space is behind a hold', () => {
  assert.ok(APP.includes("hold: 'Delete table'"));
  assert.match(APP, /hold: space\.tables\.length/, 'the space menu names how many tables go with it');
});

test('header menus hang off the right edge and fill their rows', () => {
  assert.match(APP, /align: 'right'/);
  const right = rulesFor('.dl-menu-right');
  assert.equal(right.left, 'auto');
  assert.equal(right.right, '0');
  assert.equal(rulesFor('.dl-menu .hold-btn').width, '100%',
    'a hold item must fill the menu row like any other item');
});

test('only one overflow menu is open at a time', () => {
  const fn = APP.slice(APP.indexOf('function dotsMenu'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
  assert.match(body, /querySelectorAll\('\.dl-menu'\)/, 'opening one must close the others');
  assert.match(body, /addEventListener\('click', function away/, 'clicking away must close it');
});

/* ---------- entity side column (Kyle, 2026-08-16) ---------- */

test('comments and activity sit under fields in the side column', () => {
  assert.match(APP, /right\.append\(fieldsPanel, commentsPanel, actPanel\)/,
    'the side column reads Fields → Comments → Activity');
  assert.doesNotMatch(APP, /left\.append\(commentsPanel\)/, 'comments must leave the main column');
  assert.doesNotMatch(APP, /left\.append\(actPanel\)/, 'activity must leave the main column');
});
