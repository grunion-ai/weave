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
  assert.match(APP, /api\('GET', `\/tables\/\$\{db\.id\}\/trash`\)\.catch\(\(\) => \(\{ total: 0, items: \[\] \}\)\)/);
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

/* Superseded for the GRID by the Ledger direction (Kyle, 2026-08-24): there,
   the #id link navigates and every cell edits, so a row click no longer
   reaches openEntity at all and ⌘-click opens the side peek. The embedded
   related rows are unchanged and still route the old way — the board went
   entirely (Kyle, 2026-08-25, Issue #75) — and test/ledger-grid.test.mjs
   owns the grid's contract. */
test('related rows still route a click before opening the entity', () => {
  const routed = [...APP.matchAll(/const pick = rowClickTarget\(e\);\s*\n\s*if \(pick === 'ignore'\) return;\s*\n\s*if \(pick\) return openCellPicker\(pick\);\s*\n\s*(?:if \(openRegistryRow\(db, item\)\) return;\s*\n\s*)?openEntity\(/g)];
  assert.equal(routed.length, 1, 'embedded related rows route clicks; the grid edits in place');
  assert.equal((APP.match(/openEntity\(item\.id\)/g) ?? []).length, routed.length,
    'no row surface may open the entity without routing first');
  assert.equal((APP.match(/peekEntity\(item\.id\)/g) ?? []).length, 0,
    'the grid no longer peeks — the #id link docks and ⌘-click opens a tab (one entity surface)');
  assert.match(APP, /docChipCell\(f, item, \(\) => peekEntity\(id\)\)/,
    'and a doc chip peeks its entity from the cell (Issue #74)');
  assert.match(APP, /function rowClickTarget/);
  assert.match(APP, /function openCellPicker/);
  const fn = APP.slice(APP.indexOf('function openCellPicker'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
  assert.match(body, /\.chip-trigger/, 'chip pickers open by clicking their trigger');
  assert.match(body, /showPicker/, 'native <select> cells open their own dropdown');
});

test('in the grid every cell advertises that it edits', () => {
  // Was: only .cell-pick got a pointer, because only picker cells were
  // clickable. Now the whole body is a target, and no cell type gets an
  // outline of its own — that read as a rule between fields.
  assert.ok(rulesFor('.wv-grid tbody td').cursor, 'the grid body is one big edit target');
  assert.deepEqual(rulesFor('.wv-grid td.cell-pick'), {}, 'picker cells need no separate affordance');
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
   The grid carries both "+" controls itself: fields at the end of the header
   bar, entities as the last row. The header buttons existed for board and
   list; with both views gone (Issues #75), so are the buttons. */

test('table view moves both create controls into the grid', () => {
  assert.ok(!APP.includes("state.route.view === 'table'"), 'no view guards remain — the grid is the view');
  assert.match(APP, /class: 'add-field-head'/, 'header bar ends with the field "+" cell');
  assert.match(APP, /function addFieldMenuButton/);
  assert.match(APP, /class: 'add-entity-row'/, 'the grid ends with the new-entity row');
  // The detached bar it replaced must be gone from both surfaces.
  assert.doesNotMatch(APP, /add-row-bar/);
  assert.doesNotMatch(CSS, /add-row-bar/);
});

test('the field "+" opens the add tray directly — relation is a grid tile, Manage fields is the eyeball', () => {
  // Superseded 2026-08-23 (Kyle): nothing is stranded — relation is a type
  // in the tray and show/hide is the eyeball, so the menu went away.
  const fn = APP.slice(APP.indexOf('function addFieldMenuButton'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
  assert.match(body, /addFieldDialog\(db\)/);
  assert.doesNotMatch(body, /showPopover/);
});

test('full-width grid rows derive their span from one column count', () => {
  // The header gained a column; a restated `cols.length + N` would silently
  // under-span the new-entity row. It gained another with row selection
  // (Feature #132), and LOST the shared Docs cell when every document became
  // a column of its own (2026-08-31): checkbox + # + one per field + the "+"
  // control. What the span must actually EQUAL is proved against a live
  // header in test/row-selection-browser.test.mjs — this only pins the source.
  assert.match(APP, /const colCount = cols\.length \+ 3;/, 'the table view derives it once');
  assert.match(APP, /const colCount = cols\.length \+ 2;/, 'so does the embedded related grid, from its own columns');
  assert.doesNotMatch(APP, /colspan: String\(cols\.length/, 'never restated at a use site');
  assert.equal((APP.match(/colspan: String\(colCount\)/g) ?? []).length, 2,
    'the new-entity row in the table view, plus the related grid\'s add row');
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
  assert.ok(rulesFor('.wv-toast-action').cursor, '.wv-toast-action must be styled as a control');
});

test('purging keeps the hold-to-confirm and is the only hard delete in the UI', () => {
  assert.match(APP, /holdToConfirm\('Delete forever'/);
  const hard = [...APP.matchAll(/\?hard=1/g)];
  assert.equal(hard.length, 1, 'exactly one call site may purge');
  assert.match(APP, /function showTrash/);
  assert.match(APP, /#\\?\/trash\\?\/\(\[\^\/\?\]\+\)/, 'trash needs a route');
});

test('deleted rows are reached through the eyeball; the toolbar has no trash badge (superseded 2026-08-23)', () => {
  assert.doesNotMatch(fnBody('drawDatabase'), /#\/trash\//, 'no 🗑 control on the toolbar');
  assert.match(APP, /api\('GET', `\/tables\/\$\{db\.id\}\/trash`\)/, 'the count still feeds the eyeball');
  assert.match(fnBody('fieldVisibilityPopover'), /Deleted \$\{db\.term\.plural\}/, 'the toggle speaks the table\'s row term');
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
  for (const t of ["title: `${WeaveTerm.cap(termOfTable(entity.dbId).singular)} actions`", "title: 'Table actions'", "title: 'Space actions'"]) {
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

/* ---------- entity side column (Kyle, 2026-08-16; fields moved into the
   body by Feature #117, 2026-08-23) ---------- */

test('comments and activity make up the side column; fields lead the body', () => {
  assert.match(APP, /right\.append\(commentsPanel, actPanel\)/,
    'the side column reads Comments → Activity');
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

test('every column header carries a field menu; a header click edits, sorting lives in the menu', () => {
  // Kyle, 2026-08-23: clicking a column opens its editor in the tray. Sort
  // moved into the ⋮ menu (asc / desc / clear) so it is still one click away.
  const head = fnBody('renderTable');
  assert.match(head, /fieldMenuButton\(/, 'each column th mounts the field menu');
  assert.match(head, /onclick: \(\) => editFieldDialog\(db, colField\(db, c\)\)/, 'the header click opens the field editor');
  assert.match(head, /onSort: \(dir\) =>/, 'the menu is handed the sort control');
  const menu = fnBody('fieldMenuButton');
  assert.match(menu, /showPopover\(/, 'the menu reuses the chip popover, not a new overlay');
  assert.match(menu, /stopPropagation/, 'opening the menu must not also open the editor');
  assert.match(menu, /Sort ascending/, 'sort ascending is in the menu');
  assert.match(menu, /Sort descending/, 'sort descending is in the menu');
});

test('the field menu edits a field rather than dropping and rebuilding it', () => {
  // The edit path lives in the unified fieldDialog (A+E, 2026-08-22); the
  // contract is unchanged: edit is a PATCH, never delete-and-recreate.
  const dlg = fnBody('fieldDialog');
  assert.match(dlg, /'PATCH'/, 'F1: editing a field is a PATCH to /fields/:id');
  assert.doesNotMatch(dlg, /'DELETE'/, 'never delete-and-recreate — that drops the column data');
  const patchCfg = fnBody('editPatchConfig');
  assert.match(patchCfg, /options/, 'the editor reaches the type config, not just the name');
  assert.match(patchCfg, /states/, 'workflow states are editable');
  assert.match(patchCfg, /expression/, 'formula expressions are editable');
});

test('deleting a field from the header is guarded and never offered for Name', () => {
  const menu = fnBody('fieldMenuButton');
  assert.match(menu, /holdToConfirm\(/, 'destructive rows are hold-to-confirm, like the schema page');
  assert.match(menu, /f\.role !== 'name'/, 'the name-role field must not offer a delete row (by role — it can be renamed, Feature #168)');
});

/* ---------- the field menu redesign (Kyle, 2026-08-27) ----------
   The screenshot that started it: five rows, four different left edges, four
   glyph sizes, and the red row wearing another design system's padding. Each
   test below pins one of the four defects so the panel cannot drift back. */

test('the field menu draws its icons, it never types them into a label', () => {
  // Issue #87: a unicode mark carries its own advance width and optical size,
  // so '✎' and '↑' never shared a box with each other or with anything drawn.
  const menu = fnBody('fieldMenuButton') + fnBody('fieldMenuRow');
  assert.match(menu, /iconEl\(/, 'every mark resolves through the one icon path');
  for (const typed of ['✎ Edit', '+ Insert', '↑ Sort', '↓ Sort']) {
    assert.ok(!menu.includes(typed), `'${typed}' is a glyph pasted into a label — draw it instead`);
  }
  assert.match(APP, /const FIELD_MENU_ICONS = \{/, 'the menu names its icons in one place');
});

test('every row of the field menu is the same row, destructive included', () => {
  // The delete row was a Tabler .dropdown-item among weave .chip-pop-rows:
  // different padding and radius, no icon column — AND outside showPopover's
  // ↑↓ walk, which reads `.chip-pop-row`. The keyboard could not reach the
  // one row that most deserves deliberate aim.
  const menu = fnBody('fieldMenuButton');
  assert.match(menu, /rowClass: 'chip-pop-row wv-menu-row wv-menu-danger'/,
    'the hold row must carry the popover row class so ↑↓ reaches it');
  const hold = fnBody('holdToConfirm');
  assert.match(hold, /rowClass = 'dropdown-item'/, 'and the menu-less call sites keep their old row');
  const walk = fnBody('showPopover');
  assert.match(walk, /querySelectorAll\('\.chip-pop-row'\)/,
    'the walk is over .chip-pop-row — that is why the delete row has to be one');
  const rowCss = rulesFor('.chip-pop-row.wv-menu-row');
  assert.ok(rowCss.padding && rowCss.gap, 'one metric declared once, for all of them');
  assert.equal(rulesFor('.wv-menu-icon').flex, '0 0 var(--wv-icon-md)',
    'the icon box never collapses, or a row without a glyph loses the left edge');
});

test('sort state is the popover check, not a character prefixed to the label', () => {
  // '✓ Sort ascending' shunted the whole row right whenever it was on.
  const menu = fnBody('fieldMenuButton') + fnBody('fieldMenuRow');
  assert.ok(!menu.includes("'✓ '"), 'no check pasted onto the front of a label');
  assert.match(menu, /chip-pop-check/, 'the popover already has a current-value cue');
  assert.match(menu, /current: sorted > 0/, 'ascending is marked when it is the live sort');
  assert.match(menu, /current: sorted < 0/, 'and descending too');
  // Free consequence, and the reason to use the house cue: showPopover opens
  // focus on the row carrying a check.
  assert.match(fnBody('showPopover'), /findIndex\(\(o\) => o\.querySelector\('\.chip-pop-check'\)\)/);
});

test('the menu names the column it belongs to', () => {
  // The ⋮ paints millimetres from the NEXT column's label (live check,
  // 2026-08-16); the hovered tint was the only thing tying panel to column.
  const menu = fnBody('fieldMenuButton');
  assert.match(menu, /wv-menu-head/, 'a title line opens the panel');
  assert.match(menu, /fieldDialogCore\.typeLabel\(f\.type\)/, 'naming the type as well as the name');
  const head = rulesFor('.wv-menu-head');
  assert.match(head['border-bottom'] ?? '', /var\(--tblr-border-color\)/, 'it is a header, so it is ruled off');
  assert.equal(rulesFor('.wv-menu-title')['text-overflow'], 'ellipsis', 'a long field name must not stretch the panel');
});

test('the hold gesture is advertised before it is pressed', () => {
  // Kyle keeps the hold and its sweep; a hold nobody knows about is a button
  // that does nothing, so the row says so at rest.
  assert.match(fnBody('fieldMenuButton'), /hint: 'hold'/);
  const hint = rulesFor('.hold-hint');
  assert.ok(hint['border-radius'], 'the hint is a chip, in the chip idiom');
  assert.equal(rulesFor('.hold-btn.holding .hold-hint').opacity, '0',
    'and it clears once the press starts — the swapped label carries it from there');
});

test('the sweep is themed and reads as a travelling front', () => {
  const fill = rulesFor('.hold-fill');
  assert.match(fill.background, /var\(--tblr-danger\)/, 'the tint comes off the token, not a literal rgb');
  assert.match(fill.background, /linear-gradient/, 'darkening toward the leading edge, so it reads as a front');
  // The contract from Feature #75 is untouched by the restyle.
  assert.equal(fill.transition, 'transform 0s');
  assert.equal(fill.transform, 'scaleX(0)');
});

test('a popover arrives rather than appears, and stops for reduced motion', () => {
  // rulesFor merges every block for a selector and does not see @media
  // nesting, so the reduced-motion override would mask the base rule here:
  // read the two declarations from the source instead.
  assert.match(CSS, /\.chip-pop \{[^}]*animation: wv-pop-in [^}]*\}/, 'the base rule animates it in');
  assert.match(CSS, /@keyframes wv-pop-in/);
  // The entrance is a transform + opacity pair: neither one costs a layout,
  // and offsetHeight (which showPopover measures to decide the flip) is
  // unchanged by a transform, so placement is not disturbed.
  assert.doesNotMatch(CSS.slice(CSS.indexOf('@keyframes wv-pop-in')).slice(0, 160), /width|height|top:|left:/);
  const reduced = CSS.match(/@media \(prefers-reduced-motion: reduce\) \{[^}]*\.chip-pop[^}]*\}/);
  assert.ok(reduced, 'an entrance animation needs a reduced-motion opt-out');
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
  const dlg = fnBody('fieldDialog');
  assert.match(dlg, /isEdit \? 'Save changes' : 'Create'/, 'the unified dialog must label edit submits as a save');
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
  assert.match(head, /columnWidthStyle\(f\.width\)/,
    'cells need a matching max-width or the 260px cap still ellipsises them');
  // Kyle, 2026-08-24: a resized column snapped back. Auto table layout drops a
  // bare `width` the moment the grid is wider than its card, so the stored
  // width has to be a floor too, on the header and on every cell.
  const style = APP.match(/const columnWidthStyle = .*/)?.[0] ?? '';
  assert.match(style, /min-width:/, 'a stored width must hold the column open');
  assert.match(style, /max-width:/, 'and still cap it so cells ellipsise');
  const apply = fnBody('applyColumnWidth');
  assert.match(apply, /minWidth/, 'the in-place commit sets the same floor');
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

test('double-click fits the column to its content (measured), a schema write like any resize', () => {
  // Superseded 2026-08-23 (Kyle): the browser's auto width still cut text
  // off; fit is now measured on the cells and written like a drag.
  const grip = fnBody('columnResizeGrip');
  assert.match(grip, /setColumnWidth\(db, f, fitColumnWidth\(th\), th\)/,
    'double-click writes the measured fit');
  const writer = fnBody('setColumnWidth');
  assert.match(writer, /'PATCH'/, 'width is a schema write');
  assert.match(writer, /config: \{ width/, 'through the field config');
});

test('a fit measures the content, not the box the column already has', () => {
  // Kyle, 2026-08-24: "table resize double click does not snap to properly".
  // Cells clip with max-width + ellipsis, so scrollWidth equals clientWidth
  // and a text cell's <input> is a default-sized box — the old measurement
  // returned the current width every time and each click only added padding.
  const fit = fnBody('fitColumnWidth');
  assert.ok(!/scrollWidth/.test(fit), 'a clipped cell never reports overflow — scrollWidth cannot fit it');
  assert.match(fit, /cellFitProbe\(/, 'the fit measures a clone off the grid');
  assert.match(fit, /colSpan > 1/, 'the "+ New" row and expanded documents span the grid, not the column');
  assert.match(fit, /getBoundingClientRect\(\)\.width/, 'the clone is measured as painted');
  const probe = fnBody('cellFitProbe');
  assert.match(probe, /input, textarea/, 'an input paints its value, not its box');
  assert.match(probe, /src\.value \|\| src\.placeholder/, 'so the value is what gets measured');
  const measurer = rulesFor('.wv-measure');
  assert.equal(measurer.visibility, 'hidden', 'the measurer never shows');
  assert.equal(measurer.position, 'absolute', 'and never takes part in the layout');
  assert.equal(rulesFor('.wv-measure-cell')['white-space'] ?? rulesFor('.wv-measure-cell').whiteSpace, 'nowrap',
    'the clone must not wrap, or the fit reads a wrapped width');
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
  // inline-flex since the chip system landed (2026-08-24): a chip now carries
  // a leading glyph beside its label, and both still shrink-wrap.
  assert.equal(chip.display, 'inline-flex', 'inline-flex shrink-wraps the label');
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

  // The entity's controls sit on the crumb line, right-aligned, exactly as
  // the table's do (Kyle, 2026-08-23: "move the entity 3 dots menu to be in
  // line with the breadcrumbs and include the show/hide eye just like on the
  // table view"). The title row is the title.
  assert.match(APP, /class: 'crumb crumb-row' \},\s*\n\s*el\('span', \{ class: 'crumb-path' \},[\s\S]{0,900}?el\('span', \{ class: 'crumb-actions wv-toolbar' \}, activityBtn, eye, dlBtn\)/,
    'the entity activity toggle, eye and ⋮ trail the crumb line');
  // Kyle, 2026-08-23: "create an activity button as well — when clicked it
  // shows comments and activity in the right panel; by default it is hidden."
  // The side column is a toggle, remembered per browser, off until asked for.
  const body = fnBody('renderEntityView');
  assert.match(body, /const sideOpen = localStorage\.getItem\('wv-entity-side'\) === '1';/, 'hidden by default, remembered once opened');
  assert.match(body, /class: 'btn btn-sm activity-btn' \+ \(sideOpen \? ' active-toggle' : ''\)/, 'the button shows its state');
  assert.match(body, /grid\.classList\.toggle\('side-open', sideOpen\)/, 'the grid carries the state');
  assert.equal(rulesFor('.entity-grid')['grid-template-columns'], 'minmax(0, 1fr)', 'one column at rest');
  assert.match(CSS, /\.entity-grid\.side-open \{ grid-template-columns: minmax\(0, 1fr\) 320px; \}/, 'two when the side is open (the narrow-screen media rule collapses it again)');
  assert.equal(rulesFor('.entity-grid:not(.side-open) > .entity-side').display, 'none', 'the side column is gone, not blank');
  assert.match(APP, /class: 'wv-toolbar entity-head' \}, nameInput\)/, 'the title row holds only the name');
  assert.match(APP, /class: 'view-header' \},\s*\n\s*el\('div', \{ class: 'crumb crumb-row' \}/,
    'the entity crumb + title row live in a .view-header, so crumb spacing matches');
  assert.match(body, /fieldVisibilityPopover\(eye, db, 0, \{ redraw: refresh, rowsSection: false \}\)/,
    'the same eye popover as the table, redrawing the entity and without the table-only Rows section');
  assert.match(body, /!hidden\.has\(f\.name\)/, 'hidden fields are hidden here too — one hidden set per table');
  const eyeFn = fnBody('fieldVisibilityPopover');
  assert.match(eyeFn, /redraw \? await redraw\(\) : await keepScroll/, 'the popover redraws whatever view opened it');
  assert.match(eyeFn, /rowsSection \? \[/, 'the Rows section is optional');
  assert.match(eyeFn, /fieldVisibilityPopover\(again, fresh, trashCount, \{ redraw, rowsSection \}\)/, 'and the reopened popover keeps its options');
  assert.equal(rulesFor('.entity-head')['margin-bottom'], '0',
    '.view-header owns the gap below the header, exactly as on .view-title-row');

  const head = rulesFor('.entity-head');
  const bar = rulesFor('.wv-toolbar');
  assert.equal(head['align-items'], bar['align-items'],
    '.entity-head must align its row the same way .wv-toolbar does');
  assert.equal(rulesFor('.entity-head .dl-wrap')['margin-left'], 'auto',
    'margin-left:auto is what pushes the menu to the right edge');

  // Right edge means the panel must hang off the right, or it runs off-screen.
  const call = APP.match(/\{ title: `[^`]*\} actions`, align: 'right' \}/);
  assert.ok(call, 'the entity menu call site should be findable');
  assert.match(call[0], /align: 'right'/, 'a right-edge menu must drop its panel to the left');
});

/* Reference panels (Kyle, 2026-09-02): hidden with comments and activity —
   they live in the entity-side column the Activity button opens, dressed
   like Activity, and nothing is fetched until the column is open. The chips
   are the pointer-tier relation chip. The DOM proof — not fetched at rest,
   appears below Activity on the click, hides with the column, remembered per
   browser, pointer-tier paint in both themes — is
   test/references-browser.test.mjs; this is the contract the gate reads
   without a browser. */
test('reference panels join the opt-in side column, dressed like Activity, wearing the pointer-tier relation chip', () => {
  const body = fnBody('renderEntityView');
  const block = body.slice(body.indexOf('const refCard'), body.indexOf('deck is composed on read'));
  assert.ok(block.length > 0, 'the reference panel builder lives in the entity view');
  assert.match(block, /right\.append\(el\('div', \{ class: `card panel ref-backlinks-card \$\{extraClass\}` \}/,
    'a side-column panel, the same dress as Comments and Activity');
  assert.doesNotMatch(block, /left\.append/, 'the entity body stays quiet');
  assert.doesNotMatch(block, /el\('details'|el\('summary'/, 'no disclosure of its own: the side column is the disclosure');
  assert.match(block, /el\('div', \{ class: 'card-header' \},\s*el\('h3', \{ class: 'card-title' \}, `\$\{title\} · \$\{refs\.length\}`\)\)/,
    'the header is title + count, as Activity wears it');
  assert.match(block, /if \(sideOpen\) \{\s*api\('GET', `\/entities\/\$\{id\}\/references-from`\)/,
    'nothing is fetched until the side column is open');
  assert.match(block, /\.then\(refCard\('References', 'ref-outbound-card'\)\)/, 'what this entity mentions');
  assert.match(block, /\.then\(refCard\('Referenced by', 'ref-inbound-card'\)\)/, 'who mentions it');
  assert.match(block, /el\('span', \{ class: 'k k-rel' \},\s*el\('a', \{ href: `#\/entity\/\$\{r\.id\}` \}/, 'the chip is the relation chip, and the chip is the link');
  assert.match(block, /el\('span', \{ class: 'k-home' \}, r\.db\.split\('\/'\)\.pop\(\)\)/, 'the badge is the short home-table name');
  assert.doesNotMatch(block, /class: 'x'|×/, 'no unlink control: a reference is text');
  // The whole column hides together, and the <details> dress left with the body placement.
  assert.equal(rulesFor('.entity-grid:not(.side-open) > .entity-side').display, 'none', 'the panels hide with comments and activity');
  assert.doesNotMatch(CSS, /\.ref-summary|\.ref-backlinks-card\[open\]/, 'the <details> dress is gone');
  // No local chip dress: the k k-rel rules (chip-system.test.mjs, pointer tier) are the whole styling.
  assert.doesNotMatch(CSS, /\.ref-backlinks a\.mention|\.ref-backlink\b/, 'the bespoke mention styling is gone');
  assert.doesNotMatch(CSS, /\.ref-backlinks(-card)?\s+\.k\b/, 'no reference-local chip rules');
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

test('the document section head names the document at rest; its tools stay quiet until reached for', () => {
  // Kyle, 2026-08-23: "docs and description show only on hover, they should
  // show all the time" — the name is a field label like any other row's.
  // The caret / permalink / downloads beside it still fade in on hover.
  const head = rulesFor('.doc-section-head');
  assert.notEqual(head.opacity, '0', 'the head is visible at rest');
  assert.notEqual(head.display, 'none', 'the head keeps its space in the flow');
  assert.equal(rulesFor('.doc-anchor').opacity, '0', 'the tools are hidden at rest');
  assert.equal(rulesFor('.doc-section:hover .doc-anchor').opacity, '.7', 'and fade in on hover');
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
  for (const fn of ['renderTable', 'renderEntityView', 'openSchemaEditor']) {
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

test('the event detail page reads one event and is laid out like any entity page', () => {
  const view = fnBody('showActivityDetail');
  assert.match(view, /api\('GET', `\/activity\/\$\{encodeURIComponent\(/, 'it reads the single-event endpoint');
  assert.doesNotMatch(view, /'POST'|'PATCH'|'DELETE'/, 'and writes nothing');
  assert.match(view, /class: 'view-header'/, 'the same header shell as an entity');
  assert.match(view, /permalink-copy/, 'with a copyable permalink in the crumb');
  assert.match(view, /class: 'fieldrow'/, 'values read as label/value field rows');
  assert.match(view, /recordChip\(a\)/, 'the referenced record is the shared relation chip');
  assert.match(view, /#\/activity\/\$\{a\.entityId\}/, 'and the record\'s own filtered feed is reachable');
  assert.match(view, /a\.actor/, 'the page says who did it');
  assert.match(view, /activitySummary\(a\)/, 'and reuses the one summary function');
});

test('the Activity table permalinks each row\'s record without hijacking the row', () => {
  assert.match(fnBody('showActivity'), /recordChip\(a\)/, 'the record cell is the same chip as the detail page');
  const chip = fnBody('recordChip');
  assert.match(chip, /class: 'k k-rel/, 'a relation chip, as on any entity page');
  assert.match(chip, /href: `#\/entity\/\$\{a\.entityId\}`/, 'permalinking the entity');
  assert.match(chip, /stopPropagation/, 'without also opening the event around it');
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
  // The list and the string→typed conversion moved to field-dialog-core.js
  // (DEFAULTABLE / typedDefault, tested in field-dialog-core.test.mjs); the
  // dialog contract here: it consults that list and an emptied input CLEARS
  // the stored default on edit instead of silently keeping it.
  const CORE = readFileSync(join(ROOT, 'public/field-dialog-core.js'), 'utf8');
  const listed = CORE.match(/const DEFAULTABLE = \[([^\]]*)\]/)[1];
  for (const t of ['text', 'number', 'date', 'checkbox', 'url', 'email', 'select', 'multiselect']) {
    assert.ok(listed.includes(`'${t}'`), `${t} takes a default`);
  }
  for (const t of ['workflow', 'document', 'formula', 'rollup', 'lookup', 'relation']) {
    assert.ok(!listed.includes(`'${t}'`), `${t} must not offer one — the engine refuses it`);
  }
  assert.match(fnBody('fieldDialog'), /DEFAULTABLE\.includes/, 'the dialog consults the core list');
  assert.match(fnBody('editPatchConfig'), /default = c\.default \?\? null/, 'an emptied input clears the default');
  const read = CORE.slice(CORE.indexOf('function typedDefault'), CORE.indexOf('\n  }', CORE.indexOf('function typedDefault')));
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
  assert.match(grid, /openEntity\(item\.id\)/, 'and a click elsewhere opens the row\'s page (Feature #117)');
  assert.match(grid, /\['id', 'in', linked\.map/, 'the rows are fetched whole, by id');
  assert.match(grid, /c\.name !== f\.inverseField/, 'the column pointing back at this record is dropped');

  const body = fnBody('renderEntityView'); // the one entity rendering — page and peek both mount it
  assert.match(body, /relatedGrid\(entity, f, refresh\)/, 'the entity page mounts one per collection relation');
  assert.match(body, /x\.type === 'relation' && x\.many/, 'collections only — a single link stays a chip');
  assert.match(body, /wireBlock\(f\.name, el\('div', \{ class: 'related-block' \}\)/,
    'they are blocks of the main body, movable like any other (Issue #89)');
  assert.match(body, /grid\.querySelector\('\.related-head'\)\?\.prepend\(grip\)/,
    'and the anchor lands in the head the grid draws for it');
  assert.match(body, /if \(f\.type === 'relation' && f\.many && !f\.targetDbIds\) continue;/,
    'and are not repeated as chips in the fields block — except a target set, which has no one grid and stays chips');
});

/* Feature #117 — the entity page is the destination. Fields are the first
   thing on the page (Fibery-style label/value block at the top of the body,
   not a card in the side column), and their order is the table's fieldOrder:
   drag ⠿ on a row and the column order in the table view follows, because
   reorderField is the one writer for both. */
test('the entity body is blocks, and every block carries a reposition anchor', () => {
  const body = fnBody('renderEntityView');
  assert.match(body, /class: 'entity-fields'/, 'the value fields are one block');
  assert.match(body, /left\.classList\.add\('entity-body'\)/, 'the main column IS the body');
  assert.doesNotMatch(body, /card-title' \}, 'Fields'/, 'and no longer a side card (Feature #82 superseded)');

  /* Two drags, and they do not mix: a value field moves inside the field
     block and writes fieldOrder; a block moves among blocks and writes
     bodyOrder. A field promoted to a block would be a field the grid view
     could not show (Issue #89, Kyle 2026-08-26). */
  assert.match(body, /let dragFrom = null;/, 'a field drag');
  assert.match(body, /let blockFrom = null;/, 'and a block drag, tracked apart');
  assert.match(body, /if \(!dragFrom \|\| dragFrom === f\.name\) return;/, 'a field drop ignores a block drag');
  assert.match(body, /if \(!blockFrom \|\| blockFrom === key\) return;/, 'and a block drop ignores a field drag');
  assert.match(body, /reorderField\(db, from, f\.name, \{ after, onFail: refresh \}\)/,
    'a field drop is a fieldOrder write through the one reorder function');
  assert.match(body, /reorderBlocks\(db, left, refresh\)/, 'a block drop is a bodyOrder write');

  /* Direction: a field drop reads the pointer's height against the row's
     midpoint — the cue line and the landing side are the same fact (Kyle,
     2026-08-28). A block drop still reads the live DOM order. */
  assert.match(body, /e\.clientY > r\.top \+ r\.height \/ 2/, 'a field drop lands on the side the pointer picked');
  const live = /compareDocumentPosition\(node\) & Node\.DOCUMENT_POSITION_FOLLOWING/g;
  assert.equal((body.match(live) ?? []).length, 1, 'a block drag reads its direction from where blocks sit now');

  assert.match(body, /const anchor = \(what\) => el\('span', \{ class: 'opt-grip', draggable: 'true'/,
    'the anchor is a ⠿ that is itself draggable — the thing you grab is the thing that moves');
  assert.match(body, /wireBlock\(VALUES_BLOCK, fields,/, 'the field block is anchored');
  assert.match(body, /wireBlock\(f\.name, section, \[section\.querySelector\('\.opt-grip'\), section\.querySelector\('\.doc-section-head'\)\]\)/,
    'a document is anchored, and still draggable by its whole head');
  assert.match(body, /node\.classList\.add\('attach-block'\)/, 'an attachment row is a block too');

  /* The order is the table's, resolved by the engine so one rule fills in
     what nobody placed. */
  assert.match(body, /const named = db\.bodyBlocks \?\? \[VALUES_BLOCK\];/, 'the page renders the order it is handed');
  const rb = fnBody('reorderBlocks');
  assert.match(rb, /\[\.\.\.body\.children\]\.map\(\(n\) => n\.dataset\.block\)/,
    'the move already happened, so the DOM is the new order');
  assert.match(rb, /bodyOrder/, 'and it is a table write');

  const rf = fnBody('reorderField');
  assert.match(rf, /onFail = \(\) => showDatabase\(db\.id\)/, 'reorderField defaults its failure redraw to the table view');
  assert.match(rf, /onFail\(\)/, 'and calls whatever the caller gave it');

  assert.match(body, /f\.type === 'document'/, 'a document field renders as its section');
  assert.match(body, /class: 'doc-section-head', draggable: 'true'/, 'and is dragged by its head');
  assert.match(body, /const dragRow = \(node, handle, f\)/, 'one drag wiring serves the value rows');
  assert.match(CSS, /\.entity-fields \.fieldrow\.dragging/, 'a dragged row is ghosted');
  assert.match(CSS, /\.entity-fields \.fieldrow\.drop-before/, 'the insertion line above is marked');
  assert.match(CSS, /\.entity-fields \.fieldrow\.drop-after/, 'and below');
  assert.match(CSS, /\.entity-body > \[data-block\]\.drop-target/, 'a block too');

  // The label is the field: clicking it opens the same tray the table's
  // header click opens (Feature #109), so a field is editable from the one
  // place a reader already is.
  assert.match(body, /class: 'fieldrow-label', title: 'Edit field', onclick: \(\) => editFieldDialog\(db, f\)/,
    'the label click opens the field tray');
  assert.match(CSS, /\.entity-fields \.fieldrow-label:hover/, 'and reads as clickable on hover');
});

test('an embedded grid can add a record and link it in one step', () => {
  const grid = fnBody('relatedGrid');
  assert.match(grid, /api\('POST', `\/tables\/\$\{target\.id\}\/entities`/, 'new rows are created in the target table');
  assert.match(grid, /link\(\[made\.id\]\)/, 'and linked immediately — that is why they were added here');
  assert.match(grid, /'\/entities\/\$\{entity\.id\}\/unlink'|unlink/, 'a row can be unlinked without opening it');
  assert.ok(rulesFor('.unlink-btn').opacity === '0', 'unlink is quiet until the row is hovered');
  assert.equal(rulesFor('.entity-row:hover .unlink-btn').opacity, '.7');
});

test('the board view is gone (Kyle, 2026-08-25, Issue #75)', () => {
  // The way the list view went before it: stale routes and saved views that
  // say "board" land on the table, and no switcher offers the choice.
  assert.ok(!APP.includes('renderBoard'), 'no board renderer');
  assert.ok(!APP.includes('view-switch'), 'no table/board switcher');
  assert.match(fnBody('showDatabase'), /view: 'table'/, 'every #/table route lands on the grid');
});

test('the collapsed nav slides out from the left edge (Kyle, 2026-08-25, Issue #77)', () => {
  const wire = fnBody('wireNavCollapse');
  assert.match(wire, /nav-hot-strip/, 'a hot strip guards the left edge while collapsed');
  assert.match(wire, /nav-peek/, 'resting on it slides the nav out as an overlay');
  assert.match(wire, /strip\.addEventListener\('click'/, 'clicking the edge pins the nav open');
  assert.match(CSS, /#app\.nav-collapsed\.nav-peek #sidebar \{[^}]*position: fixed/,
    'the peek overlays the page instead of reflowing it');
  assert.match(CSS, /#app\.nav-collapsed #nav-hot-strip \{[^}]*position: fixed/,
    'the strip only exists while the nav is collapsed');
  assert.match(CSS, /#sidebar \{ width: 264px/,
    'the nav keeps its comfortable width (264px), never compacted');
});

test('horizontal overscroll is forbidden (Issue #76)', () => {
  // In a narrow Safari window the page h-overflows (rail + sidebar are 316px
  // fixed) and a trackpad swipe could leave the rubber-band STUCK ~16px in —
  // dead space at the left edge until a reload (Kyle's screenshot,
  // 2026-08-26). No x-overscroll, no stuck state; vertical bounce stays.
  assert.match(CSS, /html, body \{ overscroll-behavior-x: none; \}/);
});

test('clicking the open space in the nav folds it instead of navigating nowhere (Issue #72)', () => {
  const nav = fnBody('renderNav');
  assert.match(nav, /state\.route\?\.page === 'space' && state\.route\.spaceId === space\.spaceId/,
    'only the already-open space repurposes the click');
  assert.match(nav, /e\.preventDefault\(\);\s*\n\s*toggleFold\(space\.spaceId\)/,
    'the dead navigation becomes the fold toggle');
  assert.match(nav, /e\.metaKey \|\| e\.ctrlKey/, '⌘-click still opens the space in a tab');
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

test('a date cell is type-or-pick: parsed text beside a calendar (Feature #44, popover since 2026-08-23)', () => {
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
  const html = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(html.includes('nl-date.js'), 'the parser loads before the app');
  assert.ok(app.includes('parseNaturalDate('), 'typed phrases go through the parser');
  const ctl = fnBody('dateControl');
  assert.ok(ctl.includes('datePopover({'), 'the calendar button opens the popover');
  assert.ok(ctl.includes('readTypedDate(typed, c, local())'), 'typed text is read against the field\'s grain');
  assert.ok(fnBody('readTypedDate').includes('dc.partsOf(current)?.t'), 'a typed day keeps the existing time of day');
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
  assert.ok(app.includes('h.back()'), 'the frame has its own back');
  assert.ok(app.includes('function openWhiteboard('), 'the whiteboard exists');
  assert.ok(html.includes('graph-parse.js'), 'the parser loads with the app');
  assert.ok(app.includes("src = '/vendor/cytoscape.min.js'"), 'cytoscape is lazy — 434KB only when a whiteboard opens');
  assert.ok(app.includes('pre.dataset.mmd'), 'the mermaid source survives its own rendering');
  // A document that is itself an app (an HTML slide deck) calls
  // requestFullscreen from inside the frame; Safari refuses unless the
  // iframe says allowfullscreen (Chromium allows same-origin by default).
  const frame = app.slice(app.indexOf("class: 'fsv-frame'"), app.indexOf("class: 'fsv-frame'") + 120);
  assert.ok(frame.includes('allowfullscreen'), 'the viewer frame permits fullscreen from inside (Safari)');
});

test('every selector speaks the one dialect: search bar first, list under it', () => {
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
  assert.ok(app.includes('function searchPicker('), 'the dialect exists');
  assert.ok(app.includes('function pickerSelect('), 'and its form-control face');
  // The mandate: the cursor is already in the search bar.
  const picker = app.slice(app.indexOf('function searchPicker('), app.indexOf('function pickerSelect('));
  assert.ok(picker.includes('input.focus()'), 'the search bar takes focus on open');
  // The keyboard grammar itself is pure (public/picker-core.js, tested in
  // test/picker-core.test.mjs); the DOM half only feeds it keys and where the
  // text caret sits, then runs the effect it hands back.
  assert.ok(picker.includes('core.keyDown('), 'keys route through the one grammar');
  assert.ok(picker.includes('input.selectionStart === 0'), 'and it is told whether the caret is at the start');
  for (const eff of ['pick', 'close']) assert.ok(picker.includes(`'${eff}'`), `${eff} is an effect the picker runs`);
  // No native <select> may remain anywhere in the app.
  assert.equal((app.match(/el\('select'/g) ?? []).length, 0, 'native selects are gone — everything routes through the picker');
  // Chip cells route through the same dialect.
  const chips = app.slice(app.indexOf('function chipPicker('), app.indexOf('const PICKER_FIELD_TYPES'));
  assert.ok(chips.includes('searchPicker('), 'workflow/select chips open the dialect too');
  // The box wears the field's border now; the input inside it is bare.
  const box = rulesFor('.picker-box');
  assert.equal(box['width'], '100%');
  assert.ok(box['border'], 'the box is the field');
  assert.equal(rulesFor('.picker-search')['border'], '0', 'the input inside it draws nothing');
  const list = rulesFor('.picker-list');
  assert.ok(list['max-height'], 'the list is small and scrolls');
});

test('multi pickers edit in place: selections listed with ×, saved on Enter', () => {
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
  const picker = app.slice(app.indexOf('function searchPicker('), app.indexOf('function pickerSelect('));
  assert.ok(picker.includes('multi'), 'the dialect has a multi mode');
  assert.ok(picker.includes('drawChips'), 'current selections render inside the picker');
  assert.ok(picker.includes("'Remove'"), 'each selection carries its ×');
  assert.ok(picker.includes('await commit()'), 'Enter on an empty search saves');
  assert.ok(picker.includes('if (multi && pop.isConnected) { commit('), 'outside click saves, never discards');
  // Multiselect cells and both relation-link surfaces stage through it.
  assert.ok(app.includes('function chipPickerMulti('));
  const links = [...app.matchAll(/multi: \{\s*\n\s*selected:/g)];
  assert.ok(links.length >= 2, `both link surfaces edit through multi (saw ${links.length})`);
  assert.ok(app.includes('unlink'), 'removals commit as unlinks');
});

/* Kyle, 2026-08-25: "selected chips should be in the cursor box so user can
   navigate around with arrows to quickly delete and type to add with the top
   fit autoselected on search". The grammar is tested in
   test/picker-core.test.mjs; what this pins is the DOM that carries it. */
test('the picker is a token box: chips sit inside the field, ahead of the caret', () => {
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
  const picker = app.slice(app.indexOf('function searchPicker('), app.indexOf('function pickerSelect('));
  // One box, chips first, then the input — not a chosen-list stacked above a
  // separate search bar (what it was until 2026-08-25).
  assert.match(picker, /el\('div', \{ class: 'picker-box' \}, chips, input\)/, 'chips and the caret share one box');
  assert.ok(!picker.includes('picker-chosen'), 'the separate chosen list is gone');
  assert.ok(picker.includes("class: 'picker-chips'"), 'the chips are their own element');
  assert.ok(picker.includes("st.caret === i ? ' sel' : ''"), 'the chip under the cursor is marked');
  // Redrawing chips must not detach the focused input, which is why they are
  // a sibling element that flows into the box with display:contents.
  assert.ok(picker.includes('chips.replaceChildren('), 'only the chips redraw');
  assert.equal(rulesFor('.picker-chips')['display'], 'contents', 'so the chips still flow in the box row');
  assert.ok(rulesFor('.picker-chip.sel')['outline'], 'the cursor on a chip reads as a ring');
  assert.equal(rulesFor('.picker-box')['flex-wrap'], 'wrap', 'a full box wraps rather than clipping');
  // The pure half loads before app.js.
  const HTML = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(HTML.indexOf('picker-core.js') < HTML.indexOf('"/app.js"'), 'picker-core.js loads first');
});

/* Issues #63/#64/#65, Kyle 2026-08-25. The behaviour is gated in a real
   browser (test/picker-browser.test.mjs) because source reading is what missed
   #63 in the first place; what belongs here is the styling the numbers wear. */
test('the picker numbers its rows quietly, in a column of their own', () => {
  const num = rulesFor('.picker-num');
  assert.ok(num['flex'], 'the number holds a fixed column so the names still line up');
  assert.equal(num['text-align'], 'right');
  assert.equal(num['font-variant-numeric'], 'tabular-nums', '9 and 1 take the same width');
  assert.ok(Number(num['opacity']) < 1, 'a reader scanning names must not read digits first');
  assert.equal(rulesFor('.picker-row.active .picker-num')['opacity'], '1',
    'the row you are on brings its number forward');
  assert.equal(rulesFor('.picker-row:hover .picker-num')['opacity'], '1', 'and so does the row under the mouse');
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
  const picker = app.slice(app.indexOf('function searchPicker('), app.indexOf('function pickerSelect('));
  assert.match(picker, /ev\.altKey && \/\^Digit\[1-9\]\$\/\.test\(ev\.code\)/,
    'the chord reads the physical key: ⌥1 arrives as `¡`');
});

/* Single select overwrites, so its box carries at most one chip and taking
   that chip out is a pick of the field's empty value — a select has one ('—'),
   a workflow state does not. */
test('a select clears through its own empty option; a state cannot be emptied', () => {
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
  const cell = app.slice(app.indexOf("if (f.type === 'workflow')"), app.indexOf("if (f.type === 'multiselect')"));
  const sel = cell.slice(cell.indexOf("if (f.type === 'select')"));
  assert.ok(sel.includes("clearId: '—'"), 'Backspace on the select chip picks —');
  assert.ok(sel.includes('current: val ?? null'), 'an unset select carries no chip at all');
  const wf = cell.slice(0, cell.indexOf("if (f.type === 'select')"));
  assert.ok(!wf.includes('clearId'), 'a workflow state has no empty value to clear to');
});

test('resize and reorder commit in place — the grid never tears down mid-gesture', () => {
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
  const resize = app.slice(app.indexOf('async function setColumnWidth'), app.indexOf('function fieldMenuButton'));
  assert.ok(!resize.includes('showDatabase(db.id);\n') || resize.includes('catch'), 'redraw only on failure');
  assert.ok(resize.includes('applyColumnWidth(th, width)'), 'the header keeps its width locally');
  assert.ok(resize.includes('applyColumnWidth(cell, width)'), 'cells follow without a repaint');
  const apply = fnBody('applyColumnWidth');
  assert.ok(apply.includes('style.width') && apply.includes('style.maxWidth'),
    'and the width is written as inline style, not a redraw');
  const rStart = app.indexOf('async function reorderField');
  const reorder = app.slice(rStart, rStart + 2600);
  assert.ok(reorder.includes('insertAdjacentElement'), 'columns move as DOM cells, not a redraw');
  assert.ok(reorder.includes('db.fields.splice'), 'the local schema order follows the move');
  assert.ok(reorder.includes('onFail(); // the move did not hold'), 'failure falls back to truth');
  // The resize grip hands its th through so the local commit can find cells.
  assert.ok(app.includes('setColumnWidth(db, f, width, th)'));
  assert.ok(app.includes('setColumnWidth(db, f, fitColumnWidth(th), th)'));
});

/* ---------- unified field dialog (A+E, 2026-08-22) ---------- */

test('field dialogs are the unified fieldDialog, not the old string forms', () => {
  // Both entry points route through one implementation so add and edit can
  // never drift apart again (the old pair disagreed on number clearing).
  assert.match(APP, /function fieldDialog\(db, existing, after\)/);
  assert.match(APP, /function addFieldDialog\(db\) \{[\s\S]{0,200}?fieldDialog\(db, null,/);
  assert.match(APP, /function editFieldDialog\(db, f\) \{\s*fieldDialog\(db, f,/);
  // The comma-separated options input is gone from the dialogs.
  assert.doesNotMatch(APP, /Options \(comma-separated\)/);
});

test('app.js consumes the tested core, loaded before it', () => {
  assert.match(APP, /fieldDialogCore\./, 'the dialog reads the core global');
  assert.match(APP, /definitionFromState\(state\)/, 'submits go through the canonical definition');
  const HTML = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
  const core = HTML.indexOf('field-dialog-core.js');
  const app = HTML.indexOf('"/app.js"');
  assert.ok(core > -1 && core < app, 'field-dialog-core.js must load before app.js');
});

test('formula is a checkbox; the script editor lives inside the tray (Kyle, 2026-08-23)', () => {
  const dlg = fnBody('fieldDialog');
  assert.doesNotMatch(dlg, /def-code|\{ \} definition/, 'no definition pane');
  assert.doesNotMatch(APP, /formulaScriptDialog/, 'no separate script window');
  assert.match(dlg, /dsection\('Script', formulaBuilder\(db, state, changed\)\)/, 'the builder is a tray section');
  assert.match(dlg, /fdc\.typeChoices\(isEdit \? existing\.type : null\)/, 'existing fields see self + migrations only');
  assert.match(dlg, /patch\.type = def\.type/, 'a changed type is sent as a migration');
});

test('dates: one smart control everywhere, a calendar popover with month/year grids, format examples and a today() default', () => {
  const cell = fnBody('editorFor');
  assert.match(cell, /dateControl\(\{/, 'the cell is the shared date control');
  assert.doesNotMatch(cell, /type: f\.time \? 'datetime-local' : 'date'/, 'the native picker is gone');
  const ctl = fnBody('dateControl');
  assert.match(fnBody('readTypedDate'), /parseNaturalDate\(bare, new Date\(\), \{ dayFirst: format === 'eu' \}\)/, 'typed text is autodetected, day-first for eu fields');
  const pop = fnBody('datePopover');
  for (const need of ["view = 'months'", "view = 'years'", 'dc.calendarMonth(y, m)', "'Clear'", "'Today'", "type: 'time'"]) {
    assert.ok(pop.includes(need), `popover has ${need}`);
  }
  const dlg = fnBody('fieldDialog');
  assert.match(dlg, /dateCostumeControls\(state, drawCfg, changed/, 'the grain and costume tray is one shared block for date and daterange');
  const costume = fnBody('dateCostumeControls');
  assert.match(costume, /dc\.formatDate\(todayIso, \{ \.\.\.costume, format: fmt, time: false \}\)/, 'each format is shown as an example, in the grain the field stores');
  assert.match(costume, /fdc\.legalFormats\(g\)/, 'only the styles the grain can wear are offered');
  assert.match(dlg, /dc\.defaultKind\(state\.default\)/, 'the default chooser: none / today() / specific');
  const HTML = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(HTML.indexOf('date-core.js') < HTML.indexOf('"/app.js"'));
  assert.ok(px(rulesFor('.date-pop')['z-index']) >= px(rulesFor('.chip-pop')['z-index']), 'the popover stacks with the other popovers');
});

test('field dialogs open in the right-hand tray and popovers stack above it', () => {
  const dlg = fnBody('fieldDialog');
  assert.match(dlg, /\n  tray\(/, 'the field dialog is a tray, not a centered modal');
  assert.match(fnBody('addRelationDialog'), /\n  tray\(/, 'the relation dialog shares the tray');
  const back = rulesFor('#tray-back');
  const pop = rulesFor('.chip-pop');
  assert.ok(px(pop['z-index']) > px(back['z-index']), 'a picker opened inside the tray must render above it');
  assert.ok(px(pop['z-index']) > px(rulesFor('#modal-back')['z-index']), 'and above the modal backdrop (the old nesting bug)');
});

test('type grid and code pane have both-theme styling via tabler tokens', () => {
  const tile = rulesFor('.type-tile.sel');
  assert.ok(tile['border-color']?.includes('--tblr-primary'), 'selected tile uses the primary token');
  const code = rulesFor('.def-code');
  assert.ok(code['font-family']?.includes('--tblr-font-monospace'), 'code pane is monospace');
});

test('spaces and tables wear Lucide icons that move, picked beside their name (Feature #101)', async () => {
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
  const html = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(html.includes('vendor/lucide-moving.js') && html.includes('vendor/lucide-moving.css'), 'the set and its motion are vendored and loaded');
  assert.ok(html.indexOf('icon-registry.js') < html.indexOf('field-dialog-core.js'), 'the registry loads before the dialog core that groups on it');
  assert.ok(!html.includes('iconly-flat'), 'the Iconly file is gone');
  assert.ok(app.includes('function iconEl(') && app.includes('function iconButton('));
  // Since 2026-08-29 the one dialect is a GRID: no name beside each icon, no
  // numbered quick-select, and the search takes a category as readily as a
  // name. The rendering contract itself is asserted in a browser, in
  // test/icon-vocabulary-browser.test.mjs.
  assert.ok(app.includes('searchPicker({') && app.includes('Search by name or category…'),
    'the icon picker speaks the one dialect');
  assert.match(fnBody('iconButton'), /grid: true/, 'the table gate opens the grid');
  assert.match(fnBody('glyphPopover'), /grid: true/, 'the option and state gate opens the same grid');
  assert.ok(app.includes("iconEl(space.icon") && app.includes("iconEl(db.icon"), 'nav renders both');
  const icons = (await import('../public/vendor/lucide-moving.js'), globalThis.LUCIDE_MOVING);
  assert.ok(Object.keys(icons).length >= 555, 'the whole moving set rides along');
  assert.ok(Object.values(icons).every((v) => !/#[0-9A-Fa-f]{6}/.test(v)), 'no hardcoded fills — icons inherit currentColor');
});

test('a document that is an HTML app is embedded, not edited as markdown', () => {
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
  // The entity page mounts a frame for an HTML document (so its script runs
  // as written, in Safari too); the source editor is a toggle away and is
  // mounted on first use — an editor mounted into a hidden box stays blank.
  assert.ok(app.includes('docViewMode(f.kind'), 'the declared kind rules the viewer; docKind sniffs only the undeclared');
  const i = app.indexOf("class: 'doc-app'");
  assert.ok(i > 0, 'the embedded frame exists');
  assert.ok(app.slice(i, i + 160).includes('allowfullscreen'), 'the embedded frame permits fullscreen (Safari)');
  assert.ok(app.includes("title: 'Edit source'"), 'the source editor is one toggle away');
  assert.ok(app.includes("if (mode === 'markdown') mountEditor();"), 'the rendering editor is for markdown only');
  assert.ok(app.includes("class: 'doc-source'") && app.includes('mountSourceEditor'), 'HTML source edits in a code box, mounted on first toggle');
  assert.match(rulesFor('.doc-source')['font-family'] ?? '', /monospace/, 'the source box is monospace');
  const css = rulesFor('.doc-app');
  assert.equal(css['aspect-ratio'], '16 / 9', 'the frame has a stable 16:9 box');
  assert.equal(css.width, '100%');
});

test('expanding a document keeps the nav and breadcrumbs; the copy icon is the system one', () => {
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
  assert.ok(app.includes('function expandDocument('), 'expand exists');
  assert.ok(app.includes("title: 'Expand'"), 'it is called Expand, not fullscreen');
  assert.ok(!app.includes("title: 'View fullscreen'"), 'the old fullscreen handle is gone');
  const fn = app.slice(app.indexOf('function expandDocument('), app.indexOf('/* ---------- fullscreen viewer'));
  assert.ok(fn.includes("grid.classList.add('hidden')") && fn.includes('grid.after(wrap)'), 'it swaps the entity body in place');
  assert.ok(!fn.includes('requestFullscreen'), 'it never grabs the screen');
  assert.ok(fn.includes("e.key === 'Escape'") && fn.includes("frame.contentWindow.addEventListener('keydown'"), 'Esc collapses, from inside the frame too');
  const k = app.indexOf("title: 'Copy link to this document'");
  const copy = app.slice(k - 60, k + 200);
  assert.ok(copy.includes("'⧉'") && copy.includes('permalink-copy'), 'document copy-link uses the system ⧉');
  assert.equal(rulesFor('.doc-expand').display, 'flex');
  assert.equal(rulesFor('.doc-expand-frame')['flex'], '1');
});

/* Kyle, 2026-08-23: units vs currency on number AND formula fields; Enter
   in the date popover is "done". */
test('number costume controls: unit for plain numbers, an ISO-code picker for currency, shared with formula results', () => {
  const ctl = fnBody('numberCostumeControls');
  assert.match(ctl, /dsection\('Unit'/, 'plain numbers take a free-text unit');
  assert.match(ctl, /dsection\('Currency', pick/, 'currency takes a code through the picker dialect');
  assert.match(ctl, /fdc\.CURRENCIES/, 'codes come from the tested core list');
  const dlg = fnBody('fieldDialog');
  assert.match(dlg, /numberCostumeControls\(state, drawCfg, changed, \{ label: 'Result format' \}\)/, 'a formula result wears the same costume');
  assert.match(fnBody('editPatchConfig'), /\['format', 'unit', 'currency', 'decimals', 'separator', 'accounting'\]\) patch\[k\] = c\[k\] \?\? null/, 'currency clears like the other costume keys');
});

test('Enter in the date popover commits and closes, time kept', () => {
  const pop = fnBody('datePopover');
  assert.match(pop, /const local = readSmart\(\);[\s\S]{0,200}commit\(local, true\)/, 'Enter commits the typed stamp and closes; readTypedDate carried the time of day');
});

/* Kyle, 2026-08-23: the eyeball replaces Manage fields; the header + opens
   the add tray directly; relation is a type in the grid; files carry a
   multiple checkbox and documents a kind. */
test('the eyeball: hidden fields, system columns and deleted rows from one popover; Manage fields is gone', () => {
  const eye = fnBody('fieldVisibilityPopover');
  assert.match(eye, /hiddenFields: \[\.\.\.next\]/, 'hidden fields persist on the table');
  assert.match(eye, /systemFields: \[\.\.\.next\]/, 'system columns toggle from the same list');
  assert.match(eye, /state\.showDeleted/, 'deleted rows are a session switch');
  assert.match(fnBody('renderTable'), /const cols = visibleCols\(db\)/, 'the grid honours the hidden set');
  assert.match(fnBody('reorderField'), /const cols = visibleCols\(db\)/, 'reorder mirrors the same columns');
  assert.doesNotMatch(APP, /row\('⚙ Manage fields'/, 'the Manage fields row is gone');
  assert.doesNotMatch(fnBody('addFieldMenuButton'), /showPopover/, 'the + opens the tray, not a menu');
  assert.match(fnBody('addFieldMenuButton'), /addFieldDialog\(db\)/);
});

test('relation is a tile in the add tray and posts to /relations; files and documents carry their options', () => {
  const dlg = fnBody('fieldDialog');
  assert.match(dlg, /def\.type === 'relation'\) \{\s*await api\('POST', `\/tables\/\$\{db\.id\}\/relations`/, 'a relation tile creates through addRelation');
  assert.match(dlg, /'Target tables \(target set\)' : 'Target table', targetsBox\)/,
    'one select is the classic pair; adding more makes a target set');
  assert.match(dlg, /\+ another target table/, 'the set grows one select at a time');
  assert.match(dlg, /A target set is one-way/, 'and says out loud that no inverse is minted');
  assert.match(dlg, /fdc\.CARDINALITIES/);
  assert.match(dlg, /'Allow multiple files'/);
  assert.match(dlg, /dsection\('Kind', segCtl\(fdc\.DOCUMENT_KINDS/);
});

/* Kyle, 2026-08-23: states drag to reorder and the selector follows that
   order; no default radio — icons instead. The 'other' category this test
   also guarded was retired on 2026-08-24 with the chip system. */
test('workflow states: rows drag to reorder, icon instead of a default radio, and no fifth category', () => {
  assert.deepEqual(rulesFor('.chip.state-other'), {}, "'other' leaves no tint behind");
  const ed = fnBody('stateListEditor');
  assert.match(ed, /draggable: 'true'/);
  assert.match(ed, /fdc\.moveItem\(state\.states, dragFrom, i\)/, 'a drop reorders the states');
  // The vocabulary moved into glyphPopover when the cycle became a picker
  // (2026-08-25); the row still offers one glyph control per state.
  assert.match(ed, /glyphPopover\(/, 'an icon picker per state');
  // One catalogue since Issue #87: the marks and the flat set are picked
  // through the same control a table's icon uses.
  assert.match(fnBody('glyphPopover'), /iconCatalogue\(\)/, 'over the shared vocabulary');
  assert.match(fnBody('iconCatalogue'), /fieldDialogCore\.iconChoices/, 'which is the one catalogue');
  assert.doesNotMatch(ed, /type: 'radio'/, 'no default radio — the first state is the default');
  // A mark rides in the label text; a flat icon has to be drawn, so the chip
  // takes nodes and the picker's list keeps the string (Issue #87).
  assert.match(fnBody('stateLabel'), /`\$\{icon\} \$\{stateName\}`/, 'chips wear the mark');
  assert.match(fnBody('stateNodes'), /iconEl\(icon/, 'and draw a flat icon');
});

test('checkbox default is Unchecked / Checked, and checkboxes wear the house style (Kyle, 2026-08-23)', () => {
  assert.match(fnBody('fieldDialog'), /\{ id: 'unchecked', label: 'Unchecked' \}, \{ id: 'checked', label: 'Checked' \}/);
  const box = rulesFor('input[type="checkbox"].form-check-input');
  assert.equal(box.appearance, 'none', 'the native control is replaced');
  assert.ok(rulesFor('input[type="checkbox"].form-check-input:checked').background?.includes('--tblr-primary'), 'checked is the brand fill');
});

test('lookup / rollup pick their relation and target field from what exists; no trash button in the toolbar (Kyle, 2026-08-23)', () => {
  const dlg = fnBody('fieldDialog');
  assert.match(dlg, /dsection\('Target field', tSel\)/, 'the target field is a picker over the target table');
  assert.match(dlg, /allTables\(\)\.find\(\(d\) => d\.id === rel\.targetDbId\)/, 'its options come from the relation\'s target');
  assert.doesNotMatch(fnBody('drawDatabase'), /🗑/, 'the eyeball shows deleted rows; the toolbar badge is gone');
});

test('the view controls sit on the crumb line; the eyeball is a flat glyph with switch rows (Kyle, 2026-08-23)', () => {
  const vh = fnBody('viewHeader');
  assert.match(vh, /class: 'crumb-actions wv-toolbar' \}, \.\.\.actions\.filter\(Boolean\)/, 'actions render beside the crumb');
  assert.doesNotMatch(vh, /titleInput, \.\.\.actions/, 'and no longer on the title row');
  assert.match(fnBody('fieldVisibilityPopover'), /class: 'switch' \+ \(on \? ' on' : ''\)/, 'rows are toggle switches');
  assert.match(APP, /eye-btn', title: 'Show \/ hide fields and deleted rows', 'aria-label': 'Show or hide fields' \}, eyeGlyph\(\)\)/, 'a flat inline glyph, not an emoji');
  assert.ok(rulesFor('.switch.on').background?.includes('--tblr-primary'));
});

test('system columns are toggled only from the eye — not from the table ⋮ menu (Kyle, 2026-08-23)', () => {
  const draw = fnBody('drawDatabase');
  assert.doesNotMatch(draw, /Object\.keys\(SYSTEM_COLS\)\.map/, 'no Created At / Modified At rows in the table menu');
  assert.match(fnBody('fieldVisibilityPopover'), /Object\.keys\(SYSTEM_COLS\)\.map/);
});

/* Kyle, 2026-08-23: "if an entity has a description it should show in the
   table view of that entity." The Docs cell carries a one-line preview of
   the first document beside the 📄 toggle — the same docPreview the search
   results and cards use — so a row says what it is about without opening. */
/* Was: a 90-character snip of the FIRST document field. A row can hold
   several documents, so the snip described one of them and hid the rest.
   Now every document field is a chip carrying its name and its kind
   (test/doc-chips.test.mjs owns that behavior). */
/* And 2026-08-27, the third turn this surface has taken: the description is
   back as a preview — "the properly formatted first few lines, not an md
   document chip" — but in a COLUMN, not in the Docs cell. Both of Kyle's
   earlier rulings survive that: the row says what its description says, and
   no document stands in for the others, because the others still have their
   chips. */
/* And 2026-08-31, the fourth: the Docs cell itself retired. Every document
   field is a column of its own — the chip moved into that column, still named,
   still kind-badged (test/doc-columns.test.mjs owns the column era). */
test('every document is a column; its cell is the named chip', () => {
  const grid = fnBody('renderTable');
  assert.ok(!grid.includes("class: 'docs-cell'"), 'the shared Docs cell is gone');
  assert.ok(!APP.includes('docChips(item, db,'), 'and the multi-chip builder with it');
  assert.ok(!grid.includes("class: 'doc-snip'"), 'the one-document snip is gone');
  assert.ok(rulesFor('.doc-chip')['max-width'], 'a chip is width-capped');
});

test('the description is a column of its own, previewed and formatted (Kyle, 2026-08-27)', () => {
  const cols = fnBody('visibleCols');
  assert.ok(!/type !== 'document'/.test(cols), 'no document is filtered from the columns any more');

  const cell = fnBody('docPreviewCell');
  assert.match(cell, /WeaveEditorLib\.docPreview\(/, 'the block pass is the shared one');
  assert.match(cell, /dressTokens\(/, 'and the inline pass is the one dressedText uses');
  assert.match(cell, /inlineTokens\(/, 'there is no second inline grammar in the browser');
  assert.match(cell, /onOpen\(\)/, 'clicking opens the peek');
  assert.ok(!/replaceWith\(input\)/.test(cell), 'a document is never edited in a cell (Issue #74)');
  assert.ok(rulesFor('.doc-preview')['white-space'] === 'nowrap', 'the cell holds one line');
  assert.equal(rulesFor('.cell-pop .doc-preview')['white-space'], 'normal', 'the expansion wraps the rest');
});

/* ---------- the slash menu reads as a menu ----------
   It was a flat list of names: no grouping, no glyphs, and nothing that said
   what markdown a command writes. The rebuilt menu is grouped, every row shows
   its syntax on the right, and a query promotes its best matches to the top
   instead of filtering the catalogue away. */

test('the slash menu is grouped, glyphed and shows the syntax it writes', () => {
  assert.match(APP, /const SLASH_GROUPS = \[/, 'the groups are declared once');
  for (const title of ['ALL COMMANDS', 'REFERENCE', 'FORMAT · APPLIES TO SELECTION']) {
    assert.ok(APP.includes(title), `missing group: ${title}`);
  }
  const hint = fnBody('slashHint');
  assert.match(hint, /slash-group/, 'a group header rides on the first row of its group');
  assert.match(hint, /slash-icon/, 'every row carries a glyph');
  assert.match(hint, /slash-syntax/, 'and the markdown it writes');
  assert.match(hint, /escapeHtmlText\(/, 'the row is innerHTML, so its parts are escaped');

  // The highlight belongs to the row, not to the button that carries the group
  // header — otherwise picking through the list lights up the group titles.
  for (const sel of ['.vditor-hint button:hover', '.vditor-hint button.vditor-hint--current']) {
    assert.equal(rulesFor(sel)['background-color'], 'transparent', `${sel} must not paint the group header`);
  }
  for (const sel of ['.vditor-hint button:hover .slash-item', '.vditor-hint button.vditor-hint--current .slash-item']) {
    assert.ok(rulesFor(sel).background, `${sel} is what gets the highlight`);
  }
  assert.equal(rulesFor('.slash-syntax')['margin-left'], 'auto', 'the syntax column sits on the right of every row');
  assert.ok(rulesFor('.vditor-hint')['overflow-y'], 'a twenty-row menu has to scroll');
});

test('a query promotes matches instead of emptying the menu', () => {
  const rows = fnBody('slashRows');
  assert.match(rows, /'INSERT'/, 'best matches lead under their own heading');
  assert.match(rows, /r\.score >= 70/, 'only strong matches are promoted');
  assert.match(rows, /promoted\.has\(item\)/, 'a promoted row is not repeated in its group');
  assert.match(rows, /SLASH_PROMOTED/, 'and the promoted set is capped');
  const score = fnBody('slashScore');
  assert.match(score, /startsWith/, 'a prefix is the strongest match');
  assert.match(score, /aliases/, 'aliases are what make /h4 and /todo work');
});

test('formatting wraps the selection the writer had before typing "/"', () => {
  assert.match(APP, /const SELECTION_MEMORY_MS = \d+;/, 'the memory is bounded');
  const remember = fnBody('rememberSelection');
  assert.match(remember, /isCollapsed/, 'only a real selection is remembered');
  assert.match(remember, /if \(text\)/, 'and the collapsed selection left by "/" must not erase it');
  assert.match(fnBody('selectionForFormat'), /Date\.now\(\) - lastSelection\.at < SELECTION_MEMORY_MS/,
    'a stale selection is not what this "/" is about');
  assert.match(fnBody('slashItems'), /const picked = selectionForFormat\(\);/,
    'the format rows are built around it');
});

test('a command that Vditor cannot insert finishes itself', () => {
  // Raw HTML measured live: inserted through the hint it produced an empty
  // document; written as a whole document it round-trips untouched.
  assert.match(APP, /const DEFERRED_INSERTS = \{/, 'the deferred inserts are declared once');
  const mount = fnBody('mountDocEditor');
  assert.match(mount, /queueMicrotask\(\(\) => \{/, 'the swap is a microtask');
  assert.doesNotMatch(mount.slice(mount.indexOf('DEFERRED_INSERTS')), /setTimeout|requestAnimationFrame/,
    'not a timer or a frame — both are throttled in a backgrounded page');
  assert.match(APP, /REF_MARKER_RE/, 'references travel the same way, through their own marker');
});

/* ---------- the editor stops indenting the document ----------
   Vditor writes `padding: 10px 35px` inline on the writing surface — a gutter
   it reserves for the heading-level badges weave removes — so every document
   sat 35px in from its own section head. Measured before the fix: section head
   at x=320, first paragraph at x=355. Inline styles only yield to !important. */

test('a document starts where its section starts', () => {
  assert.match(rulesFor('.doc-editor .vditor-ir pre.vditor-reset').padding ?? '', /0\s*!important/,
    'the reserved gutter has to be overridden, not merely set');
});

/* ---------- flat icons, never emoji ----------
   An emoji is a colour picture: it ignores the text colour, ignores the theme,
   and renders differently on every platform. weave has a vendored flat set
   that inherits currentColor, and the chrome uses it. */

test('the chrome carries flat icons rather than emoji', () => {
  const emoji = /[\u{1F300}-\u{1FAFF}\u{FE0F}]/u;
  const offenders = APP.split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => emoji.test(line));
  assert.deepEqual(offenders, [], `emoji left in the UI: ${offenders.map(([n]) => n).join(', ')}`);
  assert.match(fnBody('slashGlyph'), /ICONLY_FLAT/, 'the slash menu draws the vendored flat set');
  assert.match(APP, /SLASH_LINK_GLYPH/, 'and hand-draws the one glyph the set is missing');
  assert.ok(rulesFor('.slash-icon svg').fill, 'a flat icon inherits the row colour');
});

/* ---------- a reference chip has to cover the reference ----------
   `a.mention` sets a transparent tint and outranks a plain `.doc-ref-chip`, so
   the literal `[[Table#12|Name]]` showed straight through the chip that was
   meant to hide it — measured: computed background rgba(6,111,209,.08). */

test('a reference chip has an opaque ground', () => {
  assert.ok(rulesFor('.doc-ref-layer a.doc-ref-chip').background,
    'the chip must beat a.mention on its own terms');
});

/* ---------- # is the entity search ----------
   Referencing a record was two steps: the /entity command, then a dialog to
   search in. The caret is already where the reference goes, so the document is
   the search box: # filters records under it, ↑/↓ move, Enter drops the
   reference in and the chip layer turns it into a chip. */

test('# searches entities inline, and a heading is still a heading', () => {
  assert.match(APP, /\{ key: '#', hint: entityHint \}/, "the '#' trigger is registered with the editor");
  const hint = fnBody('entityHint');
  assert.match(hint, /ENTITY_HINT_MIN/, 'a lone # is not a search');
  assert.match(APP, /const ENTITY_HINT_MIN = 2;/, 'two characters — "# Heading" must never open one');
  assert.match(hint, /kind === 'entity'/, 'only records can be the target of a reference');
  assert.match(hint, /entityReference\(hit\)/, 'picking one writes the same reference the menu writes');
  assert.match(hint, /entityHintCache/, 'a keystroke that was already asked is not asked again');
});

/* ---------- editor: line break, table keys, editable fullscreen
   (Kyle, 2026-08-23) ---------- */

test('the slash menu has a Line break that inserts a hard break, not a code block', () => {
  const items = APP.slice(APP.indexOf('function slashItems'), APP.indexOf('function slashScore'));
  assert.match(items, /label: 'Line break'/, '/line finds it by name');
  assert.match(items, /aliases: \['br', 'newline', 'return'\]/, 'and by its aliases');
  const item = items.match(/label: 'Line break'.*insert: '((?:[^'\\]|\\.)*)'/);
  assert.ok(item, 'it inserts');
  assert.equal(item[1], '\\\\\\n', 'the insert is a backslash hard break — markdown, not HTML, not a fence');
});

test('table keys: Enter adds a row, Shift+Enter removes an empty one, Tab at the end grows the table', () => {
  // Vditor already owns cell navigation (Tab/Shift+Tab) and the chorded ops
  // (⌘= row, ⇧⌘= column, ⌘- / ⇧⌘- delete). weave adds the unchorded flow on
  // top by REPLAYING the chords, so there is exactly one implementation of
  // every table operation — Vditor's.
  assert.match(APP, /function tableCellOf/, 'one caret-in-table test');
  const fn = fnBody('attachTableKeys');
  assert.match(fn, /e\.key === 'Enter' && !e\.shiftKey/, 'Enter…');
  assert.match(fn, /replayChord\(host, '='\)/, '…replays ⌘= (row below)');
  assert.match(fn, /e\.key === 'Enter' && e\.shiftKey/, 'Shift+Enter…');
  assert.match(fn, /rowIsEmpty\(/, '…only on an empty row…');
  assert.match(fn, /replayChord\(host, '-'\)/, '…replays ⌘- (delete row)');
  assert.match(fn, /e\.key === 'Tab' && !e\.shiftKey/, 'Tab…');
  assert.match(fn, /lastCell/, '…in the last cell grows the table before Vditor moves the caret');
  assert.match(fn, /\{ capture: true \}/, 'ahead of Vditor\'s own handler');
  assert.match(APP, /metaKey: mac, ctrlKey: !mac/,
    'the replayed chord sets exactly the platform modifier — Vditor rejects meta+ctrl together');
  assert.match(fnBody('mountDocEditor'), /attachTableKeys\(host\)/, 'wired wherever a document editor mounts');
});

test('fullscreen edits: a markdown document expands as its own live editor, not a rendered frame', () => {
  const fn = fnBody('expandDocument');
  assert.match(fn, /\{ node = null \} = \{\}/, 'the expander accepts the live editor node');
  assert.match(fn, /node \?\? frame/, 'the node takes the frame\'s place');
  assert.match(fn, /origin\.append\(node\)/, 'and goes home on collapse — same editor, nothing to sync');
  assert.match(fn, /node \? null :/, 'frame-only chrome (reload, open-in-tab) hides for a live editor');
  const body = fnBody('renderEntityView');
  assert.match(body, /expandDocument\(grid, `\$\{fmtBase\}\.html`, f\.name, isApp \? \{\} : \{ node: host \}\)/,
    'the ⛶ hands the editor over for markdown; an HTML app keeps its frame');
});

test('the divider inserts *** — an inserted --- pair is YAML front matter to Lute', () => {
  const items = APP.slice(APP.indexOf('function slashItems'), APP.indexOf('function slashScore'));
  const item = items.match(/label: 'Divider'.*insert: '((?:[^'\\]|\\.)*)'/);
  assert.ok(item, 'the Divider item exists');
  assert.equal(item[1], '\\n***\\n', 'thematic break, unambiguous spelling');
  assert.doesNotMatch(items, /insert: '\\n---\\n'/, 'the front-matter spelling is gone');
});

test('the slash menu clamps into the viewport instead of hiding its promoted row', () => {
  assert.match(fnBody('mountDocEditor'), /attachHintClamp\(host\)/, 'wired at mount');
  const fn = fnBody('attachHintClamp');
  assert.match(fn, /maxHeight/, 'tall menus scroll');
  assert.match(fn, /top < 8/, 'a menu that overflows the top is pushed back down');
});

test('the slash link glyph is the interlocked chain, not the hand-drawn arcs', () => {
  assert.match(APP, /M10 13a5 5 0 0 0 7\.54\.54/, "Feather's link path");
  assert.doesNotMatch(APP, /M10 13\.5a4 4 0 0 0 5\.7\.4/, 'the old approximation is gone');
});

/* Kyle, 2026-08-24: the view of tables within a space and the view of spaces
   within a workspace are not hand-rolled lists — they ARE the registry grids,
   with all their fields, and opening a row opens the space or table it
   stands for. */

test('the space page renders the Tables registry as a real grid', () => {
  const body = fnBody('showSpace');
  assert.match(body, /registryTable\('tables'\)/, 'the space page finds the Tables registry');
  assert.match(body, /renderTable\(/, 'and renders it with the one grid renderer');
  assert.doesNotMatch(body, /space-table-row/, 'the hand-rolled table list is gone');
});

test('the workspace page renders the Spaces registry as a real grid', () => {
  const body = fnBody('showHome');
  assert.match(body, /registryTable\('spaces'\)/, 'the workspace page finds the Spaces registry');
  assert.match(body, /renderTable\(/, 'and renders it with the one grid renderer');
});

test('opening a registry row opens the structure it stands for', () => {
  const body = fnBody('registryHref');
  assert.match(body, /#\/table\/\$\{/, 'a Tables row opens the table');
  assert.match(body, /#\/space\/\$\{/, 'a Spaces row opens the space');
  assert.match(body, /sysId/, 'navigation uses the row sysId, not a name match');
  const grid = fnBody('renderTable');
  assert.match(grid, /openRegistryRow/, 'the grid routes row clicks through it');
  assert.match(grid, /registryHref\(db, item\) \?\? `#\/entity\//,
    'the #N open link is the same affordance: structure for registry rows, entity page otherwise');
});

/* Universal reference rule (Kyle, 2026-08-24): surfaces reference entities by
   id, never by name. Renames must not strand a link or mis-scope a view. */

test('the space page scopes its registry grid by id, not by name', () => {
  const body = fnBody('showSpace');
  assert.match(body, /item\.sysId|i\.sysId/, 'rows are matched to the space through sysId');
  assert.doesNotMatch(body, /\.name === space\.space/, 'no name-join — two names can drift, ids cannot');
});

test('workspace links and rename use the workspace id permalink', () => {
  const home = fnBody('showHome');
  assert.match(home, /\/w\/\$\{updated\.id\}\//, 'a rename lands on the id URL, which the rename cannot break');
  assert.doesNotMatch(home, /\/w\/\$\{updated\.name\}\//, 'never the name URL');
  const rail = fnBody('buildWsRail');
  assert.match(rail, /w\.url|\/w\/\$\{w\.id\}\//, 'the rail links workspaces by id');
  assert.match(rail, /w\.id === seg|seg === w\.id|\.id === seg/, 'the current workspace matches by id or name segment');
});

/* ---------- the entity dock (one entity surface, change 2) ----------
   The #id link docks the entity BESIDE the table; the rules live in
   public/entity-surface-core.js (its own suite) and app.js paints them.
   These gates pin the wiring a browser is not needed for. */

test('dock: the surface core loads before app.js and #dock is a sibling of #main', () => {
  const html = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
  const core = html.indexOf('entity-surface-core.js');
  assert.ok(core > -1 && core < html.indexOf('"/app.js"'), 'entity-surface-core.js must load before app.js');
  const main = html.indexOf('<main id="main">');
  const mainEnd = html.indexOf('</main>', main);
  const dock = html.indexOf('<aside id="dock" hidden>');
  assert.ok(main > -1 && dock > mainEnd, '#dock sits after </main>, never inside it — a page render must not wipe a docked entity');
  assert.ok(dock < html.indexOf('<script'), 'the panel is page shell, declared before the scripts');
  assert.match(html, /<aside id="dock" hidden>/, 'the dock starts hidden');
});

test('dock: a route change tears the dock down with the doc editors, before the new page paints', () => {
  const route = fnBody('renderRoute');
  assert.match(route, /teardownDocEditors\(\);[\s\S]{0,120}dockClose\(\);/, 'renderRoute closes the dock right after the editor teardown');
  assert.ok(route.indexOf('dockClose()') < route.indexOf('location.hash'), 'and before it reads the destination');
});

test('dock: Escape defers to every overlay app.js can raise', () => {
  const m = APP.match(/const DOCK_ESC_OWNERS = '([^']+)'/);
  assert.ok(m, 'the dock names its Escape owners in one selector');
  const owners = m[1].split(',').map((s) => s.trim());
  // Every backdrop (id: 'x-back') and every popover (class: 'x-pop') in the
  // source owns Escape while it is up; a new one has to join the list.
  const backs = [...new Set([...APP.matchAll(/id: '([a-z]+-back)'/g)].map((x) => `#${x[1]}`))];
  const pops = [...new Set([...APP.matchAll(/class: '([a-z]+-pop)'/g)].map((x) => `.${x[1]}`))];
  assert.ok(backs.length >= 5 && pops.length >= 3, `the derivation found ${backs.length} backdrops and ${pops.length} popovers`);
  for (const sel of [...backs, ...pops]) assert.ok(owners.includes(sel), `${sel} owns Escape but the dock does not defer to it`);
  assert.ok(owners.includes('.doc-rail.open'), 'an open document outline owns Escape too');
  const esc = APP.match(/if \(e\.key !== 'Escape' \|\| !dock\) return;[\s\S]{0,400}?\}\);/)[0];
  assert.match(esc, /closest\?\.\('input, textarea, select, \[contenteditable\]'\)/, 'a focused editor keeps its Escape');
  assert.match(esc, /weaveEntitySurface\.escape\(dock\.state\)/, 'the pop itself is the core rule, not a hand-rolled one');
});

test('dock: a repaint releases what the last pass mounted, and the docked row takes its light back', () => {
  const draw = fnBody('drawDock');
  assert.ok(draw.indexOf('releaseDockPanel()') < draw.indexOf('panel.replaceChildren('), 'release before replaceChildren, same discipline as the peek');
  assert.match(draw, /editors: dock\.editors/, 'the dock owns its editors so the scoped teardown can find them');
  assert.match(draw, /inPeek: true/, 'the dock renders the entity in its narrow pose');
  assert.match(draw, /markDockedRow\(\);\s*\}\s*$/, 'the light is re-marked after every paint');
  const grid = APP.match(/function renderTable\([^]*?\n\}\n/)[0];
  assert.match(grid, /requestAnimationFrame\(\(\) => markClippedCells\(table\)\);[\s\S]{0,200}markDockedRow\(\);/, 'a grid redraw re-marks the docked row');
  const mark = fnBody('markDockedRow');
  assert.match(mark, /weaveEntitySurface\.selectionId\(dock\.state\)/, 'which row is lit is the core\'s selection rule');
  const close = fnBody('dockClose');
  assert.match(close, /releaseDockPanel\(\);[\s\S]*panel\.hidden = true;[\s\S]*dock = null;[\s\S]*markDockedRow\(\);/, 'close releases, hides, forgets, and puts the light out');
});

test('dock: the #id link docks plain rows only; registry rows and modified clicks keep the href', () => {
  const grid = APP.match(/function renderTable\([^]*?\n\}\n/)[0];
  const link = grid.match(/class: 'open-link',[\s\S]*?`#\$\{item\.publicId\} ↗`/)[0];
  assert.match(link, /if \(e\.metaKey \|\| e\.ctrlKey \|\| e\.shiftKey \|\| registryHref\(db, item\)\) return;/, 'a modifier or a registry row falls through to the real href');
  assert.match(link, /e\.preventDefault\(\);\s*dockEntity\(db, item\.id\);/, 'a plain click docks');
  assert.match(link, /`Open \$\{db\.term\.singular\} beside the table — ⌘-click for a new tab`/, 'the title speaks the row term (row-term work) and names both gestures');
  assert.match(grid, /if \(!openRegistryRow\(db, item\)\) window\.open\(`\$\{location\.pathname\}#\/entity\/\$\{item\.id\}`, '_blank'\);/, '⌘-click on the row opens a tab, registry rows aside');
  const dockFn = fnBody('dockEntity');
  assert.match(dockFn, /dock && dock\.db\.id === db\.id\s*\?\s*S\.open\(dock\.state, frame\)/, 'a second open in the same table keeps the pane state');
  assert.match(dockFn, /S\.init\(\{ tableId: db\.id, tableName: db\.name \}\)/, 'a different table re-anchors');
});

test('dock: the panel is styled as the table\'s twin, sticky, and lights its row in both themes', () => {
  const rule = CSS.match(/^#dock \{[^}]+\}/m)?.[0];
  assert.ok(rule, '#dock has a rule');
  for (const decl of ['background: var(--tblr-bg-surface)', 'box-shadow: var(--wv-panel-shadow)', 'border-radius: 16px', 'position: sticky', 'top: 8px', 'align-self: flex-start', 'overflow-y: auto'])
    assert.ok(rule.includes(decl), `#dock lacks ${decl}`);
  assert.doesNotMatch(rule, /display:/, 'no display of its own, so the hidden attribute keeps working');
  const light = CSS.match(/tr\.entity-row\.row-docked td \{[^}]+\}/)?.[0];
  assert.ok(light, 'the docked row has a light');
  assert.match(light, /var\(--tblr-active-bg/, 'the light is a theme token, so dark mode gets its own tint');
  assert.match(CSS, /#dock \.dock-entity \.entity-grid \{ grid-template-columns: 1fr; \}/, 'the field grid single-columns in the narrow pane');
});

test('dock: the Handbook ledger page teaches the new contract', () => {
  const hb = readFileSync(join(ROOT, 'src/handbook.js'), 'utf8');
  const section = hb.slice(hb.indexOf('## The grid reads as a record'), hb.indexOf('## Working on many rows at once'));
  assert.match(section, /link opens the row in the \*\*dock\*\* beside the table/);
  assert.match(section, /⌘-click a row .* own browser tab/);
  assert.match(section, /side peek/, 'the peek still exists for doc chips and says so');
  assert.doesNotMatch(section, /⌘-click opens a row in the \*\*side peek\*\*/, 'the retired ⌘-click-peeks contract is gone from the page');
});

/* ---------- Feature #168: the Name field is configurable ----------
   Rename it, make it a formula, never delete it. The UI reads the role the
   schema marks (`role: 'name'`), never the label. */
test('the Name field is role-keyed in the UI and opens to rename and ƒ', () => {
  assert.equal((APP.match(/\.name (===|!==) 'Name'/g) ?? []).length, 1, 'the only literal read is the pre-role fallback inside nameFieldOf');
  assert.match(APP, /function nameFieldOf\(/);
  assert.doesNotMatch(APP, /disabled: isEdit && existing\.name === 'Name'/, 'the Name field renames like any other');
  assert.match(APP, /disabled: isEdit && !\['text', 'formula'\]\.includes\(existing\.type\) \? '' : undefined/, 'the ƒ toggle opens for text and formula fields on edit');
  assert.match(APP, /existing\.role === 'name'\) choices = choices\.filter/, 'a name\'s type grid offers text only; ƒ is the other shape');
  assert.match(fnBody('renderEntityView'), /readonly: computed \? '' : undefined/, 'a computed name is read-only on the entity page');
  assert.match(fnBody('renderEntityView'), /\[nameF\?\.name \?\? 'Name'\]: nameInput\.value/, 'a renamed name patches by its label');
  assert.match(fnBody('quickCreate'), /if \(computedName\(db\)\)/, 'quick-create skips the name prompt for a computed name');
  assert.match(APP, /\(!isEdit \|\| \['text', 'formula'\]\.includes\(existing\.type\)\) \? fx : ''/, 'the ƒ toggle is drawn on edit for text and formula fields, not only for formulas');
});
