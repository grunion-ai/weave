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
  // through rowClickTarget before it may open the side peek (Feature #39).
  const routed = [...APP.matchAll(/const pick = rowClickTarget\(e\);\s*\n\s*if \(pick === 'ignore'\) return;\s*\n\s*if \(pick\) return openCellPicker\(pick\);\s*\n\s*peekEntity\(/g)];
  assert.equal(routed.length, 4, 'grid, list, board and embedded related rows must all route clicks');
  assert.equal((APP.match(/peekEntity\(item\.id\)/g) ?? []).length, routed.length,
    'no row surface may open the peek without routing first');
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
  assert.match(APP, /const colCount = cols\.length \+ 3;/, 'the table view derives it once');
  assert.match(APP, /const colCount = cols\.length \+ 2;/, 'so does the embedded related grid, from its own columns');
  assert.doesNotMatch(APP, /colspan: String\(cols\.length/, 'never restated at a use site');
  assert.equal((APP.match(/colspan: String\(colCount\)/g) ?? []).length, 3,
    'doc row and new-entity row in the table view, plus the related grid\'s add row');
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
  // Every caller goes through it rather than rebuilding the popover inline.
  // Counted as "more than one caller" rather than an exact number — a new menu
  // is fine, a second popover implementation is not.
  assert.ok((APP.match(/showPopover\(/g) ?? []).length >= 3, 'definition + at least two callers');
  assert.equal((APP.match(/class: 'chip-pop'/g) ?? []).length, 1,
    'only showPopover may build a .chip-pop — no second implementation');
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

/* Placement is asserted by "the entity ⋮ sits at the right end of the title
   row" at the foot of this file — the corner geometry this test used to pin
   was the defect. What survives is the glyph contract. */
test('the overflow menu is a vertical ellipsis', () => {
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

/* ---------- space disclosure caret (Kyle, 2026-08-16) ----------
   UAT round 1: "space carrots are still too small and the wrong design". The
   fold control was a 12px `▾` text glyph in an 18px box. Two separate faults:
   a sub-24px hit target, and a text glyph whose weight and baseline cannot
   match the rest of the chrome. Replaced with a stroked SVG chevron in a 24px
   target.

   UAT round 2 (reference image, "Routines ›"): the caret TRAILS the label and
   points right, drawn thin. Round 1 had moved it to lead the label; the
   reference overrides that. The two rounds agree on everything else, so the
   24px target survives — the reference reads light because of stroke weight
   and color, not because the target shrank. Resting state points right; the
   expanded state rotates it down, so the glyph itself never changes. */

test('the space caret is a real hit target, not a 18px sliver', () => {
  const caret = rulesFor('.nav-caret');
  assert.ok(px(caret.width) >= 24 && px(caret.height) >= 24,
    `caret must be at least 24x24, got ${caret.width} x ${caret.height}`);
  assert.equal(caret.flex ?? caret['flex-shrink'], '0',
    'the caret must not shrink when a space name is long');
});

test('the space caret is a drawn chevron, not a text glyph', () => {
  const fn = APP.slice(APP.indexOf('function renderNav'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
  assert.doesNotMatch(body, /'▾'|"▾"|'▸'|'▼'/, 'no text-glyph caret — it cannot match the chrome');
  assert.match(body, /chevron\(/, 'the caret renders the shared chevron() svg');
  const at = APP.indexOf('chevron = (');
  assert.ok(at > 0, 'chevron() must be defined in app.js');
  const decl = APP.slice(at, at + 400);
  assert.match(decl, /'stroke-linecap': 'round'/,
    'stroked chevron, round caps — Tabler house style');
  const icon = rulesFor('.nav-caret svg');
  assert.ok(px(icon.width) >= 14, `chevron glyph must be >= 14px, got ${icon.width}`);

  // The reference chevron is a hairline, not the 2px chrome stroke.
  const weight = Number(decl.match(/'stroke-width': '([\d.]+)'/)?.[1]);
  assert.ok(weight > 0 && weight <= 1.5, `chevron stroke must be <= 1.5, got ${weight}`);
  // It points right at rest; rotation — not a second path — supplies "open".
  assert.match(decl, /d: 'M9 6l6 6l-6 6'/, 'the resting chevron points right');
});

test('the caret trails the space label and rotates to open', () => {
  const fn = APP.slice(APP.indexOf('function renderNav'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
  const row = body.indexOf("class: 'nav-space-row'");
  assert.ok(body.indexOf('nav-caret', row) > body.indexOf("class: 'nav-space'", row),
    'the caret is appended after the space link — it trails the label ("Routines ›")');

  // Resting = right (no transform). Open = down. If the folded state carried
  // the rotation instead, a collapsed nav would show a row of down-chevrons.
  const caret = rulesFor('.nav-caret');
  assert.ok(!caret.transform || caret.transform === 'none',
    `the resting caret must not be rotated, got ${caret.transform}`);
  assert.match(rulesFor('.nav-caret.open').transform, /rotate\(90deg\)/,
    'the expanded caret rotates the right-pointing glyph down');
});

/* ---------- rail load shift (Kyle, 2026-08-16) ----------
   UAT: "sometimes the page loads with too much padding on the leftmost
   workspace nav". #ws-list is filled by an async fetch. While empty it is
   still a flex item of #ws-rail (gap: 8px), so it eats a gap on BOTH sides —
   16px of dead space under the brand mark instead of 8px — and the "+" chip
   jumps 76px down when the fetch lands. Measured live: #ws-new top 64 while
   empty, 140 once populated. :empty removes the item and the phantom gap. */

test('an unfilled #ws-list does not eat a rail gap', () => {
  assert.ok(px(rulesFor('#ws-rail').gap) > 0, 'the rail spaces its chips with gap');
  assert.equal(rulesFor('#ws-list:empty').display, 'none',
    '#ws-list must leave the flex flow until the workspace fetch lands');
});

/* ---------- number spinner chip (Kyle, 2026-08-16) ----------
   UAT: focusing a number cell painted Chrome's rounded up/down stepper chip
   inside the field. It is UA chrome, not Tabler chrome — it ignores the
   --tblr-* tokens, floats over the cell's right padding, and duplicates
   typing + arrow keys, which already work. Suppressed in both engines:
   ::-webkit-*-spin-button for Chrome/Safari, appearance:textfield for
   Firefox (and as the standards-track spelling). */

test('number inputs show no native spinner chip', () => {
  const inner = rulesFor('input[type=number]::-webkit-inner-spin-button');
  const outer = rulesFor('input[type=number]::-webkit-outer-spin-button');
  assert.equal(inner['-webkit-appearance'], 'none', 'Chrome/Safari inner stepper must be removed');
  assert.equal(outer['-webkit-appearance'], 'none', 'Chrome/Safari outer stepper must be removed');
  assert.equal(inner.margin, '0', 'a zeroed stepper must not keep reserving margin');

  const num = rulesFor('input[type=number]');
  assert.equal(num.appearance, 'textfield', 'standards-track spelling drops the spinner');
  assert.equal(num['-moz-appearance'], 'textfield', 'Firefox needs the prefixed spelling');
});

/* ---------- the inert column header (Feature #41, Option A) ----------
   The 2026-08-16 design review scored the field surfaces against seven
   faults. Two were fatal: F1, there was no edit path at all — changing a
   select's options meant delete + recreate, which drops that column's data —
   and F6, the header did nothing but sort. Option A makes the header the
   control surface: the label still sorts, a ⋮ opens one popover that renames,
   edits options/states, moves and deletes, and the header is a drag handle.
   Reorder is a schema write (fieldOrder on the table), not page state, so a
   dragged column is still there after a reload. */

/* The body of a top-level `function name(` declaration, to its closing brace
   at column 0. Same trick the nav tests use, factored out. */
function fnBody(name) {
  const at = APP.indexOf(`function ${name}(`);
  assert.ok(at > 0, `${name}() must exist in app.js`);
  const rest = APP.slice(at);
  return rest.slice(0, rest.indexOf('\n}\n') + 2);
}

test('every column header carries a field menu', () => {
  const head = fnBody('renderTable');
  assert.match(head, /fieldMenuButton\(/, 'each column th mounts the field menu');
  assert.match(head, /sortKey = c/, 'the label still sorts — the menu is additive, not a replacement');
  const menu = fnBody('fieldMenuButton');
  assert.match(menu, /showPopover\(/, 'the menu reuses the chip popover, not a new overlay');
  assert.match(menu, /stopPropagation/, 'opening the menu must not also sort the column');
});

test('the field menu edits a field rather than dropping and rebuilding it', () => {
  const dlg = fnBody('editFieldDialog');
  assert.match(dlg, /'PATCH'/, 'F1: editing a field is a PATCH to /fields/:id');
  assert.doesNotMatch(dlg, /'DELETE'/, 'never delete-and-recreate — that drops the column data');
  assert.match(dlg, /options|states|expression/, 'the editor reaches the type config, not just the name');
});

test('deleting a field from the header is guarded and never offered for Name', () => {
  const menu = fnBody('fieldMenuButton');
  assert.match(menu, /holdToConfirm\(/, 'destructive rows are hold-to-confirm, like the schema page');
  assert.match(menu, /'Name'/, 'the Name field must not offer a delete row');
});

test('column reorder is persisted as fieldOrder, not page state', () => {
  const move = fnBody('reorderField');
  assert.match(move, /fieldOrder/, 'reorder writes the schema…');
  assert.match(move, /'PATCH'/, '…through PATCH /tables/:id');
  assert.match(move, /loadSchema\(\)/, 'and reloads the schema so every view sees the new order');
  // Drag-and-drop is the reorder control, and it is verified against the same
  // schema write. The menu's move rows were a second way to do the one thing
  // the header already does directly, so they are gone.
  const menu = fnBody('fieldMenuButton');
  assert.doesNotMatch(menu, /Move left|Move right/, 'no duplicate reorder path in the field menu');
  assert.doesNotMatch(menu, /reorderField\(/, 'and no wiring left behind for one');
});

test('a column header is a drag handle for reorder', () => {
  const head = fnBody('renderTable');
  assert.match(head, /draggable: 'true'/, 'the th must be draggable');
  for (const ev of ['dragstart', 'dragover', 'drop']) {
    assert.match(head, new RegExp(ev), `the th must handle ${ev}`);
  }
  assert.match(head, /reorderField\(/, 'a drop commits through the same schema write as the menu');
  const drop = rulesFor('.wv-grid th.drop-target');
  assert.ok(drop['box-shadow'] || drop['border-left'] || drop.outline,
    'the drop target needs a visible insertion cue');
});

test('the field menu affordance does not squeeze the column label', () => {
  const head = rulesFor('.wv-grid th.col-head');
  assert.equal(head.position, 'relative', 'the ⋮ is positioned against its own header cell');
  const btn = rulesFor('.field-menu');
  assert.equal(btn.position, 'absolute', 'the ⋮ floats — it must not take label width');
  assert.equal(btn.opacity, '0', 'quiet until the header is hovered or focused');
  const shown = rulesFor('.wv-grid th.col-head:hover .field-menu');
  assert.equal(shown.opacity, '1', 'hover reveals it');
  const focused = rulesFor('.field-menu:focus-visible');
  assert.equal(focused.opacity, '1', 'keyboard focus reveals it too — it is a real control');
});

/* UAT (live, 2026-08-16): the edit dialog's submit button read "Create" — the
   modal() default — on a form that renames an existing field. modal() already
   takes a submit label; the editor has to pass one. */
test('the field editor commits with a save label, not Create', () => {
  const dlg = fnBody('editFieldDialog');
  assert.match(dlg, /\}, '(Save|Save changes)'\)/, 'editFieldDialog must pass modal() a save label');
});

/* Live check (2026-08-16): the ⋮ paints at its column's right edge, which is
   millimetres from the NEXT column's label — with no other cue it reads as
   belonging to the wrong column. The hovered header is tinted so the pair
   reads as one object. */
test('a hovered header is tinted so the menu has a visible owner', () => {
  const hover = rulesFor('.wv-grid th.col-head:hover');
  assert.ok(hover.background, 'the hovered header must change background');
  assert.notEqual(hover.background, rulesFor('.wv-grid thead th').background,
    'the hover tint has to differ from the resting header');
});

/* ---------- column widths (Feature #42) ----------
   Every column shared one 260px cap, so a title column ellipsised while a
   status column wasted half its width. Widths are per-field schema (see
   engine: config.width), which means a drag has to end in a PATCH, not in
   page state — and the client's floor has to be the engine's floor, or the
   drag writes a width the server rejects. */

test('a stored column width reaches both the header and its cells', () => {
  const head = fnBody('renderTable');
  assert.match(head, /f\.width/, 'the header applies the field width');
  assert.match(head, /max-width:\$\{f\.width\}px|max-width: \$\{f\.width\}px/,
    'cells need a matching max-width or the 260px cap still ellipsises them');
});

test('a resize grip commits once, on release', () => {
  const grip = fnBody('columnResizeGrip');
  assert.match(grip, /pointerdown/, 'the grip drags');
  assert.match(grip, /pointermove/, 'and tracks the pointer');
  assert.match(grip, /setColumnWidth\(/, 'and commits through one writer');
  const commits = [...grip.matchAll(/setColumnWidth\(/g)];
  assert.equal(commits.length, 2, 'exactly two commits: release and auto-fit — never per move');
  assert.match(grip, /dblclick/, 'double-click auto-fits');
  assert.match(grip, /stopPropagation/, 'grabbing the grip must not sort the column');
});

test('auto-fit clears the width rather than writing a measured number', () => {
  const grip = fnBody('columnResizeGrip');
  assert.match(grip, /setColumnWidth\(db, f, null\)/,
    'auto-fit hands the column back to the browser — null, not a pixel guess');
  const writer = fnBody('setColumnWidth');
  assert.match(writer, /'PATCH'/, 'width is a schema write');
  assert.match(writer, /config: \{ width/, 'through the field config');
});

test('the client width floor is the engine width floor', () => {
  const engine = readFileSync(join(ROOT, 'src/engine.js'), 'utf8');
  const server = Number(engine.match(/MIN_COLUMN_WIDTH = (\d+)/)?.[1]);
  const client = Number(APP.match(/MIN_COLUMN_WIDTH = (\d+)/)?.[1]);
  assert.ok(server > 0, 'engine must name its minimum');
  assert.equal(client, server, 'a drag must never write a width the engine refuses');
});

test('the resize grip is a visible edge, not an invisible strip', () => {
  const grip = rulesFor('.col-resize');
  assert.equal(grip.position, 'absolute', 'the grip rides its header edge');
  assert.equal(grip.cursor, 'col-resize', 'the cursor is the whole affordance');
  assert.ok(px(grip.width) >= 5, `the grip needs a grabbable width, got ${grip.width}`);
  const hot = rulesFor('.wv-grid th.col-head:hover .col-resize');
  assert.ok(hot.background, 'hovering a header shows where the edge is');
});

/* ---------- state chips fit their text (Feature #43) ----------
   Workflow and select cells used to be native <select>s held at a 110px
   minimum, so "Low" and "In Progress" occupied the same slab. The chip picker
   (Issue #9) replaced them with buttons that size to their label — measured
   live on Development/Issue: Low 44px, Fixed 52px, Medium 70px. The rule that
   has to hold is that nothing reintroduces a fixed width, and the <select>
   era's styling does not linger as dead weight. */

test('a chip is sized by its label, never by a fixed width', () => {
  const chip = rulesFor('.chip');
  assert.equal(chip.display, 'inline-block', 'inline-block shrink-wraps the label');
  assert.ok(chip.padding, 'the chip is padding around text, not a box of a set size');
  for (const prop of ['width', 'min-width']) {
    assert.equal(chip[prop], undefined, `.chip must not declare ${prop}`);
  }
});

test('the <select> era leaves nothing behind', () => {
  assert.doesNotMatch(APP, /state-select/, 'no code path renders a state <select> any more');
  assert.doesNotMatch(CSS, /state-select/, 'and its stylesheet block is gone with it');
});

/* ---------- defect: a shadow floated under every chromeless cell ----------
   Tabler's .form-control carries `box-shadow: var(--tblr-shadow-input)`
   (0 1px 1px rgba(31,41,55,.06)). .inline-edit drops the border and the
   background to make a cell read as text, but the shadow survived — so each
   idle cell showed a 1px smudge under its text with nothing casting it.
   Measured live on Development/Feature before the fix: computed border
   rgba(0,0,0,0), background rgba(0,0,0,0), box-shadow rgba(31,41,55,.06)
   0 1px 1px. The reset is scoped to :not(:focus) so Tabler's focus ring —
   which rides the same property — still lands on the focused cell. */

test('an idle inline-edit cell casts no shadow', () => {
  const idle = rulesFor('.inline-edit:not(:focus)');
  assert.equal(idle['box-shadow'], 'none',
    '.inline-edit:not(:focus) must zero Tabler\'s --tblr-shadow-input');
  assert.equal(rulesFor('.inline-edit')['box-shadow'], undefined,
    'the reset must not be unscoped — that would kill the focus ring too');
});

/* ---------- defect: the entity ⋮ sat in a different place from every other
   view's ⋮ ----------
   Every view built by viewHeader() puts its overflow menu at the right end of
   the title row, after the action buttons. The entity page hand-rolled its
   header instead and pinned the same control to the upper-LEFT corner of
   #main, above the breadcrumb — which is also why the crumb needed a 26px
   left margin to clear it. Measured live on Development/Issue at :4400
   before the fix (offsets from #main's box, 1280px viewport):

   | view   | ⋮ left | gap to right edge | ⋮ top | on the title row? |
   |--------|--------|-------------------|-------|-------------------|
   | table  | 1178   | 32                | 47    | yes (title top 42)|
   | entity | 2      | 1208              | 6     | no (title top 52) |

   1176px apart. The fix makes the entity head a .wv-toolbar row that ends in
   the menu, exactly like .view-title-row. */

test('the entity ⋮ sits at the right end of the title row, like every other view', () => {
  assert.doesNotMatch(APP, /entity-dl-corner/, 'no absolutely-positioned corner menu remains');
  assert.doesNotMatch(CSS, /entity-dl-corner/, 'and its stylesheet block is gone with it');
  assert.doesNotMatch(APP, /crumb-offset/, 'the crumb no longer indents around a corner control');
  assert.doesNotMatch(CSS, /crumb-offset/);

  // The head is a toolbar row (same flex container as .view-title-row) and
  // the menu is its last child, inside the same .view-header block every
  // other view wraps its crumb + title row in.
  assert.match(APP, /class: 'wv-toolbar entity-head' \}, nameInput, dlBtn\)/,
    'the entity ⋮ must be the trailing element of the entity head row');
  assert.match(APP, /class: 'view-header' \},\s*\n\s*el\('div', \{ class: 'crumb' \}/,
    'the entity crumb + title row live in a .view-header, so crumb spacing matches');
  assert.equal(rulesFor('.entity-head')['margin-bottom'], '0',
    '.view-header owns the gap below the header, exactly as on .view-title-row');

  const head = rulesFor('.entity-head');
  const bar = rulesFor('.wv-toolbar');
  assert.equal(head['align-items'], bar['align-items'],
    '.entity-head must align its row the same way .wv-toolbar does');
  assert.equal(rulesFor('.entity-head .dl-wrap')['margin-left'], 'auto',
    'margin-left:auto is what pushes the menu to the right edge');

  // Right edge means the panel must hang off the right, or it runs off-screen.
  const call = APP.match(/\{ title: 'Entity actions'[^}]*\}/);
  assert.ok(call, 'the entity menu call site should be findable');
  assert.match(call[0], /align: 'right'/, 'a right-edge menu must drop its panel to the left');
});

/* ---------- defect: the document editor showed its own scaffolding ----------
   Vditor's IR mode labels every heading with its level in the left gutter
   (`.vditor-ir .vditor-reset > h2:before { content: 'H2' }`, floated into a
   -29px margin), and weave printed the field name above each document as a
   section head. Both are chrome about the document rather than the document.
   The heading badges go entirely; the section head — which also carries the
   collapse caret, the permalink and the downloads — stays in the layout but
   only paints when the section is hovered or holds focus. */

test('heading levels are not labelled in the document gutter', () => {
  for (const h of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    assert.equal(rulesFor(`.doc-editor .vditor-ir .vditor-reset > ${h}::before`).content, 'none',
      `the ${h.toUpperCase()} gutter badge must be removed, not merely recoloured`);
  }
});

test('the document section head is quiet until it is reached for', () => {
  const head = rulesFor('.doc-section-head');
  assert.equal(head.opacity, '0', 'at rest the head shows nothing above the document');
  assert.ok(head.transition, 'it fades rather than snapping');
  // Still in the layout: hiding it with display:none would shift the document
  // up on hover, and take the caret / permalink / downloads with it.
  assert.notEqual(head.display, 'none', 'the head keeps its space in the flow');
  assert.equal(rulesFor('.doc-section:hover .doc-section-head').opacity, '1');
  assert.equal(rulesFor('.doc-section:focus-within .doc-section-head').opacity, '1');
});

/* ---------- defect: a code block under the caret rendered as a smear ----------
   Expanding an IR node sets EVERY marker to `display: inline`
   (`.vditor-ir__node--expand .vditor-ir__marker`), and the editable source of
   a code block is a <pre> carrying that class. An inline <pre> with a slab
   background paints outside its line box: measured live at 1200px, the source
   pre sat at y=154 h=55 inside a node starting at y=167, so its dark slab
   smeared up over the language tag. The rendered preview stayed visible below
   it, so the same code showed twice. Editing shows the source alone. */

test('an expanded code block is one block, not a smear over a duplicate', () => {
  assert.equal(rulesFor('.doc-editor .vditor-ir__node--expand pre.vditor-ir__marker--pre').display, 'block',
    'the editable source must be a block box, or its slab paints out of line');
  assert.equal(rulesFor('.doc-editor .vditor-ir__node--expand[data-type="code-block"] .vditor-ir__preview').display, 'none',
    'the rendered copy steps aside while its source is being edited');
});

test('every code block carries a copy button in its upper right', () => {
  // Vditor ships the button hidden (`.vditor-copy { display: none }`) and
  // reveals it on `pre:hover` only — invisible to touch and to anyone who has
  // not already found it.
  assert.equal(rulesFor('.doc-editor .vditor-copy').display, 'block',
    'the copy button is always present, not hover-only');
  const btn = rulesFor('.doc-editor .vditor-copy span');
  assert.ok(btn.top !== undefined && btn.right !== undefined,
    'pinned to the upper right of the block');
  assert.equal(btn.left, undefined, 'never anchored from the left');
});

/* ---------- a computed field is not editable, and its NAME should say so ----
   computedMark() marked the values (ƒ formula, Σ rollup, ↗ lookup) but not the
   column they sit in, so the first thing a writer learned about a formula
   field was that clicking its cell did nothing. The same glyph now rides the
   field name as a superscript, everywhere a field name is printed. */

test('a computed field carries its glyph next to the name, not only in cells', () => {
  const label = fnBody('fieldNameLabel');
  assert.match(label, /computedMark\(/, 'one glyph vocabulary for names and values');
  assert.match(label, /'sup'/, 'the mark is a superscript on the name');
  assert.match(APP, /COMPUTED_NAME_MARKS = \{[^}]*formula/,
    'formula fields are the case this exists for');

  // Every surface that prints a field name uses it — a column marked in the
  // grid but bare on the entity page is worse than not marking it at all.
  for (const fn of ['renderTable', 'renderBoard', 'renderEntityView', 'openSchemaEditor']) {
    assert.match(fnBody(fn), /fieldNameLabel\(/, `${fn}() must label field names through the helper`);
  }
  const mark = rulesFor('.field-mark');
  assert.ok(mark['font-size'], 'the mark is smaller than the name it annotates');
  assert.ok(mark.color, 'and quieter than it');
});

/* ---------- Activity is a table, not a log ----------
   The entity pane printed up to 20 lines of history into a card, and that was
   the only place any of it could be seen: no way to read the workspace's
   activity as a whole, and no way to link to a single event. Activity is now
   a system table — weave's own rows, fixed shape, nothing anyone can type —
   and the pane is that table filtered to one entity, ten rows deep. */

test('the entity activity pane shows ten rows, each linking into the Activity table', () => {
  const body = fnBody('renderEntityView'); // the one entity rendering — page and peek both mount it
  assert.match(APP, /const ACTIVITY_PANE_ROWS = 10;/, 'the pane is capped at ten');
  assert.match(body, /slice\(0, ACTIVITY_PANE_ROWS\)/, 'and takes the ten most recent');
  assert.match(body, /href: `#\/activity\/\$\{id\}:\$\{firstIndex - n\}`/,
    'each row addresses its own event in the Activity table');
  assert.match(body, /href: `#\/activity\/\$\{id\}`/, 'and the pane header opens the filtered table');
  assert.match(body, /activitySummary\(a\)/, 'one summary function serves the pane and the table');
});

test('the Activity table is routed, read-only and reachable from the workspace page', () => {
  assert.match(fnBody('renderRoute'), /#\\\/activity|#\/activity/, 'the router knows #/activity');
  assert.match(APP, /hash\.match\(\/\^#\\\/activity/, 'with an optional entity/event parameter');
  const view = fnBody('showActivity');
  assert.match(view, /api\('GET', `\/activity/, 'the view reads the feed endpoint');
  assert.doesNotMatch(view, /'POST'|'PATCH'|'DELETE'/, 'nothing in this table can be written from the UI');
  assert.match(view, /system table/i, 'and it says so on the page');
  assert.match(fnBody('showHome'), /#\/activity/, 'the workspace page links to it');
  assert.match(fnBody('showHome'), /system/, 'marked as weave\'s table rather than the user\'s');
});

/* ---------- an event is a row with its own page ----------
   Clicking an activity row used to peek the record it references — but an
   event can reference several things (a relation change names two entities)
   and the record may since be deleted. The event itself is the entity here:
   its `entityId:index` id is a real address, so the row opens the event's own
   detail page and the record becomes a link out from there. */

test('an activity row opens the event itself, not the record it references', () => {
  const view = fnBody('showActivity');
  assert.match(view, /#\/activity\/\$\{a\.id\}/, 'a row navigates to the event\'s own page');
  assert.doesNotMatch(view, /peekEntity/, 'the table never short-circuits to the record');
  assert.match(view, /showActivityDetail/, 'the `entityId:index` route lands on the detail page');
});

test('the event detail page reads one event and links out to its record', () => {
  const view = fnBody('showActivityDetail');
  assert.match(view, /api\('GET', `\/activity\/\$\{encodeURIComponent\(/, 'it reads the single-event endpoint');
  assert.doesNotMatch(view, /'POST'|'PATCH'|'DELETE'/, 'and writes nothing');
  assert.match(view, /peekEntity\(a\.entityId\)/, 'the referenced record is a link out');
  assert.match(view, /#\/activity\/\$\{a\.entityId\}/, 'as is the record\'s own filtered feed');
  assert.match(view, /a\.actor/, 'the page says who did it');
  assert.match(view, /activitySummary\(a\)/, 'and reuses the one summary function');
});

test('a document event reads as what changed, not that something changed', () => {
  const sum = fnBody('activitySummary');
  for (const part of ['delta', 'line', 'preview']) {
    assert.match(sum, new RegExp(`d\\.${part}`), `the summary uses the enriched ${part}`);
  }
});

/* ---------- a field definition can name what a new row starts with ----------
   The engine takes `config.default` on the defaultable types and rejects it on
   the rest, so the dialogs must offer the input for exactly those types, and
   an emptied input must CLEAR the default rather than leave it in place. */

test('the field dialogs offer a default value for the types that can hold one', () => {
  assert.match(APP, /const DEFAULTABLE_FIELD_TYPES = \[([^\]]*)\]/, 'the client knows which types default');
  const listed = APP.match(/const DEFAULTABLE_FIELD_TYPES = \[([^\]]*)\]/)[1];
  for (const t of ['text', 'number', 'date', 'checkbox', 'url', 'email', 'select', 'multiselect']) {
    assert.ok(listed.includes(`'${t}'`), `${t} takes a default`);
  }
  for (const t of ['workflow', 'document', 'formula', 'rollup', 'lookup', 'relation']) {
    assert.ok(!listed.includes(`'${t}'`), `${t} must not offer one — the engine refuses it`);
  }
  for (const fn of ['addFieldDialog', 'editFieldDialog']) {
    assert.match(fnBody(fn), /defaultValueInput\(/, `${fn}() shows the input`);
    assert.match(fnBody(fn), /defaultValueFromForm\(/, `${fn}() reads it back`);
  }
  const read = fnBody('defaultValueFromForm');
  assert.match(read, /return null/, 'an emptied input clears the default');
  assert.match(read, /checkbox/, 'a checkbox default is a boolean, not the string "true"');
  assert.match(read, /Number\(/, 'a number default is a number');
});

/* ---------- related records are the table they live in (Feature #94) --------
   Kyle: "show the table of related tasks as a sub table visible within the
   project entity where the table is in the main body, the same structure as
   our main table field rules etc, so you can interact with these related
   referenced entities." A collection relation was a row of chips in the side
   panel; it is now the target table's grid in the body, built from the same
   parts as the table view. */

test('a collection relation renders as the target table grid, in the body', () => {
  const grid = fnBody('relatedGrid');
  assert.match(grid, /editorFor\(/, 'cells are the same editors the table view uses');
  assert.match(grid, /PICKER_FIELD_TYPES\.includes/, 'and carry the same picker/computed cell classes');
  assert.match(grid, /rowClickTarget\(e\)/, 'so a click on a picker opens the picker, not the entity');
  assert.match(grid, /peekEntity\(item\.id\)/, 'and a click elsewhere peeks the row (Feature #39)');
  assert.match(grid, /\['id', 'in', linked\.map/, 'the rows are fetched whole, by id');
  assert.match(grid, /c\.name !== f\.inverseField/, 'the column pointing back at this record is dropped');

  const body = fnBody('renderEntityView'); // the one entity rendering — page and peek both mount it
  assert.match(body, /relatedGrid\(entity, f, refresh\)/, 'the entity page mounts one per collection relation');
  assert.match(body, /x\.type === 'relation' && x\.many/, 'collections only — a single link stays a chip');
  assert.match(body, /left\.append\(slot\)/, 'they live in the main body, under the documents');
  assert.match(body, /if \(f\.type === 'relation' && f\.many\) continue;/,
    'and are not repeated as chips in the Fields panel');
});

test('an embedded grid can add a record and link it in one step', () => {
  const grid = fnBody('relatedGrid');
  assert.match(grid, /api\('POST', `\/tables\/\$\{target\.id\}\/entities`/, 'new rows are created in the target table');
  assert.match(grid, /link\(\[made\.id\]\)/, 'and linked immediately — that is why they were added here');
  assert.match(grid, /'\/entities\/\$\{entity\.id\}\/unlink'|unlink/, 'a row can be unlinked without opening it');
  assert.ok(rulesFor('.unlink-btn').opacity === '0', 'unlink is quiet until the row is hovered');
  assert.equal(rulesFor('.entity-row:hover .unlink-btn').opacity, '.7');
});

test('board card titles truncate with an ellipsis, not a mid-word clip (Issue #20)', () => {
  const name = rulesFor('.card-name');
  assert.equal(name['overflow'], 'hidden');
  assert.equal(name['text-overflow'], 'ellipsis');
  assert.equal(name['white-space'], 'nowrap');
});

test('vendored mermaid is at or past the 11.9.0 security release (Issue #8)', () => {
  const src = readFileSync(join(ROOT, 'public/vendor/mermaid.min.js'), 'utf8');
  const versions = [...src.matchAll(/version[:=]"(11\.\d+\.\d+)"/g)].map((m) => m[1]);
  assert.ok(versions.length, 'the bundle declares its version');
  const atLeast = (v, floor) => {
    const a = v.split('.').map(Number), b = floor.split('.').map(Number);
    for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
    return true;
  };
  assert.ok(versions.some((v) => atLeast(v, '11.9.0')),
    `mermaid must be ≥ 11.9.0 (XSS advisories fixed there); saw ${versions.join(', ')}`);
});

test('the filter strip drives the engine where-language, not a client sort (Feature #38)', () => {
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
  assert.ok(app.includes("function filterWhere(db)"), 'filters compile to a where clause');
  assert.ok(app.includes("['in', states]") || app.includes("'in', states]"), 'workflow states use the in operator');
  // Both the initial load and every refresh must apply the same filters.
  const loads = app.match(/query`, w(here)?2? \? \{ where/g) ?? app.match(/\{ where \}/g) ?? [];
  assert.ok(app.includes('where ? { where } : {}'), 'showDatabase queries through the filters');
  assert.ok(app.includes('w2 ? { where: w2 } : {}'), 'onSaved refreshes through the filters');
  const chips = rulesFor('.filter-chip');
  assert.ok(chips['cursor'] === 'pointer');
});

test('a date cell is type-or-pick: parsed text beside a native calendar (Feature #44)', () => {
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
  const html = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(html.includes('nl-date.js'), 'the parser loads before the app');
  assert.ok(app.includes('window.parseNaturalDate'), 'typed phrases go through the parser');
  assert.ok(app.includes("f.time ? 'datetime-local' : 'date'"), 'the calendar respects the time costume');
  assert.ok(app.includes("'T' + String(rawIso).split('T')[1]"), 'a typed phrase keeps the existing time of day');
});

test('navigation paints a skeleton of the destination first (Feature #49)', () => {
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
  assert.ok(app.includes('function paintSkeleton('));
  const route = app.slice(app.indexOf('function renderRoute()'), app.indexOf('function route()'));
  assert.ok(route.includes('paintSkeleton('), 'renderRoute paints before it dispatches');
  const sk = rulesFor('.sk');
  assert.equal(sk['border-radius'], '4px');
  assert.ok(readFileSync(join(ROOT, 'public/style.css'), 'utf8').includes('prefers-reduced-motion'), 'shimmer respects reduced motion');
});

test('a share link comes with its QR code (Feature #50)', async () => {
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
  const html = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(html.includes('lean-qr.mjs'), 'lean-qr is vendored and loaded as a module');
  assert.ok(app.includes('function qrCanvas('), 'the QR renderer exists');
  const share = app.slice(app.indexOf("'Share link'"), app.indexOf("'Revoke share'"));
  assert.ok(app.includes('qrCanvas(full)'), 'sharing shows the code, not only a silent copy');
  // The vendored module actually generates: same file, imported under node.
  const leanQR = await import('../public/vendor/lean-qr.mjs');
  const code = leanQR.generate('https://example.com/view/wvv_abc');
  assert.ok(code.size >= 21, 'a real QR matrix comes back');
});

test('docs go fullscreen and diagrams become whiteboards (Features #47, #46)', () => {
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
  const html = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(app.includes('function fullscreenViewer('), 'the in-tree dialog exists');
  assert.ok(app.includes('history.back()'), 'the frame has its own back');
  assert.ok(app.includes('function openWhiteboard('), 'the whiteboard exists');
  assert.ok(html.includes('graph-parse.js'), 'the parser loads with the app');
  assert.ok(app.includes("src = '/vendor/cytoscape.min.js'"), 'cytoscape is lazy — 434KB only when a whiteboard opens');
  assert.ok(app.includes('pre.dataset.mmd'), 'the mermaid source survives its own rendering');
});

test('every selector speaks the one dialect: search bar first, list under it', () => {
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
  assert.ok(app.includes('function searchPicker('), 'the dialect exists');
  assert.ok(app.includes('function pickerSelect('), 'and its form-control face');
  // The mandate: the cursor is already in the search bar.
  const picker = app.slice(app.indexOf('function searchPicker('), app.indexOf('function pickerSelect('));
  assert.ok(picker.includes('input.focus()'), 'the search bar takes focus on open');
  assert.ok(picker.includes("key === 'ArrowDown'") && picker.includes("key === 'Enter'"), 'arrows move, Enter picks');
  // No native <select> may remain anywhere in the app.
  assert.equal((app.match(/el\('select'/g) ?? []).length, 0, 'native selects are gone — everything routes through the picker');
  // Chip cells route through the same dialect.
  const chips = app.slice(app.indexOf('function chipPicker('), app.indexOf('const PICKER_FIELD_TYPES'));
  assert.ok(chips.includes('searchPicker('), 'workflow/select chips open the dialect too');
  const search = rulesFor('.picker-search');
  assert.equal(search['width'], '100%');
  const list = rulesFor('.picker-list');
  assert.ok(list['max-height'], 'the list is small and scrolls');
});

test('multi pickers edit in place: selections listed with ×, saved on Enter', () => {
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
  const picker = app.slice(app.indexOf('function searchPicker('), app.indexOf('function pickerSelect('));
  assert.ok(picker.includes('multi'), 'the dialect has a multi mode');
  assert.ok(picker.includes('drawChosen'), 'current selections render inside the picker');
  assert.ok(picker.includes("'Remove'"), 'each selection carries its ×');
  assert.ok(picker.includes('await commit()'), 'Enter on an empty search saves');
  assert.ok(picker.includes('if (multi && pop.isConnected) { commit('), 'outside click saves, never discards');
  // Multiselect cells and both relation-link surfaces stage through it.
  assert.ok(app.includes('function chipPickerMulti('));
  const links = [...app.matchAll(/multi: \{\s*\n\s*selected:/g)];
  assert.ok(links.length >= 2, `both link surfaces edit through multi (saw ${links.length})`);
  assert.ok(app.includes('unlink'), 'removals commit as unlinks');
});
