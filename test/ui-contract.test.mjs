import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, APP, HTML, CSS, rulesFor, px, fnBody } from './lib/source.mjs';


test('#ws-rail carries a positive z-index so the expand chevron stays clickable', () => {
  const rail = rulesFor('#ws-rail');
  assert.ok(['relative', 'sticky'].includes(rail.position), `rail is positioned — with its z-index it is a stacking context, got ${rail.position}`);
  assert.ok(rail['z-index'], '#ws-rail must declare a z-index or #main paints over #nav-expand');
  assert.ok(px(rail['z-index']) > 0, `#ws-rail z-index must be > 0, got ${rail['z-index']}`);
});

test('#nav-expand paints inside the rail stacking context, not above it', () => {
  const rail = px(rulesFor('#ws-rail')['z-index']);
  const expand = rulesFor('#nav-expand');
  assert.equal(expand.position, 'fixed');
  assert.ok(px(expand.left) >= px(rulesFor('#ws-rail').width), 'chevron overhangs the rail');
  assert.ok(rail >= px(expand['z-index'] ?? 0) || rail > 0);
});

test('the first rail chip is centred on the sidebar wordmark', () => {
  const sidebarPadTop = px(rulesFor('#sidebar').padding.split(/\s+/)[0]);
  const wordmark = px(rulesFor('.ws-wordmark')['line-height']);
  const chip = px(rulesFor('.ws-icon.ws-weave').height);
  const railPadTop = rulesFor('#ws-rail').padding.match(/calc\(([^)]*)\)/)?.[1];
  assert.ok(railPadTop, '#ws-rail top padding must be derived, not a bare constant');
  const terms = railPadTop.match(/[\d.]+/g).map(Number);
  assert.deepEqual(terms, [sidebarPadTop, wordmark, 2, chip, 2],
    'rail padding must be built from the sidebar padding, wordmark and chip sizes');
  const railPad = terms[0] + wordmark / 2 - chip / 2;
  assert.equal(railPad + chip / 2, sidebarPadTop + wordmark / 2, 'centrelines must coincide');
  assert.equal(rulesFor('.ws-icon')['flex-shrink'], '0');
});

test('an unavailable trash count cannot stop a table from rendering', () => {
  assert.match(APP, /api\('GET', `\/tables\/\$\{db\.id\}\/trash`\)\.catch\(\(\) => \(\{ total: 0, items: \[\] \}\)\)/);
});

test('.hidden beats id-selector display rules', () => {
  assert.match(rulesFor('.hidden').display ?? '', /none\s*!important/);
});

