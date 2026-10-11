import test from 'node:test';
import assert from 'node:assert/strict';
import { APP, HTML, CSS, fnBody } from './lib/source.mjs';

test('the retired menu markup is gone from app.js (Feature #296, Issue #762)', () => {
  for (const gone of ['dl-menu', 'tools-row', 'tools-group', 'tableSheetGroup', 'contextMenu(', 'dropdown-divider']) {
    assert.equal(APP.includes(gone), false, `app.js still carries ${gone}`);
  }
  for (const fn of ['menu', 'menuRow', 'dotsMenu', 'kindDots', 'kindContext']) {
    assert.doesNotMatch(fnBody(fn), /phone-only|phone: true/, `${fn} draws no phone-only menu row`);
  }
});

await import('../public/menu-core.js');
const ROWS_SRC = APP.slice(APP.indexOf('const MENU_ROWS = {'), APP.indexOf('\n};\n', APP.indexOf('const MENU_ROWS = {')));

test('every kind in the registry has exactly one row builder in app.js (Feature #296)', () => {
  const keys = [...ROWS_SRC.matchAll(/^  (?:'([a-z-]+)'|([a-z]+)): \(/gm)].map((m) => m[1] ?? m[2]);
  assert.deepEqual(keys, globalThis.menuCore.kinds(), 'MENU_ROWS names every kind once, in registry order');
  assert.match(fnBody('menuFor'), /globalThis\.menuCore\.assemble\(kind, MENU_ROWS\[kind\]\(obj, ctx\)\)/, 'rows are laid out by the pure registry');
});

test('every trigger opens a kind\'s menu through menuFor (Feature #296)', () => {
  assert.match(fnBody('kindDots'), /menuFor\(kind, /, 'the ⋮ button');
  assert.match(fnBody('kindContext'), /addEventListener\('contextmenu'[\s\S]*menuFor\(kind, /, 'right-click');
  assert.match(fnBody('fieldMenuButton'), /menuFor\('field', /, 'the column ⋮');
  assert.match(fnBody('buildWsRail'), /menuFor\('workspace', /, 'the tray chip, click and right-click');
  for (const [fn, kind] of [['navTableMenu', 'table'], ['tableChrome', 'table'], ['showSpace', 'space'], ['showView', 'share-page'], ['showHome', 'workspace'], ['renderEntityView', 'record']]) {
    assert.match(fnBody(fn), new RegExp(`kind(?:Dots|Context)\\([^,]*'${kind}'|kind(?:Dots|Context)\\('${kind}'`), `${fn} opens the ${kind} definition`);
  }
  assert.match(fnBody('renderEntityView'), /kindDots\('doc', f, /, 'the document section ⋮');
  assert.match(fnBody('renderEntityView'), /'doc', f, \(\) => \(\{ entity \}\)\)/, 'and its right-click');
});

test('rows that left the menus stay out of app.js menus (Feature #296)', () => {
  for (const gone of ['Column stats…', 'Export CSV', 'Rename table…', 'Change icon…', 'Update logo…', 'Row term (', 'Edit field…', 'Open the composed model (.json)', 'Clear sort', 'Duplicate table']) {
    assert.equal(ROWS_SRC.includes(gone), false, `the registry still carries ${gone}`);
    assert.equal(APP.includes(`label: '${gone}'`), false, `a menu row still says ${gone}`);
  }
  assert.doesNotMatch(fnBody('fieldMenuButton'), /onSort|sortLabelsFor/, 'the column menu holds no sort rows');
});

test('no menu row is a Bootstrap dropdown-item; only the menu-less hold button keeps that default', () => {
  assert.equal((APP.match(/dropdown-item/g) ?? []).length, 1, 'one dropdown-item left in app.js');
  assert.match(fnBody('holdToConfirm'), /rowClass = 'dropdown-item'/, 'and it is the hold button default for the Trash page and the field dialog');
  for (const fn of ['menu', 'menuRow', 'dotsMenu']) assert.doesNotMatch(fnBody(fn), /dropdown-item/, `${fn} draws no dropdown-item`);
});

test('one function builds a role="menu" panel, and every action menu goes through it', () => {
  assert.equal((APP.match(/role: 'menu'/g) ?? []).length, 1, 'one role: menu in app.js');
  assert.doesNotMatch(APP, /role="menu"'|setAttribute\('role', 'menu'\)/, 'no second spelling of it');
  assert.match(fnBody('menu'), /role: 'menu'/, 'and it is the builder');
  for (const fn of ['dotsMenu', 'crumbFoldMenu', 'accountMenu', 'fieldMenuButton', 'buildWsRail']) {
    assert.match(fnBody(fn), /\bmenu\(/, `${fn} opens through menu()`);
  }
  assert.doesNotMatch(fnBody('fieldMenuButton'), /showPopover/, 'the column menu is a menu, not a panel');
});

test('the builder orders and validates through menu-core, loaded before app.js', () => {
  const body = fnBody('menu');
  assert.match(body, /globalThis\.menuCore\.plan\(items, \{ sheet \}\)/, 'every menu is planned by the pure core');
  assert.match(body, /globalThis\.menuCore\.move\(/, 'the arrow keys come from the core');
  assert.match(body, /globalThis\.menuCore\.typeahead\(/, 'and so does typeahead');
  assert.ok(HTML.includes('<script src="/menu-core.js" defer></script>'), 'index.html loads menu-core.js');
  assert.ok(HTML.indexOf('menu-core.js') < HTML.indexOf('"/app.js"'), 'before app.js');
});

test('rows carry menu roles and the trigger reports its state', () => {
  const row = fnBody('menuRow');
  assert.match(row, /role: checkable \? 'menuitemcheckbox' : 'menuitem'/);
  assert.match(fnBody('dotsMenu'), /'aria-haspopup': 'menu', 'aria-expanded': 'false'/);
  assert.match(fnBody('menu'), /setAttribute\?\.\('aria-expanded', 'true'\)/);
});

test('the phone sheet reuses the picker sheet rules and gives rows 44px', () => {
  assert.match(CSS, /\.chip-pop\.picker-pop, \.chip-pop\.wv-menu-sheet \{ position: fixed;/, 'one sheet rule for pickers and menus');
  assert.match(CSS, /\.wv-menu-sheet \.wv-menu-row \{ min-height: 44px;/);
  assert.match(fnBody('menu'), /sheet = MENU_SHEET\.matches/, 'the sheet is the default under the phone breakpoint');
  assert.match(APP, /const MENU_SHEET = matchMedia\('\(max-width: 600px\)'\)/);
});

test('the retired menu styles are gone from the stylesheet', () => {
  for (const gone of ['.dl-menu', '.tools-row', '.tools-group', '.dropdown-divider']) {
    assert.equal(CSS.includes(gone), false, `style.css still styles ${gone}`);
  }
});
