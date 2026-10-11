import test from 'node:test';
import assert from 'node:assert/strict';
import { APP, HTML, CSS, fnBody } from './lib/source.mjs';

test('the retired menu markup is gone from app.js (Feature #296, Issue #762)', () => {
  for (const gone of ['dl-menu', 'tools-row', 'tools-group', 'tableSheetGroup', 'contextMenu(', 'dropdown-divider', 'phone-only']) {
    assert.equal(APP.includes(gone), false, `app.js still carries ${gone}`);
  }
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