test('wireNavCollapse wires both directions and persists the state', () => {
  const fn = APP.slice(APP.indexOf('function wireNavCollapse'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
  assert.match(body, /collapse\.addEventListener\('click',\s*\(\)\s*=>\s*\(narrowShell\.matches \? app\.classList\.remove\('nav-peek'\) : apply\(true\)\)\)/);
  assert.match(body, /expand\.addEventListener\('click',\s*\(\)\s*=>\s*apply\(false\)\)/);
  assert.match(body, /localStorage\.setItem\('weave-nav-collapsed'/);
  assert.match(body, /localStorage\.getItem\('weave-nav-collapsed'\)/);
});

const PICKER_TYPES = ['select', 'multiselect', 'workflow'];

test('picker-type cells are tagged so the row handler can route clicks', () => {
  assert.match(APP, /const PICKER_FIELD_TYPES = \[([^\]]*)\]/);
  const listed = APP.match(/const PICKER_FIELD_TYPES = \[([^\]]*)\]/)[1];
  for (const t of PICKER_TYPES) assert.ok(listed.includes(`'${t}'`), `${t} must be a picker type`);
  assert.match(APP, /cell-pick/, 'picker cells need the cell-pick class');
});

test('related rows still route a click before opening the entity', () => {
  const routed = [...APP.matchAll(/const pick = rowClickTarget\(e\);\s*\n\s*if \(pick === 'ignore'\) return;\s*\n\s*if \(pick\) return openCellPicker\(pick\);\s*\n\s*(?:if \(openRegistryRow\(db, item\)\) return;\s*\n\s*)?openEntity\(/g)];
  assert.equal(routed.length, 1, 'embedded related rows route clicks; the grid edits in place');
  assert.equal((APP.match(/openEntity\(item\.id\)/g) ?? []).length, routed.length,
    'no row surface may open the entity without routing first');
  assert.equal((APP.match(/peekEntity\(item\.id\)/g) ?? []).length, 0,
    'the grid no longer peeks — the #id link docks and ⌘-click opens a tab (one entity surface)');
  assert.match(APP, /docChipCell\(f, item, \(\) => dockEntity\(db, id, \{ step: true \}\)\)/,
    'and a doc chip docks its entity from the cell (Issue #74; peek excised 2026-09-02)');
  assert.match(APP, /function rowClickTarget/);
  assert.match(APP, /function openCellPicker/);
  const fn = APP.slice(APP.indexOf('function openCellPicker'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
  assert.match(body, /\.chip-trigger/, 'chip pickers open by clicking their trigger');
  assert.match(body, /showPicker/, 'native <select> cells open their own dropdown');
});

test('in the grid every cell advertises that it edits', () => {
  assert.ok(rulesFor('.wv-grid tbody td').cursor, 'the grid body is one big edit target');
  assert.deepEqual(rulesFor('.wv-grid td.cell-pick'), {}, 'picker cells need no separate affordance');
});

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
  assert.match(APP, /computedMark/);
});

test('the # column shrinks to its content and is left-aligned', () => {
  const pid = rulesFor('.wv-grid td.pid-cell');
  assert.ok(Object.keys(pid).length, '.wv-grid td.pid-cell must be styled');
  assert.equal(pid.width, '1%', 'width:1% collapses the column to its content');
  assert.equal(pid['white-space'], 'nowrap');
  assert.equal(pid['text-align'], 'left');
  assert.equal(rulesFor('.wv-grid th.pid-head').width, '1%');
  assert.match(APP, /class: 'pid-cell'/);
  assert.doesNotMatch(APP, /el\('td', \{ class: 'num' \},\s*\n\s*el\('a', \{ class: 'open-link'/);
});

test('table view moves both create controls into the grid', () => {
  assert.ok(!APP.includes("state.route.view === 'table'"), 'no view guards remain — the grid is the view');
  assert.match(APP, /class: 'add-field-head'/, 'header bar ends with the field "+" cell');
  assert.match(APP, /function addFieldMenuButton/);
  assert.match(APP, /class: 'add-entity-row'/, 'the grid ends with the new-entity row');
  assert.doesNotMatch(APP, /add-row-bar/);
  assert.doesNotMatch(CSS, /add-row-bar/);
});

test('the field "+" opens the add tray directly — relation is a grid tile, Manage fields is the eyeball', () => {
  const fn = APP.slice(APP.indexOf('function addFieldMenuButton'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
  assert.match(body, /addFieldDialog\(db\)/);
  assert.doesNotMatch(body, /showPopover/);
});

test('one vocabulary for creating a field: every control that opens the tray says New field', () => {
  const made = 'field|table|space|workspace|view|row|record';
  const drift = [...APP.matchAll(new RegExp(`'Add (?:a |an )?(?:${made})s?'`, 'gi'))].map((m) => m[0]);
  assert.deepEqual(drift, [], 'a thing being made is New; Add only attaches one that exists');
  assert.match(APP, /class: 'add-field-btn', type: 'button', title: 'New field'/,
    'the plus at the end of the field headers carries the one name');
  assert.match(APP, /class: 'chip-pop-row table-filter-add-field'[\s\S]{0,200}'New field'/,
    'so does the row the Filters popover offers');
  assert.match(APP, /class: 'chip-pop-row fields-add'[\s\S]{0,200}'New field'/,
    'so does the row the fields popover offers');
  assert.match(APP, /tray\(isEdit \? `Edit \$\{existing\.name\}` : 'New field'/,
    'and so does the tray all three of them open');
});

test('full-width grid rows derive their span from one column count', () => {
  assert.match(APP, /const colCount = cols\.length \+ 3;/, 'the table view derives it once');
  assert.match(APP, /const colCount = cols\.length \+ 2;/, 'so does the embedded related grid, from its own columns');
  assert.doesNotMatch(APP, /colspan: String\(cols\.length/, 'never restated at a use site');
  assert.equal((APP.match(/colspan: String\(colCount\)/g) ?? []).length, 4,
    'the table view\'s spacer rows (one builder), its pending row and its new-entity row, plus the related grid\'s add row');
});

test('grid create controls are styled', () => {
  assert.equal(rulesFor('.wv-grid th.add-field-head').width, undefined, 'the "+" cell has no width of its own: it trails the last field (Feature #240)');
  assert.ok(rulesFor('.add-field-btn').cursor);
  assert.ok(rulesFor('.add-entity-btn').width, 'the new-entity row spans the grid');
});

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
  assert.ok((APP.match(/showPopover\(/g) ?? []).length >= 3, 'definition + at least two callers');
  assert.equal((APP.match(/class: 'chip-pop'/g) ?? []).length, 1,
    'only showPopover may build a .chip-pop — no second implementation');
});

test('popover options are keyboard navigable', () => {
  const fn = APP.slice(APP.indexOf('function showPopover'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
  assert.match(body, /ArrowDown/);
  assert.match(body, /ArrowUp/);
  assert.match(body, /\.focus\(\)/, 'opening must move focus into the popover');
  assert.match(body, /chip-pop-check/, 'focus opens on the current value when there is one');
  assert.match(body, /ev\.key === 'Tab'/, 'Tab must close and carry on along the row');
  assert.match(body, /trigger\.focus\(\)/, 'Escape must hand focus back to the trigger');
});

test('focus survives the redraw a pick causes', () => {
  assert.match(APP, /state\.refocus/);
  assert.match(APP, /function restoreGridFocus/);
  assert.match(APP, /await keepScroll\(\(\) => drawDatabase\(db, fresh, trashCount, pager\)\);\s*\n\s*restoreGridFocus\(\{ now: true \}\);/);
  assert.match(APP, /refocus: null/, 'state must declare the slot');
});

test('every grid redraw remembers where focus was before it runs (Issue #83)', () => {
  assert.match(APP, /function rememberGridFocus/);
  const saves = [...APP.matchAll(/const onSaved = async \([^)]*\) => \{\n([\s\S]{0,400}?)rememberGridFocus\(\);/g)];
  assert.ok(saves.length >= 3, `expected the three grid pages, found ${saves.length}`);
  for (const [, before] of saves) {
    assert.doesNotMatch(before, /drawDatabase|renderTable|pager\.refresh/, 'nothing is drawn before focus is remembered');
  }
});

test('the focused popover row is as visible as the hovered one', () => {
  assert.ok(rulesFor('.chip-pop-row:focus').background, 'focus must be styled, not only hover');
  assert.equal(rulesFor('.chip-pop-row:focus-visible')['outline-offset'], '-2px');
});

test('no window.confirm anywhere in the UI', () => {
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
  const rest = rulesFor('.hold-fill');
  assert.equal(rest.transition, 'transform 0s');
  assert.equal(rest.transform, 'scaleX(0)');
  assert.equal(rest['transform-origin'], 'left', 'the sweep must start at the left edge');
  assert.match(rulesFor('.hold-btn.holding .hold-fill').transition, /transform \.\ds linear/);
  assert.doesNotMatch(rest.transition, /width|height|padding|margin/, 'no layout-property animation');
  assert.equal(rulesFor('.hold-btn').overflow, 'hidden', 'the fill must be clipped to the button');
});

test('destructive actions use it', () => {
  const uses = (APP.match(/holdToConfirm\(/g) ?? []).length - 1;
  assert.ok(uses >= 2, `expected at least two hold-to-confirm call sites, found ${uses}`);
});

test('the overflow menu is a vertical ellipsis', () => {
  assert.match(APP, /dots-btn.*lucide:ellipsis-vertical/s, 'the glyph is the inventory\'s vertical ellipsis');
  assert.doesNotMatch(APP, /'⋯'/, 'no horizontal ellipsis left behind');
  assert.ok(rulesFor('.dots-btn').padding, 'the vertical glyph needs its own button metrics');
});

test('the entity menu moves to trash with an undo, not a hold-to-confirm', () => {
  assert.match(APP, /'Move to trash'/);
  assert.doesNotMatch(APP, /holdToConfirm\('Delete entity'/,
    'a recoverable delete must not demand a hold');
  assert.match(APP, /label: 'Undo'[\s\S]{0,200}\/restore/, 'the toast must offer restore');
  assert.match(APP, /function toast\(msg, isErr = false, action = null(, \{ kind \} = \{\})?\)/,
    'every caller keeps the (msg, isErr, action) shape (Issue #380 added an optional kind)');
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
  assert.doesNotMatch(fnBody('tableChrome'), /#\/trash\//, 'nor on the chrome built once per table (Issue #444)');
  assert.match(fnBody('readAndDrawTable'), /trashCount: true/, 'the count still feeds the eyeball');
  assert.match(fnBody('readAndDrawTable'), /showDeleted\s*\?\s*api\('GET', `\/tables\/\$\{db\.id\}\/trash`\)/,
    'the trash list is fetched only when deleted rows are shown');
  assert.match(fnBody('fieldVisibilityPopover'), /Deleted \$\{cur\.term\.plural\}/, 'the toggle speaks the table\'s row term');
});

test('the description block is compact', () => {
  const desc = rulesFor('.view-desc');
  const edit = rulesFor('.view-desc-edit');
  assert.ok(px(desc['margin-top']) <= 3, `view-desc margin-top too large: ${desc['margin-top']}`);
  assert.ok(px(desc['font-size']) <= 12.5, `view-desc font-size too large: ${desc['font-size']}`);
  assert.ok(px(edit['min-height']) <= 40, `editor min-height too large: ${edit['min-height']}`);
  assert.ok(px(edit.padding) <= 4, `editor padding too large: ${edit.padding}`);
  const floor = Number(APP.match(/Math\.max\((\d+), ta\.scrollHeight\)/)?.[1]);
  assert.equal(floor, px(edit['min-height']), 'autosize floor must match CSS min-height');
});

test('the description clamp is five description line-heights, toggled by a control the editor ignores', () => {
  const desc = rulesFor('.view-desc');
  const clamped = rulesFor('.view-desc-body.clamped');
  assert.equal(clamped.overflow, 'hidden');
  const m = clamped['max-height']?.match(/calc\((\d+) \* ([\d.]+)em\)/);
  assert.ok(m, `max-height is calc(<lines> * <line-height>em), got ${clamped['max-height']}`);
  assert.equal(Number(m[1]), 5, 'five lines');
  assert.equal(m[2], desc['line-height'], 'in the description\'s own line-height');
  const vh = fnBody('viewHeader');
  assert.match(vh, /class: 'view-desc-body wv-prose clamped'/, 'the rendered markdown has its own body element, born clamped');
  assert.match(vh, /class: 'view-desc-more'/, 'the Show more control exists');
  assert.match(vh, /closest\('a,textarea,button'\)/, 'a click on the control does not start an edit');
  assert.ok(rulesFor('.view-desc-more').cursor, 'the control reads as clickable');
});

test('one dotsMenu implementation serves entity, table and space', () => {
  assert.match(APP, /function dotsMenu\(/);
  assert.equal((APP.match(/dots-btn/g) ?? []).length, 1, 'only dotsMenu may build the ⋮ button');
  assert.equal((APP.match(/class: `dl-menu hidden/g) ?? []).length, 1, 'only dotsMenu may build the panel');
  for (const t of ["title: `${WeaveTerm.cap(termOfTable(entity.dbId).singular)} actions`", "title: 'Table actions'", "title: 'Space actions'"]) {
    assert.ok(APP.includes(t), `${t} must be a dotsMenu call`);
  }
});

test('the table menu carries CSV export; table and space menus carry delete', () => {
  assert.ok(APP.includes("label: 'Export CSV'"), 'the table menu exports CSV');
  assert.match(APP, /api\('DELETE', `\/tables\/\$\{db\.id\}`\)/);
  assert.match(APP, /api\('DELETE', `\/spaces\/\$\{spaceId\}`\)/);
  assert.doesNotMatch(APP, /class: 'btn btn-sm', href: `\$\{WS_PREFIX\}\/api\/tables\/\$\{db\.id\}\/export\.csv`/);
});

test('the space menu holds no per-table export', () => {
  assert.doesNotMatch(APP, /label: `Export \$\{d\.name\}\.csv`/);
  assert.doesNotMatch(APP, /space\.tables\.map\(\(d\) => \(\{[\s\S]{0,80}export\.csv/);
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
  assert.match(body, /dismissOutside\(\{ open: \(\) => !menu\.classList\.contains\('hidden'\), inside: \(t\) => wrap\.contains\(t\), close \}\)/, 'a tap or click away must close it (Issue #726)');
});

test('comments and activity make up the side column; fields lead the body', () => {
  assert.match(APP, /right\.append\(commentsPanel, actPanel\)/,
    'the side column reads Comments → Activity');
  assert.doesNotMatch(APP, /left\.append\(commentsPanel\)/, 'comments must leave the main column');
  assert.doesNotMatch(APP, /left\.append\(actPanel\)/, 'activity must leave the main column');
});

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
  assert.match(decl, /lucide:chevron-right/, 'the chevron is the inventory\'s, so it matches the set and moves');
  const icon = rulesFor('.nav-caret svg');
  assert.ok(px(icon.width) >= 14, `chevron glyph must be >= 14px, got ${icon.width}`);
});

test('the caret trails the space label and rotates to open', () => {
  const fn = APP.slice(APP.indexOf('function renderNav'));
  const body = fn.slice(0, fn.indexOf('\n}\n') + 2);
  const row = body.indexOf("class: 'nav-space-row'");
  assert.ok(body.indexOf('nav-caret', row) > body.indexOf("class: 'nav-space'", row),
    'the caret is appended after the space link — it trails the label ("Routines ›")');

  const caret = rulesFor('.nav-caret');
  assert.ok(!caret.transform || caret.transform === 'none',
    `the resting caret must not be rotated, got ${caret.transform}`);
  assert.match(rulesFor('.nav-caret.open').transform, /rotate\(90deg\)/,
    'the expanded caret rotates the right-pointing glyph down');
});

test('an unfilled #ws-list does not eat a rail gap', () => {
  assert.ok(px(rulesFor('#ws-rail').gap) > 0, 'the rail spaces its chips with gap');
  assert.equal(rulesFor('#ws-list:empty').display, 'none',
    '#ws-list must leave the flex flow until the workspace fetch lands');
});

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

test('every column header carries a field menu; a header click edits, sorting lives in the menu', () => {
  const head = fnBody('renderTable');
  assert.match(head, /fieldMenuButton\(/, 'each column th mounts the field menu');
  assert.match(head, /onclick: \(e\) => \{ const th = e\.currentTarget; if \(!th\.dataset\.resized && !th\.dataset\.gesture\) editFieldDialog\(db, colField\(db, c\)\); \}/,
    'the header click opens the field editor — unless it is the click a resize or reorder gesture leaves behind (Issue #98, Feature #233)');
  assert.match(head, /onSort: sortBy\(c\)/, 'the menu is handed the sort control');
  assert.match(head, /systemMenu\('Public Id', '#'\)/, 'the # header mounts a sort menu');
  assert.match(head, /systemMenu\(n, n\)/, 'each system header mounts one too');
  const menu = fnBody('fieldMenuButton');
  assert.match(menu, /showPopover\(/, 'the menu reuses the chip popover, not a new overlay');
  assert.match(menu, /stopPropagation/, 'opening the menu must not also open the editor');
  assert.match(menu, /const words = sortLabelsFor\(db, f\)/, 'the sort rows take their words from the field');
  assert.match(menu, /words\.asc/, 'ascending is in the menu');
  assert.match(menu, /words\.desc/, 'descending is in the menu');
});

test('the field menu edits a field rather than dropping and rebuilding it', () => {
  const dlg = fnBody('fieldDialog');
  assert.match(dlg, /'PATCH'/, 'F1: editing a field is a PATCH to /fields/:id');
  assert.doesNotMatch(dlg, /'DELETE'/, 'never delete-and-recreate — that drops the column data');
  assert.match(dlg, /fdc\.editPatchConfig\(existing, def, state\)/, 'the dialog builds its PATCH through the tested core');
});

test('deleting a field from the header is guarded and never offered for Name', () => {
  const menu = fnBody('fieldMenuButton');
  assert.match(menu, /holdToConfirm\(/, 'destructive rows are hold-to-confirm, like the schema page');
  assert.match(menu, /f\.role !== 'name'/, 'the name-role field must not offer a delete row (by role — it can be renamed, Feature #168)');
});

test('the field menu draws its icons, it never types them into a label', () => {
  const menu = fnBody('fieldMenuButton') + fnBody('fieldMenuRow');
  assert.match(menu, /iconEl\(/, 'every mark resolves through the one icon path');
  for (const typed of ['✎ Edit', '+ Insert', '↑ Sort', '↓ Sort']) {
    assert.ok(!menu.includes(typed), `'${typed}' is a glyph pasted into a label — draw it instead`);
  }
  assert.match(APP, /const FIELD_MENU_ICONS = \{/, 'the menu names its icons in one place');
});

test('every row of the field menu is the same row, destructive included', () => {
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
  const menu = fnBody('fieldMenuButton') + fnBody('fieldMenuRow');
  assert.ok(!menu.includes("'✓ '"), 'no check pasted onto the front of a label');
  assert.match(menu, /chip-pop-check/, 'the popover already has a current-value cue');
  assert.match(menu, /current: sorted > 0/, 'ascending is marked when it is the live sort');
  assert.match(menu, /current: sorted < 0/, 'and descending too');
  assert.match(fnBody('showPopover'), /findIndex\(\(o\) => o\.querySelector\('\.chip-pop-check'\)\)/);
});

test('the menu names the column it belongs to', () => {
  const menu = fnBody('fieldMenuButton');
  assert.match(menu, /wv-menu-head/, 'a title line opens the panel');
  assert.match(menu, /fieldDialogCore\.typeLabel\(f\.type\)/, 'naming the type as well as the name');
  const head = rulesFor('.wv-menu-head');
  assert.match(head['border-bottom'] ?? '', /var\(--tblr-border-color\)/, 'it is a header, so it is ruled off');
  assert.equal(rulesFor('.wv-menu-title')['text-overflow'], 'ellipsis', 'a long field name must not stretch the panel');
});

test('the hold gesture is advertised before it is pressed', () => {
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
  assert.equal(fill.transition, 'transform 0s');
  assert.equal(fill.transform, 'scaleX(0)');
});

test('a popover arrives rather than appears, and stops for reduced motion', () => {
  assert.match(CSS, /\.chip-pop \{[^}]*animation: wv-pop-in [^}]*\}/, 'the base rule animates it in');
  assert.match(CSS, /@keyframes wv-pop-in/);
  assert.doesNotMatch(CSS.slice(CSS.indexOf('@keyframes wv-pop-in')).slice(0, 160), /width|height|top:|left:/);
  const reduced = CSS.match(/@media \(prefers-reduced-motion: reduce\) \{[^}]*\.chip-pop[^}]*\}/);
  assert.ok(reduced, 'an entrance animation needs a reduced-motion opt-out');
});

test('column reorder is persisted as fieldOrder, not page state', () => {
  const move = fnBody('reorderField');
  assert.match(move, /fieldOrder/, 'reorder writes the schema…');
  assert.match(move, /'PATCH'/, '…through PATCH /tables/:id');
  assert.match(move, /loadSchema\(\)/, 'and reloads the schema so every view sees the new order');
  const menu = fnBody('fieldMenuButton');
  assert.doesNotMatch(menu, /Move left|Move right/, 'no duplicate reorder path in the field menu');
  assert.doesNotMatch(menu, /reorderField\(/, 'and no wiring left behind for one');
});

test('a column header is a drag handle for reorder (Feature #233, Feature #282: pointer events, a placeholder at the landing slot)', () => {
  const head = fnBody('renderTable');
  assert.doesNotMatch(head, /draggable: 'true'/, 'the th is not a native drag source');
  assert.match(head, /onpointerdown: \(e\) => headPointerDown\(e, c\)/, 'the header starts the drag');
  assert.match(head, /onkeydown: \(e\) => headKey\(e, c\)/, 'and takes the keyboard moves');
  assert.match(head, /CR\.target\(/, 'the drop point comes from the pure core');
  assert.match(head, /CR\.plan\(/, 'and so does what the drop does');
  assert.match(head, /gridConfigWrite\(db, null, patch\)/, 'a view grid saves the move into its view');
  assert.match(head, /RO\(\)\.press\(e, \{/, 'the header drag rides the shared reorder module');
  assert.match(head, /R\.columnShift\(/, 'the neighbours slide aside by the dragged width');
  assert.match(head, /class: 'wv-reorder-slot wv-col-slot'/, 'and the landing slot is the shared placeholder');
  assert.deepEqual(rulesFor('.wv-col-insert'), {}, 'no bare insertion line is left');
  assert.equal(rulesFor('.wv-grid th.drop-target').background, undefined, 'and never a tint on the displaced header');
});

test('the field menu affordance does not squeeze the column label', () => {
  const head = rulesFor('.wv-grid th.col-head');
  assert.equal(head.position, 'sticky', 'the ⋮ is positioned against its own header cell, which stays sticky');
  const btn = rulesFor('.field-menu');
  assert.equal(btn.position, 'absolute', 'the ⋮ floats — it must not take label width');
  assert.equal(btn.opacity, '0', 'quiet until the header is hovered or focused');
  const shown = rulesFor('.wv-grid th.col-head:hover .field-menu');
  assert.equal(shown.opacity, '1', 'hover reveals it');
  const focused = rulesFor('.field-menu:focus-visible');
  assert.equal(focused.opacity, '1', 'keyboard focus reveals it too — it is a real control');
});

test('the field editor commits with a save label, not Create', () => {
  const dlg = fnBody('fieldDialog');
  assert.match(dlg, /isEdit \? 'Save changes' : 'Create'/, 'the unified dialog must label edit submits as a save');
});

test('a hovered header is tinted so the menu has a visible owner', () => {
  const hover = rulesFor('.wv-grid th.col-head:hover');
  assert.ok(hover.background, 'the hovered header must change background');
  assert.notEqual(hover.background, rulesFor('.wv-grid thead th').background,
    'the hover tint has to differ from the resting header');
});

test('a stored column width reaches both the header and its cells', () => {
  const head = fnBody('renderTable');
  assert.match(head, /db\.view\?\.widths\?\.\[c\] \?\? colField\(db, c\)\?\.width/, 'the view width wins, the schema width is the fallback');
  assert.match(head, /CR\.layout\(/, 'the default and the floor come from the pure core');
  assert.match(head, /width:\$\{w\}px;min-width:\$\{w\}px;max-width:\$\{w\}px/, 'width, min-width and max-width together');
  assert.match(head, /:not\(\[colspan\]\)/, 'a spanning row takes no column width');
});

test('a resize grip commits once, on release', () => {
  const grip = fnBody('columnResizeGrip');
  assert.match(grip, /pointerdown/, 'the grip drags');
  assert.match(grip, /pointermove/, 'and tracks the pointer');
  assert.match(grip, /grid\.commit\(/, 'and commits through one writer');
  const commits = [...grip.matchAll(/grid\.commit\(/g)];
  assert.equal(commits.length, 2, 'exactly two commits: release and auto-fit — never per move');
  assert.match(grip, /dblclick/, 'double-click auto-fits');
  assert.match(grip, /stopPropagation/, 'grabbing the grip must not sort the column');
  assert.match(grip, /grid\.paint\(f\.name, width\)/, 'every move paints the column the way release will');
  assert.match(fnBody('renderTable'), /CR\.floor\(\{\s*label: label\.getBoundingClientRect\(\)\.width/, 'the floor is measured from the rendered label');
  assert.match(grip, /CR\.width\(/, 'one width rule, shared with the pure core');
  assert.match(grip, /th\.dataset\.resized = '1'/, 'the header wears the gesture mark');
  assert.match(grip, /delete th\.dataset\.resized/, 'and sheds it on the next press');
  assert.match(readFileSync(join(ROOT, 'public/index.html'), 'utf8'), /<script src="\/column-resize\.js" defer><\/script>/, 'the pure core is loaded');
});

test('double-click fits the column to its content (measured), a schema write like any resize', () => {
  const grip = fnBody('columnResizeGrip');
  assert.match(grip, /grid\.commit\(f\.name, CR\.fit\(\{ content: fitColumnWidth\(th\), floor: grid\.floor\(f\.name\), max: CR\.maxWidth\(f\) \}\)\)/,
    'double-click writes the measured fit, between the label floor and the type cap');
  const head = fnBody('renderTable');
  assert.match(head, /gridConfigWrite\(db, null, \{ widths: \{ \[c\]: w \} \}\)/, 'a view width is a view write');
  assert.match(head, /config: \{ width: f\.width \}/, 'a registry grid falls back to the field config');
});

test('a fit measures the content, not the box the column already has', () => {
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

test('a chip is sized by its label, never by a fixed width', () => {
  const chip = rulesFor('.chip');
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

test('an idle inline-edit cell casts no shadow', () => {
  const idle = rulesFor('.inline-edit:not(:focus)');
  assert.equal(idle['box-shadow'], 'none',
    '.inline-edit:not(:focus) must zero Tabler\'s --tblr-shadow-input');
  assert.equal(rulesFor('.inline-edit')['box-shadow'], undefined,
    'the reset must not be unscoped — that would kill the focus ring too');
});

test('the entity ⋮ sits at the right end of the title row, like every other view', () => {
  assert.doesNotMatch(APP, /entity-dl-corner/, 'no absolutely-positioned corner menu remains');
  assert.doesNotMatch(CSS, /entity-dl-corner/, 'and its stylesheet block is gone with it');
  assert.doesNotMatch(APP, /crumb-offset/, 'the crumb no longer indents around a corner control');
  assert.doesNotMatch(CSS, /crumb-offset/);

  assert.match(APP, /class: 'crumb crumb-row' \},\s*\n\s*\.\.\.\(inPeek \? \(dockControls\?\.nav \?\? \[\]\) : \[navMenuButton\(\), \.\.\.navArrows\(pageGo\)\]\),\s*\n\s*crumbPath\([\s\S]{0,900}?el\('span', \{ class: 'crumb-actions wv-toolbar' \}, activityBtn, eye, dlBtn, \.\.\.poseControls\)/,
    'the Activity clock-arrow, the eye, ⋮ and the pose controls trail the crumb line (one entity surface)');
  const body = fnBody('renderEntityView');
  assert.match(body, /const sideOpen = \(db\.systemFields \?\? \[\]\)\.includes\('Activity'\);/, 'the column opens with the Activity system field');
  assert.ok(!/localStorage/.test(body.slice(body.indexOf('activityBtn'), body.indexOf('activityBtn') + 600)) && !body.includes('wv-entity-side'), 'the Activity icon keeps no per-browser memory, and the side column has no second switch');
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
  assert.match(eyeFn, /relearnRows\(pop, buildRows\(liveTable\(\)\)/, 'a flip teaches the rows in place');
  assert.doesNotMatch(eyeFn, /replaceChildren/, 'and never swaps them wholesale');
  assert.doesNotMatch(eyeFn, /fieldVisibilityPopover\(again/, 'the close-and-reopen dance is gone');
  const relearn = fnBody('relearnRows');
  assert.match(relearn, /classList\.toggle\('on', on\)/, 'a taught row wears the new switch state');
  assert.match(relearn, /pop\.replaceChildren\(\.\.\.next\)/, 'a row set that changed is still rebuilt');
  assert.match(fnBody('footerPicker'), /relearnRows\(pop, build\(\)/, 'the Σ picker shares the one tail');
  assert.equal(rulesFor('.entity-head')['margin-bottom'], '0',
    '.view-header owns the gap below the header, exactly as on .view-title-row');

  const head = rulesFor('.entity-head');
  const bar = rulesFor('.wv-toolbar');
  assert.equal(head['align-items'], bar['align-items'],
    '.entity-head must align its row the same way .wv-toolbar does');
  assert.equal(rulesFor('.entity-head .dl-wrap')['margin-left'], 'auto',
    'margin-left:auto is what pushes the menu to the right edge');

  const call = APP.match(/\{ title: `[^`]*\} actions`, align: 'right' \}/);
  assert.ok(call, 'the entity menu call site should be findable');
  assert.match(call[0], /align: 'right'/, 'a right-edge menu must drop its panel to the left');
});

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
  assert.match(block, /relationChipEl\(\{ targetDbIds: true \}, r\)/, 'the chip is the relation chip — the far row’s Chip — and the chip is the link, wearing the short home-table badge');
  assert.doesNotMatch(block, /class: 'x'|×/, 'no unlink control: a reference is text');
  assert.equal(rulesFor('.entity-grid:not(.side-open) > .entity-side').display, 'none', 'the panels hide with comments and activity');
  assert.doesNotMatch(CSS, /\.ref-summary|\.ref-backlinks-card\[open\]/, 'the <details> dress is gone');
  assert.doesNotMatch(CSS, /\.ref-backlinks a\.mention|\.ref-backlink\b/, 'the bespoke mention styling is gone');
  assert.doesNotMatch(CSS, /\.ref-backlinks(-card)?\s+\.k\b/, 'no reference-local chip rules');
});

test('heading levels are not labelled in the document gutter', () => {
  for (const h of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    assert.equal(rulesFor(`.doc-editor .vditor-ir .vditor-reset > ${h}::before`).content, 'none',
      `the ${h.toUpperCase()} gutter badge must be removed, not merely recoloured`);
  }
});

test('the document section head names the document at rest; its tools stay quiet until reached for', () => {
  const head = rulesFor('.doc-section-head');
  assert.notEqual(head.opacity, '0', 'the head is visible at rest');
  assert.notEqual(head.display, 'none', 'the head keeps its space in the flow');
  assert.equal(rulesFor('.doc-anchor').opacity, '0', 'the tools are hidden at rest');
  assert.equal(rulesFor('.doc-section:hover .doc-anchor').opacity, '.7', 'and fade in on hover');
});

test('an expanded code block is one block, not a smear over a duplicate', () => {
  assert.equal(rulesFor('.doc-editor .vditor-ir__node--expand pre.vditor-ir__marker--pre').display, 'block',
    'the editable source must be a block box, or its slab paints out of line');
  assert.equal(rulesFor('.doc-editor .vditor-ir__node--expand[data-type="code-block"] .vditor-ir__preview').display, 'none',
    'the rendered copy steps aside while its source is being edited');
});

test('every code block carries a copy button in its upper right', () => {
  assert.equal(rulesFor('.doc-editor .vditor-copy').display, 'block',
    'the copy button is always present, not hover-only');
  const btn = rulesFor('.doc-editor .vditor-copy span');
  assert.ok(btn.top !== undefined && btn.right !== undefined,
    'pinned to the upper right of the block');
  assert.equal(btn.left, undefined, 'never anchored from the left');
});

test('a computed field carries its glyph next to the name, not only in cells', () => {
  const label = fnBody('fieldNameLabel');
  assert.match(label, /computedMark(?:Node)?\(/, 'one glyph vocabulary for names and values');
  assert.match(label, /'sup'/, 'the mark is a superscript on the name');
  assert.match(APP, /COMPUTED_NAME_MARKS = \{[^}]*formula/,
    'formula fields are the case this exists for');

  for (const fn of ['renderTable', 'renderEntityView']) {
    assert.match(fnBody(fn), /fieldNameLabel\(/, `${fn}() must label field names through the helper`);
  }
  const mark = rulesFor('.field-mark');
  assert.ok(mark['font-size'], 'the mark is smaller than the name it annotates');
  assert.ok(mark.color, 'and quieter than it');
});

test('the entity activity pane shows ten rows, each linking into the Activity table', () => {
  const body = fnBody('renderEntityView');
  assert.match(APP, /const ACTIVITY_PANE_ROWS = 10;/, 'the pane is capped at ten');
  assert.match(body, /slice\(0, ACTIVITY_PANE_ROWS\)/, 'and takes the ten most recent');
  assert.match(body, /href: `#\/activity\/\$\{id\}:\$\{firstIndex - n\}`/,
    'each row addresses its own event in the Activity table');
  assert.match(body, /href: `#\/activity\/\$\{id\}`/, 'and the pane header opens the filtered table');
  assert.match(body, /activitySummary\(a\)/, 'one summary function serves the pane and the table');
});

test('the Activity table is routed, read-only and reachable from the workspace page', () => {
  assert.match(fnBody('dispatchRoute'), /#\\\/activity|#\/activity/, 'the router knows #/activity');
  assert.match(APP, /hash\.match\(\/\^#\\\/activity/, 'with an optional entity/event parameter');
  const view = fnBody('showActivity');
  assert.match(view, /api\('GET', `\/activity/, 'the view reads the feed endpoint');
  assert.doesNotMatch(view, /'POST'|'PATCH'|'DELETE'/, 'nothing in this table can be written from the UI');
  assert.match(view, /system table/i, 'and it says so on the page');
  assert.match(fnBody('showHome'), /#\/activity/, 'the workspace page links to it');
  assert.match(fnBody('showHome'), /system/, 'marked as weave\'s table rather than the user\'s');
});

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

test('the field dialogs offer a default value for the types that can hold one', () => {
  const CORE = readFileSync(join(ROOT, 'public/field-dialog-core.js'), 'utf8');
  const listed = CORE.match(/const DEFAULTABLE = \[([^\]]*)\]/)[1];
  for (const t of ['text', 'number', 'date', 'checkbox', 'url', 'email', 'select', 'multiselect']) {
    assert.ok(listed.includes(`'${t}'`), `${t} takes a default`);
  }
  for (const t of ['workflow', 'document', 'formula', 'rollup', 'lookup', 'relation']) {
    assert.ok(!listed.includes(`'${t}'`), `${t} must not offer one — the engine refuses it`);
  }
  assert.match(fnBody('fieldDialog'), /DEFAULTABLE\.includes/, 'the dialog consults the core list');
  const read = CORE.slice(CORE.indexOf('function typedDefault'), CORE.indexOf('\n  }', CORE.indexOf('function typedDefault')));
  assert.match(read, /checkbox/, 'a checkbox default is a boolean, not the string "true"');
  assert.match(read, /Number\(/, 'a number default is a number');
});

test('a collection relation renders as the target table grid, in the body', () => {
  const grid = fnBody('relatedGrid');
  assert.match(grid, /labeledEditorFor\(/, 'cells are the same named editors the table view uses (Issue #378)');
  assert.match(grid, /PICKER_FIELD_TYPES\.includes/, 'and carry the same picker/computed cell classes');
  assert.match(grid, /rowClickTarget\(e\)/, 'so a click on a picker opens the picker, not the entity');
  assert.match(grid, /openEntity\(item\.id\)/, 'and a click elsewhere opens the row\'s page (Feature #117)');
  assert.match(grid, /\['id', 'in', linked\.map/, 'the rows are fetched whole, by id');
  assert.match(grid, /c\.name !== f\.inverseField/, 'the column pointing back at this record is dropped');
  assert.match(grid, /visibleCols\(target\)/, 'and the target table\'s hidden set applies — Chip/Card stay hidden until unhidden (Issue #200)');

  const body = fnBody('renderEntityView');
  assert.match(body, /relatedGrid\(entity, f, refresh\)/, 'the entity page mounts one per collection relation');
  assert.match(body, /x\.type === 'relation' && x\.many/, 'collections only — a single link stays a chip');
  assert.match(body, /wireBlock\(f\.name, el\('div', \{ class: 'related-block' \}\)/,
    'they are blocks of the main body, movable like any other (Issue #89)');
  assert.match(body, /grid\.querySelector\('\.related-head'\)\?\.prepend\(grip\)/,
    'and the anchor lands in the head the grid draws for it');
  assert.match(body, /if \(f\.type === 'relation' && f\.many && !f\.targetDbIds\) continue;/,
    'and are not repeated as chips in the fields block — except a target set, which has no one grid and stays chips');
});

test('the entity body is blocks, and every block carries a reposition anchor', () => {
  const body = fnBody('renderEntityView');
  assert.match(body, /class: 'entity-fields'/, 'the value fields are one block');
  assert.match(body, /left\.classList\.add\('entity-body'\)/, 'the main column IS the body');
  assert.doesNotMatch(body, /card-title' \}, 'Fields'/, 'and no longer a side card (Feature #82 superseded)');

  assert.match(body, /items: \(\) => \[\.\.\.values\.querySelectorAll\(':scope > \.fieldrow:not\(\.fieldrow-system\)'\)\]/, 'a field drag sorts the value rows (Feature #282)');
  assert.match(body, /items: \(\) => \[\.\.\.left\.children\]\.filter\(\(n\) => n\.matches\('\[data-block\]'\)\)/, 'and a block drag sorts the blocks, tracked apart');
  assert.equal((body.match(/RO\(\)\.sortable\(e, \{/g) ?? []).length, 2, 'both go through the one shared reorder module');
  assert.match(body, /reorderField\(db, f\.name, next\.dataset\.field, \{ after: false, onFail: refresh \}\)/,
    'a field drop is a fieldOrder write through the one reorder function, against the placeholder\'s neighbour');
  assert.match(body, /reorderBlocks\(db, left, refresh\)/, 'a block drop is a bodyOrder write');
  assert.doesNotMatch(APP, /function slotDrag\(/, 'the native drag-and-drop slot is gone');
  assert.doesNotMatch(body, /draggable/, 'nothing on the page is a native drag source');
  assert.doesNotMatch(body, /compareDocumentPosition\(node\)/, 'no direction arithmetic is left on the page');
  assert.match(body, /const anchor = \(what\) => el\('span', \{ class: 'opt-grip', title: `Drag to move \$\{what\}` \}/,
    'the anchor is the grip a row wears: the thing you grab is the thing that moves');
  assert.match(body, /wireBlock\(VALUES_BLOCK, fields,/, 'the field block is anchored');
  assert.match(body, /wireBlock\(f\.name, section, \[section\.querySelector\('\.opt-grip'\), section\.querySelector\('\.doc-section-head'\)\]\)/,
    'a document is anchored, and still draggable by its whole head');
  assert.match(body, /node\.classList\.add\('attach-block'\)/, 'an attachment row is a block too');

  assert.match(body, /const named = db\.bodyBlocks \?\? \[VALUES_BLOCK\];/, 'the page renders the order it is handed');
  const rb = fnBody('reorderBlocks');
  assert.match(rb, /\[\.\.\.body\.children\]\.map\(\(n\) => n\.dataset\.block\)/,
    'the move already happened, so the DOM is the new order');
  assert.match(rb, /bodyOrder/, 'and it is a table write');

  const rf = fnBody('reorderField');
  assert.match(rf, /onFail = \(\) => showDatabase\(db\.id\)/, 'reorderField defaults its failure redraw to the table view');
  assert.match(rf, /onFail\(\)/, 'and calls whatever the caller gave it');

  assert.match(body, /f\.type === 'document'/, 'a document field renders as its section');
  assert.match(body, /class: 'doc-section-head' \}/, 'and is dragged by its head');
  assert.match(body, /const dragRow = \(node, f\)/, 'one drag wiring serves the value rows');
  assert.match(CSS, /\.wv-reorder-slot \{[^}]*outline: 1\.5px dashed var\(--wv-slot-line\)/, 'the cue is a dashed placeholder (Feature #282)');
  assert.match(CSS, /\.wv-reorder-slot \{[^}]*break-inside: avoid/, 'that never splits across a column break');
  assert.doesNotMatch(CSS, /\.drop-slot/, 'the old slot is gone');
  assert.doesNotMatch(CSS, /\.fieldrow\.drop-(before|after)/, 'no line on a neighbour\'s edge remains');
  assert.doesNotMatch(CSS, /\[data-block\]\.drop-target/, 'for rows or for blocks');

  assert.match(body, /class: 'fieldrow-label', title: fieldDescription\(f\) \? `\$\{fieldDescription\(f\)\}\\n\\nEdit field` : 'Edit field', onclick: \(\) => editFieldDialog\(db, f\)/,
    'the label click opens the field tray; the description rides its tooltip (Issue #209)');
  assert.match(body, /fieldDescription\(f\) \? el\('span', \{ class: 'fieldrow-desc' \}, fieldDescription\(f\)\) : null/,
    'and the description is drawn under the label, never an empty line');
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
  assert.ok(!APP.includes('renderBoard'), 'no board renderer');
  assert.ok(!APP.includes('view-switch'), 'no table/board switcher');
  assert.match(fnBody('showDatabase'), /pickTableView\(table, view\)/, 'every #/table route lands on the grid');
});

test('the collapsed nav slides out from the left edge (Kyle, 2026-08-25, Issue #77)', () => {
  const wire = fnBody('wireNavCollapse');
  assert.match(wire, /nav-hot-strip/, 'a hot strip guards the left edge while collapsed');
  assert.match(wire, /nav-peek/, 'resting on it slides the nav out as an overlay');
  assert.match(wire, /strip\.addEventListener\('click'/, 'clicking the edge pins the nav open');
  assert.match(CSS, /#app\.nav-peek #sidebar \{[^}]*position: fixed/,
    'the peek overlays the page instead of reflowing it');
  assert.match(CSS, /#app\.nav-collapsed #nav-hot-strip \{[^}]*position: fixed/,
    'the strip only exists while the nav is collapsed');
  assert.match(CSS, /#sidebar \{ width: 264px/,
    'the nav keeps its comfortable width (264px), never compacted');
});

test('horizontal overscroll is forbidden (Issue #76)', () => {
  assert.match(CSS, /html, body \{ overscroll-behavior-x: none; \}/);
});

test('clicking the open space in the nav folds it instead of navigating nowhere (Issue #72)', () => {
  const nav = fnBody('renderNav');
  assert.match(nav, /state\.route\?\.page === 'space' && state\.route\.spaceId === space\.spaceId/,
    'only the already-open space repurposes the click');
  assert.match(nav, /e\.preventDefault\(\);\s*\n\s*toggleFold\(space\.spaceId\)/,
    'the dead navigation becomes the fold toggle');
  assert.match(nav, /nativeClick\(e\)/, '⌘-click still opens the space in a tab — the one shared predicate');
});

test('the filter strip drives the engine where-language, not a client sort (Feature #38)', () => {
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
  assert.ok(app.includes("function filterWhere(db)"), 'filters compile to a where clause');
  assert.ok(app.includes("['in', states]") || app.includes("'in', states]"), 'workflow states use the in operator');
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

test('navigation schedules a skeleton of the destination (Feature #49, Issue #630)', () => {
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
  assert.ok(app.includes('function paintSkeleton('));
  const route = app.slice(app.indexOf('function renderRoute()'), app.indexOf('function route()'));
  assert.ok(route.includes('scheduleSkeleton('), 'renderRoute schedules the destination skeleton before it dispatches');
  assert.ok(!route.includes('paintSkeleton('), 'and never paints it inline, which flashed on a fast load');
  const sk = rulesFor('.sk');
  assert.equal(sk['border-radius'], '4px');
  assert.ok(readFileSync(join(ROOT, 'public/style.css'), 'utf8').includes('prefers-reduced-motion'), 'shimmer respects reduced motion');
});

test('the Share dialog shows the link and no QR code (Feature #263)', () => {
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
  const html = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
  const css = readFileSync(join(ROOT, 'public/style.css'), 'utf8');
  const start = app.indexOf('function shareDialog(');
  assert.ok(start > 0, 'the Share dialog exists');
  const share = app.slice(start, app.indexOf("'Create link')", start));
  assert.match(share, /el\('code', \{ class: 'share-url' \}, full\)/, 'the dialog shows the full link');
  assert.ok(share.includes("copyText(location.origin + WS_PREFIX + g.url, 'Link copied')"), 'minting a link copies it (Feature #194)');
  assert.doesNotMatch(share, /canvas|qr|scan/i, 'no QR code and no talk of scanning one');
  for (const gone of ['qrCanvas', 'leanQR', 'share-qr']) assert.ok(!app.includes(gone), `app.js still names ${gone}`);
  assert.ok(!html.includes('lean-qr'), 'the shell no longer loads lean-qr');
  assert.ok(!css.includes('.share-qr'), 'no stylesheet rule for the QR');
  assert.ok(!existsSync(join(ROOT, 'public/vendor/lean-qr.mjs')), 'lean-qr is no longer vendored');
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
  const frame = app.slice(app.indexOf("class: 'fsv-frame'"), app.indexOf("class: 'fsv-frame'") + 120);
  assert.ok(frame.includes('allowfullscreen'), 'the viewer frame permits fullscreen from inside (Safari)');
});

test('every selector speaks the one dialect: search bar first, list under it', () => {
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
  assert.ok(app.includes('function searchPicker('), 'the dialect exists');
  assert.ok(app.includes('function pickerSelect('), 'and its form-control face');
  const picker = app.slice(app.indexOf('function searchPicker('), app.indexOf('function pickerSelect('));
  assert.ok(picker.includes('input.focus()'), 'the search bar takes focus on open');
  assert.ok(picker.includes('core.keyDown('), 'keys route through the one grammar');
  assert.ok(picker.includes('input.selectionStart === 0'), 'and it is told whether the caret is at the start');
  for (const eff of ['pick', 'close']) assert.ok(picker.includes(`'${eff}'`), `${eff} is an effect the picker runs`);
  assert.equal((app.match(/el\('select'/g) ?? []).length, 0, 'native selects are gone — everything routes through the picker');
  const chips = app.slice(app.indexOf('function chipPicker('), app.indexOf('const PICKER_FIELD_TYPES'));
  assert.ok(chips.includes('searchPicker('), 'workflow/select chips open the dialect too');
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
  assert.ok(picker.includes('close: () => (multi ? commit() : pop.remove())'), 'outside click saves, never discards');
  assert.ok(app.includes('function chipPickerMulti('));
  const links = [...app.matchAll(/linkSearch\(f, \{/g)];
  assert.ok(links.length >= 3, `the related section, the relation editor and the bulk bar all link through the scoped search (saw ${links.length})`);
  assert.match(app.slice(app.indexOf('function linkSearch('), app.indexOf('function linkSearch(') + 2000), /multi: !!f\.many/, 'a to-many relation toggles in place');
  assert.ok(app.includes('unlink'), 'removals commit as unlinks');
});

test('the picker is a token box: chips sit inside the field, ahead of the caret', () => {
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
  const picker = app.slice(app.indexOf('function searchPicker('), app.indexOf('function pickerSelect('));
  assert.match(picker, /el\('div', \{ class: 'picker-box' \}, chips, input, readout\)/, 'chips and the caret share one box');
  assert.equal(rulesFor('.picker-name:empty')['display'], 'none', 'and an empty readout takes no room at all');
  assert.equal(rulesFor('.picker-name')['pointer-events'], 'none', 'the readout is text, never a target');
  assert.ok(!picker.includes('picker-chosen'), 'the separate chosen list is gone');
  assert.ok(picker.includes("class: 'picker-chips'"), 'the chips are their own element');
  assert.ok(picker.includes("st.caret === i ? ' sel' : ''"), 'the chip under the cursor is marked');
  assert.ok(picker.includes('chips.replaceChildren('), 'only the chips redraw');
  assert.equal(rulesFor('.picker-chips')['display'], 'contents', 'so the chips still flow in the box row');
  assert.ok(rulesFor('.picker-chip.sel')['outline'], 'the cursor on a chip reads as a ring');
  assert.equal(rulesFor('.picker-box')['flex-wrap'], 'wrap', 'a full box wraps rather than clipping');
  assert.ok(HTML.indexOf('picker-core.js') < HTML.indexOf('"/app.js"'), 'picker-core.js loads first');
});

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

test('a select and a state each clear through their own empty option', () => {
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
  const cell = app.slice(app.indexOf("if (f.type === 'workflow')"), app.indexOf("if (f.type === 'multiselect')"));
  const sel = cell.slice(cell.indexOf("if (f.type === 'select')"));
  assert.ok(sel.includes("clearId: '—'"), 'Backspace on the select chip picks —');
  assert.ok(sel.includes('current: val ?? null'), 'an unset select carries no chip at all');
  const wf = cell.slice(0, cell.indexOf("if (f.type === 'select')"));
  assert.ok(wf.includes("clearId: '—'"), 'Backspace on the state chip picks —');
  assert.ok(wf.includes('current: val ?? null'), 'an unset state carries no chip at all');
});

test('resize and reorder commit in place — the grid never tears down mid-gesture', () => {
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
  const head = fnBody('renderTable');
  const commitAt = head.indexOf('const commitWidth');
  const commit = head.slice(commitAt, head.indexOf('const grid = {', commitAt));
  assert.ok(commit.includes('paintLayout()'), 'the commit paints through the same function the drag paints with');
  assert.ok(!commit.includes('showDatabase(db.id') || commit.includes('catch'), 'redraw only on failure');
  const order = head.slice(head.indexOf('const applyOrder'), head.indexOf('const columnDrag'));
  assert.ok(order.includes('anchorCell.after(cell)'), 'a grid column moves as DOM cells, not a redraw');
  assert.ok(order.includes('built.values()'), 'rows built this draw but off screen move too');
  assert.ok(order.includes('cols = next'), 'rows built later, and the next draw, read the new order');
  assert.ok(order.includes('showDatabase(db.id, state.route?.view)'), 'failure falls back to truth');
  const rStart = app.indexOf('async function reorderField');
  const reorder = app.slice(rStart, rStart + 2600);
  assert.ok(reorder.includes('insertAdjacentElement'), 'columns move as DOM cells, not a redraw');
  assert.ok(reorder.includes('db.fields.splice'), 'the local schema order follows the move');
  assert.ok(reorder.includes('onFail();'), 'failure falls back to truth');
});

test('field dialogs are the unified fieldDialog, not the old string forms', () => {
  assert.match(APP, /function fieldDialog\(db, existing, after\)/);
  assert.match(APP, /function addFieldDialog\(db\) \{[\s\S]{0,400}?fieldDialog\(db, null,/);
  assert.match(APP, /function editFieldDialog\(db, f\) \{\s*fieldDialog\(db, f,/);
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
  assert.match(dlg, /dsection\('Script', formulaBuilder\(db, state, changed, \{ selfName: existing\?\.name \?\? null, fieldName: \(\) => nameInput\.value/, 'the builder is a tray section, told which field it edits and what it is being called');
  assert.match(fnBody('formulaBuilder'), /class: 'fx-agent'/, 'the agent panel rides under the script (Feature #205)');
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
  const back = rulesFor('#tray-back');
  const pop = rulesFor('.chip-pop');
  assert.ok(px(pop['z-index']) > px(back['z-index']), 'a picker opened inside the tray must render above it');
  assert.ok(px(pop['z-index']) > px(rulesFor('#modal-back')['z-index']), 'and above the modal backdrop (the old nesting bug)');
});

test('the type grid has both-theme styling via tabler tokens', () => {
  const tile = rulesFor('.type-tile.sel');
  assert.ok(tile['border-color']?.includes('--tblr-primary'), 'selected tile uses the primary token');
});

test('spaces and tables wear Lucide icons that move, picked beside their name (Feature #101)', async () => {
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
  const html = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(html.includes('vendor/lucide-moving.js') && html.includes('vendor/lucide-moving.css'), 'the set and its motion are vendored and loaded');
  assert.ok(html.indexOf('icon-registry.js') < html.indexOf('field-dialog-core.js'), 'the registry loads before the dialog core that groups on it');
  assert.ok(!html.includes('iconly-flat'), 'the Iconly file is gone');
  assert.ok(app.includes('function iconEl(') && app.includes('function iconButton('));
  assert.ok(app.includes('searchPicker({') && app.includes('Search by name or category…'),
    'the icon picker speaks the one dialect');
  assert.match(fnBody('iconButton'), /grid: true/, 'the table gate opens the grid');
  assert.match(fnBody('glyphPopover'), /grid: true/, 'the option and state gate opens the same grid');
  assert.ok(app.includes("iconEl(space.icon") && app.includes("iconEl(db.icon"), 'nav renders both');
  const icons = (await import('../public/vendor/lucide-moving.js'), globalThis.LUCIDE_MOVING);
  assert.ok(Object.keys(icons).length >= 120, 'the inventory rides along');
  await import('../public/field-dialog-core.js');
  for (const n of globalThis.fieldDialogCore.ICON_INVENTORY) assert.ok(icons[n], `${n} is offered but not vendored`);
  assert.ok(Object.values(icons).every((v) => !/#[0-9A-Fa-f]{6}/.test(v)), 'no hardcoded fills — icons inherit currentColor');
});

test('a document that is an HTML app is embedded, not edited as markdown', () => {
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
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

test('number costume controls: unit for plain numbers, an ISO-code picker for currency, shared with formula results', () => {
  const ctl = fnBody('numberCostumeControls');
  assert.match(ctl, /dsection\('Unit'/, 'plain numbers take a free-text unit');
  assert.match(ctl, /dsection\('Currency', pick/, 'currency takes a code through the picker dialect');
  assert.match(ctl, /fdc\.CURRENCIES/, 'codes come from the tested core list');
  const dlg = fnBody('fieldDialog');
  assert.match(dlg, /numberCostumeControls\(state, drawCostume, changed, \{ label: 'Result format', column \}\)/, 'a formula result wears the same costume, sampled from its own column (Issue #388)');
  assert.match(dlg, /resultType === null \|\| resultType === 'number'/, 'and only a numeric result wears it (Feature #206) — a table with no rows to type on keeps the section');
});

test('Enter in the date popover commits and closes, time kept', () => {
  const pop = fnBody('datePopover');
  assert.match(pop, /const local = readSmart\(\);[\s\S]{0,400}if \(t\) clocks\[which\] = t;[\s\S]{0,200}if \(!range\) \{ ends\.start = day; return commit\(true\); \}/,
    'Enter commits the typed stamp and closes; readTypedDate carried the time of day');
});

test('the eyeball: hidden fields, system columns and deleted rows from one popover; Manage fields is gone', () => {
  const eye = fnBody('fieldVisibilityPopover');
  assert.match(eye, /hiddenFields: \[\.\.\.next\]/, 'hidden fields persist on the table');
  assert.match(eye, /systemFields: \[\.\.\.next\]/, 'system columns toggle from the same list');
  assert.match(eye, /state\.showDeleted/, 'deleted rows are a session switch');
  assert.match(eye, /hideRollups: t\.hideRollups === false/, 'the Σ row switch is table truth (Issue #233), read live (Issue #240)');
  assert.match(eye, /row\(cur\.hideRollups === false, 'Σ rollup row'/, 'the switch reads on only when the table opted in');
  assert.match(fnBody('renderTable'), /showsRollups\(db\) \? renderFooter\(db, cols\) : null/, 'no Σ row until the view or table opts in (Issues #249, #442)');
  assert.match(readFileSync(join(ROOT, 'public/app.js'), 'utf8'), /const showsRollups = \(db\) => !db\.system && \(db\.view && !db\.view\.blank && typeof db\.view\.rollups === 'boolean' \? db\.view\.rollups : db\.hideRollups === false\);/, 'the view decides; a silent view follows the table opt-in');
  assert.match(eye, /new Set\(t\.hiddenFields \?\? \[\]\)/, 'the hidden set is read from the table the turn hands over');
  assert.match(eye, /new Set\(t\.systemFields \?\? \[\]\)/, 'so is the system set');
  assert.match(eye, /eyeWrites\.then\(async \(\) => \{\s*const patch = patchOf\(liveTable\(\)\);/,
    'every switch writes through one queue, reading the table only when its turn comes');
  assert.match(eye, /if \(patch\.view\) await gridConfigWrite\(db, null, patch\.view\);\s*else \{ await api\('PATCH', `\/tables\/\$\{db\.id\}`, patch\); await loadSchema\(\); \}/,
    "a field flip on a view writes the view (Feature #229), inside the same queue");
  assert.match(eye, /turn\.then\(async \(\) => \{\s*try \{\s*if \(eyeTails\.get\(db\.id\) !== turn\) return;\s*eyeTails\.delete\(db\.id\);\s*if \(painted && drawnMatches\(liveTable\(\)\)\) \{/,
    "the paint runs off the queue, once, after the last write of a burst on this table");
  assert.match(eye, /\} finally \{ release\(\); \}/, 'and the hold it took is always let go');
  assert.match(eye, /const painted = hides && home\?\.id === 'main' && !redraw && stillShown\(\) && dropDrawnColumn\(db\.id, hides\);/,
    'a hide leaves the drawn grid before its write goes out (Issue #328)');
  assert.match(fnBody('tableFieldsPopover'), /const painted = hides && here\(\) && dropDrawnColumn\(db\.id, hides\);/,
    'and the same for the view popover');
  assert.match(fnBody('tableFieldsPopover'), /if \(!painted \|\| !drawnMatches\(current\(\)\)\) await keepScroll/,
    'a hide reads the rows back only when the table disagrees with what was painted (Issue #328)');
  assert.match(fnBody('dropDrawnColumn'), /drawDatabase\(db, drawn\.items, drawn\.trashCount, drawn\.pager\)/,
    'the hide repaints the rows the grid already holds, with no read');
  assert.match(eye, /if \(pop\?\.eyeOf === db\.id\) pop\.relearnEye\(\)/,
    "a late paint teaches only an eye on this table, never a ⋮ menu opened since");
  assert.match(eye, /if \(stillShown\(\)\) redraw \?/, 'and redraws its page only while that page is on screen');
  assert.match(fnBody('renderTable'), /let cols = visibleCols\(db\)/, 'the grid honours the hidden set');
  assert.match(fnBody('reorderField'), /const cols = visibleCols\(db\)/, 'reorder mirrors the same columns');
  assert.doesNotMatch(APP, /row\('⚙ Manage fields'/, 'the Manage fields row is gone');
  assert.doesNotMatch(fnBody('addFieldMenuButton'), /showPopover/, 'the + opens the tray, not a menu');
  assert.match(fnBody('addFieldMenuButton'), /addFieldDialog\(db\)/);
});

test('relation is a tile in the add tray and posts to /relations; files and documents carry their options', () => {
  const dlg = fnBody('fieldDialog');
  assert.match(dlg, /def\.type === 'relation'\) \{\s*const made = await api\('POST', `\/tables\/\$\{db\.id\}\/relations`/, 'a relation tile creates through addRelation');
  assert.match(dlg, /'Target tables \(target set\)' : 'Target table', targetsBox\)/,
    'one select is the classic pair; adding more makes a target set');
  assert.match(dlg, /\+ another target table/, 'the set grows one select at a time');
  assert.match(dlg, /A target set is one-way/, 'and says out loud that no inverse is minted');
  assert.match(dlg, /fdc\.CARDINALITIES/);
  assert.match(dlg, /'Allow multiple files'/);
  assert.match(dlg, /dsection\('Kind', segCtl\(fdc\.DOCUMENT_KINDS/);
});

test('workflow states: rows drag to reorder, icon instead of a default radio, and no fifth category', () => {
  assert.deepEqual(rulesFor('.chip.state-other'), {}, "'other' leaves no tint behind");
  const ed = fnBody('stateListEditor');
  assert.doesNotMatch(ed, /draggable/, 'no native drag source (Feature #282)');
  assert.match(ed, /optRowGrip\(wrap, \(\) => state\.states, i,/, 'the grip drags through the shared reorder module');
  assert.match(fnBody('optRowGrip'), /fieldDialogCore\.moveItem\(list\(\), i,/, 'a drop reorders the states');
  assert.match(fnBody('optionListEditor'), /optRowGrip\(wrap, \(\) => state\.options, i,/, 'and select options drag the same way');
  assert.match(ed, /iconButton\(/, 'an icon picker per state');
  assert.match(fnBody('iconButton'), /iconCatalogue\(\)/, 'over the shared vocabulary');
  assert.match(fnBody('iconCatalogue'), /fieldDialogCore\.iconChoices/, 'which is the one catalogue');
  assert.doesNotMatch(ed, /type: 'radio'/, 'no default radio — the Default picker under the list names one (Issue #422)');
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

test('the view controls sit on the crumb line; Fields has a bundled eye icon and visibility switches', () => {
  const vh = fnBody('viewHeader');
  assert.match(vh, /class: 'crumb-actions wv-toolbar' \}, \.\.\.actions\.filter\(Boolean\)/, 'actions render beside the crumb');
  assert.doesNotMatch(vh, /titleInput, \.\.\.actions/, 'and no longer on the title row');
  assert.match(fnBody('fieldVisibilityPopover'), /class: 'switch' \+ \(on \? ' on' : ''\)/, 'rows are toggle switches');
  assert.match(fnBody('tableChrome'), /tableControlButton\('eye-btn', 'Fields', 'eye'\)/, 'the Fields label carries the bundled eye icon');
  assert.match(fnBody('tableControlButton'), /lucideEl\(icon\)/, 'toolbar controls use the bundled icon renderer');
  assert.match(fnBody('tableFieldsPopover'), /el\('input', \{ type: 'checkbox', class: 'form-check-input', checked: shown/, 'table field visibility is a real checkbox');
  assert.doesNotMatch(fnBody('tableFieldsPopover'), /role: 'switch'|field-visible-check/, 'and no hand-drawn switch');
  assert.ok(rulesFor('.switch.on').background?.includes('--tblr-primary'));
});

test('system columns are toggled only from the eye — not from the table ⋮ menu (Kyle, 2026-08-23)', () => {
  const draw = fnBody('drawDatabase');
  assert.doesNotMatch(draw, /Object\.keys\(SYSTEM_COLS\)\.map/, 'no Created At / Modified At rows in the table menu');
  assert.doesNotMatch(fnBody('tableChrome'), /Object\.keys\(SYSTEM_COLS\)\.map/, 'the menu lives in tableChrome since Issue #444');
  assert.match(fnBody('fieldVisibilityPopover'), /Object\.keys\(SYSTEM_COLS\)\.map/);
});

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
  assert.match(APP, /const DEFERRED_INSERTS = \{/, 'the deferred inserts are declared once');
  const apply = fnBody('applyCommandMarkers');
  assert.match(apply, /editor\.setValue\(next\);/, 'the swap runs in the task the marker lands in (Issue #456)');
  assert.doesNotMatch(apply, /queueMicrotask|setTimeout|requestAnimationFrame/,
    'not a microtask, a timer or a frame — Vditor writes the undo stack on its own 800ms timer, and the marker has to be gone first');
  assert.match(APP, /REF_MARKER_RE/, 'references travel the same way, through their own marker');
});

test('a document starts where its section starts', () => {
  assert.match(rulesFor('.doc-editor .vditor-ir pre.vditor-reset').padding ?? '', /0\s*!important/,
    'the reserved gutter has to be overridden, not merely set');
});

test('the chrome carries flat icons rather than emoji', () => {
  const emoji = /[\u{1F300}-\u{1FAFF}\u{FE0F}]/u;
  const offenders = APP.split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => emoji.test(line));
  assert.deepEqual(offenders, [], `emoji left in the UI: ${offenders.map(([n]) => n).join(', ')}`);
  assert.match(fnBody('slashGlyph'), /weaveIconRegistry.*LUCIDE_MOVING/s, 'the slash menu draws the inventory through the registry');
  assert.doesNotMatch(APP, /SLASH_LINK_GLYPH|ICONLY_FLAT/, 'no hand-drawn link and no Iconly left in the chrome');
  assert.ok(!rulesFor('.slash-icon svg').fill, 'no CSS fill on the svg — a stroke icon would turn into a blob; the shape carries its own fill and stroke');
  for (const s of ['.bug-cat-icon svg', '.bug-fab-icon svg']) assert.ok(!rulesFor(s).fill, `${s}: same rule`);
});

test('a reference chip has an opaque ground', () => {
  assert.equal(rulesFor('.doc-ref-layer .doc-ref-slot').background, 'var(--tblr-bg-surface)',
    'the chip covers its literal with the editor’s own surface');
});

test('# searches entities inline, and a heading is still a heading', () => {
  assert.match(APP, /\{ key: '#', hint: entityHint \}/, "the '#' trigger is registered with the editor");
  const hint = fnBody('entityHint');
  assert.match(hint, /ENTITY_HINT_MIN/, 'a lone # is not a search');
  assert.match(APP, /const ENTITY_HINT_MIN = 2;/, 'two characters — "# Heading" must never open one');
  assert.match(hint, /kind === 'entity'/, 'only records can be the target of a reference');
  assert.match(hint, /entityReference\(hit\)/, 'picking one writes the same reference the menu writes');
  assert.match(hint, /entityHintCache/, 'a keystroke that was already asked is not asked again');
});

test('the slash menu has a Line break that inserts a hard break, not a code block', () => {
  const items = APP.slice(APP.indexOf('function slashItems'), APP.indexOf('function slashScore'));
  assert.match(items, /label: 'Line break'/, '/line finds it by name');
  assert.match(items, /aliases: \['br', 'newline', 'return'\]/, 'and by its aliases');
  const item = items.match(/label: 'Line break'.*insert: '((?:[^'\\]|\\.)*)'/);
  assert.ok(item, 'it inserts');
  assert.equal(item[1], '\\\\\\n', 'the insert is a backslash hard break — markdown, not HTML, not a fence');
});

test('table keys: Enter adds a row, Shift+Enter removes an empty one, Tab at the end grows the table', () => {
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

test('a document section has no ⛶ — the document is the page; only a deck expands (Issue #176, #111)', () => {
  const fn = fnBody('expandDocument');
  assert.ok(!fn.includes('node'), 'the expander is frame-only again: no live-editor hand-over, so no null frame to throw on');
  const body = fnBody('renderEntityView');
  const head = body.slice(body.indexOf("class: 'doc-section-head'"), body.indexOf("class: 'doc-anchor permalink-copy', title: 'Copy link to this document'"));
  assert.ok(!head.includes("title: 'Expand'") && !head.includes('⛶'), 'no expand anchor in a document head');
  assert.match(body, /class: 'doc-anchor', title: 'Expand', onclick: \(\) => expandDocument\(grid, deckUrl, label\)/, 'the deck section keeps its expand — a framed deck is a different thing');
  assert.ok(!CSS.includes('.doc-expand-edit'), 'the edit-mode overlay styling went with it');
});

test('the divider inserts *** — an inserted --- pair is YAML front matter to Lute', () => {
  const items = APP.slice(APP.indexOf('function slashItems'), APP.indexOf('function slashScore'));
  const item = items.match(/label: 'Divider'.*insert: '((?:[^'\\]|\\.)*)'/);
  assert.ok(item, 'the Divider item exists');
  assert.equal(item[1], '\\n***\\n', 'thematic break, unambiguous spelling');
  assert.doesNotMatch(items, /insert: '\\n---\\n'/, 'the front-matter spelling is gone');
});

test('the slash menu clamps under the record header instead of hiding its promoted row', () => {
  assert.match(fnBody('mountDocEditor'), /attachHintClamp\(host\)/, 'wired at mount');
  const fn = fnBody('attachHintClamp');
  assert.match(fn, /maxHeight/, 'tall menus scroll');
  assert.match(fn, /hintFloor\(hint\)/, 'the clamp measures the pinned header, not the window edge');
  assert.match(fnBody('hintFloor'), /#dock \.view-header/, 'and the dock has its own header to clear');
  assert.match(CSS, /\.vditor-hint \{[^}]*z-index: 9/, 'the menu outranks the record header (6) and the section head (5)');
});

test('the slash link glyph is the interlocked chain, drawn from the inventory', async () => {
  assert.match(APP, /label: 'Link', icon: '⛓', flat: 'link'/, 'the Link row names the inventory icon');
  await import('../public/icon-registry.js');
  await import('../public/vendor/lucide-moving.js');
  assert.equal(globalThis.weaveIconRegistry.resolve('lucide:link'), 'link', 'link is in the set');
  assert.match(globalThis.LUCIDE_MOVING.link, /<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/, 'and it is the chain');
});

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
  assert.match(grid, /dataset: \{ eid: item\.id, href: registryHref\(db, item\) \?\? /, 'the grid routes row clicks through it');
  assert.match(grid, /registryHref\(db, item\) \?\? `#\/entity\//,
    'the #N open link is the same affordance: structure for registry rows, entity page otherwise');
});

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
  const route = fnBody('dispatchRoute');
  assert.match(route, /teardownDocEditors\(\);[\s\S]{0,120}dockClose\(\);/, 'the route dispatch closes the dock right after the editor teardown');
  assert.ok(route.indexOf('dockClose()') < route.indexOf('location.hash'), 'and before it reads the destination');
});

test('dock: Escape defers to every overlay app.js can raise', () => {
  const m = APP.match(/const DOCK_ESC_OWNERS = '([^']+)'/);
  assert.ok(m, 'the dock names its Escape owners in one selector');
  const owners = m[1].split(',').map((s) => s.trim());
  const backs = [...new Set([...APP.matchAll(/id: '([a-z]+-back)'/g)].map((x) => `#${x[1]}`))];
  const pops = [...new Set([...APP.matchAll(/class: '([a-z]+-pop)'/g)].map((x) => `.${x[1]}`))];
  assert.ok(backs.length >= 4 && pops.length >= 3, `the derivation found ${backs.length} backdrops and ${pops.length} popovers`);
  for (const sel of [...backs, ...pops]) assert.ok(owners.includes(sel), `${sel} owns Escape but the dock does not defer to it`);
  assert.ok(owners.includes('.doc-rail.open'), 'an open document outline owns Escape too');
  const esc = APP.match(/if \(e\.key !== 'Escape' \|\| !dock\) return;[\s\S]{0,400}?\}\);/)[0];
  assert.match(esc, /closest\?\.\('input, textarea, select, \[contenteditable\]'\)/, 'a focused editor keeps its Escape');
  assert.match(esc, /weaveBreadcrumbs\.navCanBack\(crumbNav\)[\s\S]*weaveBreadcrumbs\.navBack\(crumbNav\)/, 'the step back is the nav core\'s rule, not a hand-rolled one');
});

test('dock: a repaint releases what the last pass mounted, and the docked row takes its light back', () => {
  const draw = fnBody('drawDock');
  assert.ok(draw.indexOf('releaseDockPanel()') < draw.indexOf('panel.replaceChildren('), 'release before replaceChildren, same discipline as the peek');
  assert.match(draw, /editors: dock\.editors/, 'the dock owns its editors so the scoped teardown can find them');
  assert.match(draw, /inPeek: true/, 'the dock renders the entity in its narrow pose');
  assert.match(draw, /markDockedRow\(\);\s*\}\s*$/, 'the light is re-marked after every paint');
  assert.match(draw, /panel\.replaceChildren\(host\)/, 'the entity view is the dock\'s only child');
  assert.match(draw, /dockControls \}\)/, 'and the dock hands its controls to the crumb row');
  assert.doesNotMatch(APP + CSS, /dock-head/, 'the separate .dock-head row and its rule are gone');
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
  assert.doesNotMatch(link, /onclick/, 'the link carries its destination and no opener of its own');
  assert.match(APP, /document\.addEventListener\('click', \(e\) => \{\s*if \(nativeClick\(e\)\) return;\s*const a = e\.target\.closest\?\.\('a\[href\^="#\/entity\/"\]'\)/, 'one capture handler opens every entity link, so one click docks once');
  assert.match(link, /`Open \$\{db\.term\.singular\} beside the table — ⌘-click for a new tab`/, 'the title speaks the row term (row-term work) and names both gestures');
  assert.match(grid, /href: registryHref\(db, item\) \?\? `#\/entity\/\$\{item\.id\}`/, '⌘-click on the row opens a tab, registry rows aside — the row carries the destination and openNativeClick opens it');
  const dockFn = fnBody('dockEntity');
  assert.match(dockFn, /dock && dock\.state\.anchor\.tableId === anchor\.id\s*\?\s*dock\.state/, 'a second open beside the same table keeps the pane state');
  assert.match(dockFn, /S\.init\(\{ tableId: anchor\.id, tableName: anchor\.name \}\)/, 'a different anchor re-inits');
  assert.match(dockFn, /drill \? weaveBreadcrumbs\.navHop\(crumbNav, hop\) : weaveBreadcrumbs\.navOpen\(crumbNav, hop\)/, 'a hop from the dock extends the nav; any other open starts it over');
  assert.match(dockFn, /syncDockChain\(\)/, 'and the dock\'s chain follows the nav');
  const opener = fnBody('openEntity');
  assert.match(opener, /if \(state\.route\?\.page !== 'db'\) \{/, 'the page only travels when no table is under the reader');
  assert.doesNotMatch(opener, /state\.route\.dbId === db\.id/, 'the entity\'s own table never decides a navigation');
});

test('dock: the panel is styled as the table\'s twin, its own scroller, and lights its row in both themes', () => {
  const rule = CSS.match(/^#dock \{[^}]+\}/m)?.[0];
  assert.ok(rule, '#dock has a rule');
  for (const decl of ['background: var(--tblr-bg-surface)', 'box-shadow: var(--wv-panel-shadow)', 'border-radius: 16px', 'overflow-y: auto', 'position: relative'])
    assert.ok(rule.includes(decl), `#dock lacks ${decl}`);
  assert.doesNotMatch(rule, /position: sticky/, 'the dock is a plain column of the shell');
  assert.doesNotMatch(rule, /display:/, 'no display of its own, so the hidden attribute keeps working');
  const light = CSS.match(/tr\.entity-row\.row-docked td \{[^}]+\}/)?.[0];
  assert.ok(light, 'the docked row has a light');
  assert.match(light, /var\(--tblr-active-bg/, 'the light is a theme token, so dark mode gets its own tint');
  assert.match(CSS, /#dock \.dock-entity \.entity-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/, 'the field grid single-columns in the narrow pane, and its track never grows past the pane (Issue #372)');
});

test('dock: the Handbook ledger page teaches the new contract', () => {
  const hb = readFileSync(join(ROOT, 'src/handbook.js'), 'utf8');
  const section = hb.slice(hb.indexOf('## The grid reads as a record'), hb.indexOf('## Working on many rows at once'));
  assert.match(section, /link opens the row in the \*\*dock\*\* beside the table/);
  assert.match(section, /⌘-click a row .* own browser tab/);
  assert.match(section, /document chip in a cell opens its entity in the dock/, 'a doc chip docks, and the page says so');
  assert.doesNotMatch(section, /side peek/, 'the retired peek is gone from the page');
  assert.match(APP, /return docChipCell\(f, item, \(\) => dockEntity\(db, id, \{ step: true \}\)\);/, 'and from the code');
  assert.match(section, /\*\*Docked is the default pose\*\*/, 'the page states the default');
  assert.match(section, /outward diagonal arrows .* expand/, 'and how to reach the full page');
});

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

test('no surface says "entity" to a reader where a table has a row term', () => {
  for (const literal of [
    "title: 'Add an entity'", "'Open entity page'", "Record noun", "Deleted entities",
    "'Search records…'", "title: 'Entity actions'", "'Roll up into a new entity…'",
    "? 'entity' : 'entities'", "${n.entityCount} entities", "New ${db.noun ?? db.name}",
    "no entity to attach to", "'record' : 'records'",
  ]) {
    assert.ok(!APP.includes(literal), `app.js still says ${literal}`);
  }
  assert.match(APP, /\+ New \$\{db\.term\.singular\}/, 'the grid\'s add row');
  assert.match(APP, /countLabel\(sel\.size, db\.term\)/, 'the puck count');
  assert.match(APP, /Search \$\{term\.plural\} to link as/, 'relation pickers speak the target\'s plural');
  assert.match(APP, /WeaveTerm\.count\(n\.entityCount, n\.term\)/, 'relation-map nodes');
  assert.match(APP, /WeaveTerm\.DEFAULT\.singular : WeaveTerm\.DEFAULT\.plural/, 'the workspace total speaks the default term');
  assert.doesNotMatch(APP, /\?\? 'record'/, 'no surface carries its own copy of the default noun');
});

test('the Name field\'s dialog carries the grouped term picker', () => {
  assert.match(APP, /if \(isEdit && existing\.role === 'name'\) kids\.push\(termSection\(state, changed\)\)/);
  const sec = fnBody('termSection');
  assert.doesNotMatch(sec, /datalist|term-options/, 'the flat datalist is gone (Kyle, 2026-09-02: the grouped selector from the mockup)');
  assert.match(sec, /searchPicker\(\{[\s\S]*groups: true/, 'the house picker draws the curated terms in groups');
  assert.match(sec, /custom: \(q\) => set\(q\)/, 'typing an unlisted word takes it as a custom term');
  assert.match(sec, /T\.options\(\)/, 'from term-core, not a second list');
  assert.match(sec, /T\.pluralize\(/, 'the plural derives');
  assert.match(sec, /class: 'form-control term-plural', readonly: ''/, 'the plural is read-only (Kyle, 2026-09-03: greyed, not editable)');
  assert.doesNotMatch(sec, /plur\.oninput|pluralTouched/, 'nothing edits the plural');
  assert.match(readFileSync(join(ROOT, 'public/style.css'), 'utf8'), /\.term-plural\[readonly\]/, 'and it is greyed');
  assert.match(APP, /groups = false, custom = null \}\) \{/, 'searchPicker grew the two options');
  assert.match(fnBody('searchPicker'), /const drawGroups = /, 'grouped text cells are the picker\'s third dialect');
  assert.match(fnBody('searchPicker'), /as a custom term/, 'the custom row names what it does');
  const css = readFileSync(join(ROOT, 'public/style.css'), 'utf8');
  assert.match(css, /\.picker-cell\.picker-term\.on/, 'the chosen term is marked');
});

test('the cell pop wears the cell’s own typography, not a restyle', () => {
  const body = fnBody('showCellPop');
  for (const prop of ['fontFamily', 'fontSize', 'fontWeight', 'color']) {
    assert.match(body, new RegExp(prop), `the pop copies the cell's ${prop}`);
  }
});

test('an empty chip invites writing, never promises navigation', () => {
  const arrow = rulesFor('.k-doc.is-empty::after');
  assert.equal(arrow.content, '"+"', 'the empty chip trades the ↗ for a +');
});

test('the relation chip’s × is spaced as the trailing piece it is', () => {
  const x = rulesFor('.k-rel > .x');
  assert.ok(x.margin?.startsWith('0 5px 0'), `the × follows the caret — got margin ${x.margin}`);
});

test('navigating away dismisses any floating picker', () => {
  const body = fnBody('dispatchRoute');
  assert.match(body, /chip-pop.*picker-pop|picker-pop.*chip-pop/, 'route() sweeps both popover kinds');
  assert.match(body, /\.remove\(\)/, 'and removes them');
});

test('a behind instance raises the toast and tints its chip', () => {
  const nav = fnBody('renderNav');
  assert.match(nav, /h\.behind/, 'the chip reads the health verdict');
  assert.match(nav, /is-behind/, 'and wears it');
  assert.match(nav, /toast\([^)]*behind main/, 'the toast names the condition');
  assert.match(nav, /behind main \(.*\)\. Run git pull, then restart weave\./, 'and the way out works on a plain clone (Issue #458)');
  assert.doesNotMatch(nav, /service promote/, 'not a command that needs a gerrit remote (Issue #649 removed it)');
  const chip = rulesFor('.nav-health.is-behind');
  assert.ok(chip.color, 'the stale chip changes color');
});

test('a stale process raises the toast and tints its chip louder than behind', () => {
  const nav = fnBody('renderNav');
  assert.match(nav, /h\.stale/, 'the chip reads the disk-vs-process verdict');
  assert.match(nav, /is-stale/, 'and wears it');
  assert.match(nav, /toast\([^)]*restart/i, 'the toast names the way out — a restart, not a pull');
  assert.match(nav, /h\.diskSha/, 'and names the commit that served the page');
  assert.ok(nav.indexOf('h.stale') < nav.indexOf('h.behind'),
    'stale is decided first: a stale process is also usually behind, and the restart is the answer to both');
  const chip = rulesFor('.nav-health.is-stale');
  assert.ok(chip.color, 'the stale-process chip changes color');
  assert.notEqual(chip.color, rulesFor('.nav-health.is-behind').color,
    'and reads apart from the merely-behind chip');
});

test('the entity page draws the System toggles — one read-only row per systemFields name, Activity excepted (Issue #174)', () => {
  const body = fnBody('renderEntityView');
  assert.match(body, /for \(const n of \(db\.systemFields \?\? \[\]\)\) \{\s*\n\s*if \(n === 'Activity' \|\| !SYSTEM_COLS\[n\]\) continue;/,
    'the page reads the same list the grid reads, and the same formatter');
  assert.match(body, /class: 'fieldrow fieldrow-system'/, 'a system row is a fieldrow, marked');
  assert.match(body, /SYSTEM_COLS\[n\]\(entity\)/, 'the value comes off the entity payload, like the grid cell');
  assert.equal(rulesFor('.fieldrow-system .fieldrow-value').color, 'var(--tblr-secondary)', 'read-only, dressed quiet');
});

test('the entity name wraps instead of clipping: a content-sized textarea, Enter commits (Issue #175)', () => {
  const body = fnBody('renderEntityView');
  assert.match(body, /const nameInput = el\('textarea', \{\s*\n\s*class: 'name-edit'/, 'a textarea, not an input — an input is one line by construction');
  assert.match(body, /rows: '1'/, 'one row at rest');
  assert.match(body, /if \(e\.key === 'Enter'\) \{ e\.preventDefault\(\); nameInput\.blur\(\); \}/, 'Enter commits; a name has no second line of its own');
  assert.match(body, /nameInput\.value = entity\.name/, 'the value is set, never a child text node');
  const css = rulesFor('.entity-head textarea.name-edit');
  assert.equal(css['field-sizing'], 'content', 'the box is as tall as the name');
  assert.equal(css.resize, 'none');
  assert.equal(css.width, '100%');
  assert.equal(css['max-width'], undefined, 'no 640px cap — the full name always shows');
  assert.ok(!CSS.includes('input.name-edit'), 'no stale input rule');
});
