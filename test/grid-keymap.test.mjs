/* The grid keymap, REST (Feature #134), the pure half.

   Kyle, 2026-08-24: "I want to nav with L and R and tab". ← and → cannot
   navigate while a cell is a live text input — the caret already owns them —
   so cells REST as values and open on purpose. At rest the grid is a map:
   every arrow and Tab move, Space picks the row up, Return or a character
   opens the cell. Open, the caret takes ← and → back until Tab, Return or
   Esc; EDGE (step out at the text edge) is the one branch this file does
   not carry.

   docs/mockups/table-grid-keymaps.html holds the study's core and
   test/grid-patterns.test.mjs presses it; public/grid-keymap.js is that
   core ported into the app, and this suite pins the port plus the two
   pieces the app needs that a mockup did not: where a move lands on a real
   grid of stops, and how ⇧↑/⇧↓ grow a selection keyed on entity ids. */
import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/grid-keymap.js');
const KM = globalThis.WeaveGridKeymap;

const k = (key, mod = {}) => ({ key, shift: false, meta: false, alt: false, ...mod });
const st = (over = {}) => ({ mode: 'rest', readonly: false, sel: new Set(), ...over });
const at = (key, mod, over) => KM.keymap(k(key, mod), st(over));
const act = (key, mod, over) => at(key, mod, over).type;

/* ── at rest: the grid is a map ────────────────────────────────────────── */

test('at rest, every arrow moves — L and R included', () => {
  assert.deepEqual(at('ArrowLeft'), { type: 'move', dr: 0, dc: -1 });
  assert.deepEqual(at('ArrowRight'), { type: 'move', dr: 0, dc: 1 });
  assert.deepEqual(at('ArrowUp'), { type: 'move', dr: -1, dc: 0 });
  assert.deepEqual(at('ArrowDown'), { type: 'move', dr: 1, dc: 0 });
});

test('Tab moves along the row and wraps into the next; ⇧Tab walks back', () => {
  assert.deepEqual(at('Tab'), { type: 'move', dr: 0, dc: 1, wrap: 'grid' });
  assert.deepEqual(at('Tab', { shift: true }), { type: 'move', dr: 0, dc: -1, wrap: 'grid' });
});

test('Return or any character opens the cell; a read-only cell stays shut', () => {
  assert.deepEqual(at('Enter'), { type: 'edit', select: 'all' });
  assert.deepEqual(at('x'), { type: 'edit', select: 'replace' });
  assert.equal(act('Enter', {}, { readonly: true }), 'none');
  assert.equal(act('x', {}, { readonly: true }), 'none');
  assert.equal(act('x', { meta: true }), 'none', '⌘X is a shortcut, not a character');
});

test('the resting state hands over row selection for free', () => {
  assert.equal(act(' '), 'toggleSelect');
  const rows = { sel: new Set(['r1']) };
  assert.deepEqual(at('ArrowUp', { shift: true }, rows), { type: 'extendSelect', dir: -1 });
  assert.deepEqual(at('ArrowDown', { shift: true }, rows), { type: 'extendSelect', dir: 1 });
  assert.equal(act('a', { meta: true }), 'selectAll');
  assert.equal(act('Escape', {}, rows), 'clearSelect');
  // The first and the last row of the whole table (Issue #271): the grid
  // draws a window of rows, and a move past it scrolls the row in first.
  assert.deepEqual(at('End'), { type: 'move', to: 'end' });
  assert.deepEqual(at('Home'), { type: 'move', to: 'home' });
  assert.equal(act('End', {}, { mode: 'edit' }), 'none', 'open, End is the caret’s');
  assert.equal(act('Home', {}, { mode: 'edit' }), 'none', 'open, Home is the caret’s');
  assert.equal(act('Escape'), 'none', 'Escape with nothing chosen is the browser’s');
});

/* ── ⇧-arrows grow a range of CELLS (Feature #220) ─────────────────────── */

test('with no row picked up, ⇧↑ / ⇧↓ grow a range of cells', () => {
  assert.deepEqual(at('ArrowUp', { shift: true }), { type: 'extendRange', dr: -1, dc: 0 });
  assert.deepEqual(at('ArrowDown', { shift: true }), { type: 'extendRange', dr: 1, dc: 0 });
});

test('Space still picks the ROW up, and ⇧↑ / ⇧↓ still extend that run (Feature #134)', () => {
  // The one rule that keeps both readings honest: rows first. Space is
  // unchanged, and once a row is up the vertical shift-arrows are its.
  assert.equal(act(' '), 'toggleSelect');
  const rows = { sel: new Set(['r1', 'r2']) };
  assert.equal(act('ArrowUp', { shift: true }, rows), 'extendSelect');
  assert.equal(act('ArrowDown', { shift: true }, rows), 'extendSelect');
});

test('⇧← / ⇧→ are the range’s in both cases — a row selection has no width', () => {
  assert.deepEqual(at('ArrowLeft', { shift: true }), { type: 'extendRange', dr: 0, dc: -1 });
  assert.deepEqual(at('ArrowRight', { shift: true }), { type: 'extendRange', dr: 0, dc: 1 });
  assert.equal(act('ArrowRight', { shift: true }, { sel: new Set(['r1']) }), 'extendRange');
});

test('Esc lets the range go once the rows are back — one key, in order', () => {
  assert.equal(act('Escape', {}, { sel: new Set(['r1']), range: true }), 'clearSelect', 'rows first');
  assert.equal(act('Escape', {}, { range: true }), 'clearRange');
  assert.equal(act('Escape', {}, { range: false }), 'none');
});

test('an open cell keeps ⇧← / ⇧→ for text selection — a range is a resting gesture', () => {
  assert.equal(act('ArrowLeft', { shift: true }, { mode: 'edit' }), 'none');
  assert.equal(act('ArrowDown', { shift: true }, { mode: 'edit' }), 'commitMove');
});

test('on a toggle cell Space flips the switch — the one cell where Space is the value\'s key (Feature #202)', () => {
  assert.deepEqual(at(' ', {}, { flip: true }), { type: 'edit', select: 'all' });
  assert.equal(act(' ', {}, { flip: true, readonly: true }), 'toggleSelect', 'a read-only toggle hands Space back to selection');
  assert.equal(act(' ', {}, { flip: false }), 'toggleSelect');
  assert.equal(act(' ', {}, { mode: 'edit', flip: true }), 'none', 'open, Space is a space');
});

test('⇧Return makes the next row; ⌘Return opens the record', () => {
  assert.deepEqual(at('Enter', { shift: true }), { type: 'newRow', at: 'below', focus: 'first' });
  assert.equal(act('Enter', { meta: true }), 'open');
});

/* ── open: the caret takes ← and → back ────────────────────────────────── */

test('open, ← and → belong to the caret — REST never steps out', () => {
  for (const key of ['ArrowLeft', 'ArrowRight']) {
    assert.equal(act(key, {}, { mode: 'edit' }), 'none', `${key} is the caret’s`);
    assert.equal(act(key, { shift: true }, { mode: 'edit' }), 'none', `⇧${key} selects text`);
  }
});

test('open, Return commits down, Tab commits across, Esc reverts, ↑↓ commit and move', () => {
  const open = { mode: 'edit' };
  assert.deepEqual(at('Enter', {}, open), { type: 'commitMove', dr: 1, dc: 0 });
  assert.deepEqual(at('Tab', {}, open), { type: 'commitMove', dr: 0, dc: 1, wrap: 'grid' });
  assert.deepEqual(at('Tab', { shift: true }, open), { type: 'commitMove', dr: 0, dc: -1, wrap: 'grid' });
  assert.equal(act('Escape', {}, open), 'revert');
  assert.deepEqual(at('ArrowUp', {}, open), { type: 'commitMove', dr: -1, dc: 0 });
  assert.deepEqual(at('ArrowDown', {}, open), { type: 'commitMove', dr: 1, dc: 0 });
});

test('open, Space is still a space and a character is still typed', () => {
  assert.equal(act(' ', {}, { mode: 'edit' }), 'none');
  assert.equal(act('x', {}, { mode: 'edit' }), 'none');
});

test('open, ⇧Return and ⌘Return mean what they mean at rest', () => {
  assert.equal(act('Enter', { shift: true }, { mode: 'edit' }), 'newRow');
  assert.equal(act('Enter', { meta: true }, { mode: 'edit' }), 'open');
});

/* ── the keystroke, read off a DOM event ───────────────────────────────── */

test('keyOf reads ⌘ and Ctrl as one modifier, and carries shift and alt', () => {
  assert.deepEqual(KM.keyOf({ key: 'a', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }),
    { key: 'a', meta: true, shift: false, alt: false });
  assert.deepEqual(KM.keyOf({ key: 'a', metaKey: false, ctrlKey: true, shiftKey: true, altKey: true }),
    { key: 'a', meta: true, shift: true, alt: true });
});

/* ── where a move lands ────────────────────────────────────────────────── */

test('an arrow at the edge of the grid stays put rather than leaking out', () => {
  const g = { r: 0, c: 0, rows: 3, cols: 4 };
  assert.equal(KM.step(g, { dr: -1, dc: 0 }), null, '↑ on the first row');
  assert.equal(KM.step(g, { dr: 0, dc: -1 }), null, '← on the first column');
  assert.deepEqual(KM.step(g, { dr: 1, dc: 0 }), { r: 1, c: 0 });
  assert.deepEqual(KM.step({ r: 2, c: 3, rows: 3, cols: 4 }, { dr: 0, dc: 1 }), null, '→ on the last column');
});

test('Tab wraps into the next row; ⇧Tab into the previous one; neither leaves the grid', () => {
  assert.deepEqual(KM.step({ r: 0, c: 3, rows: 3, cols: 4 }, { dr: 0, dc: 1, wrap: 'grid' }), { r: 1, c: 0 });
  assert.deepEqual(KM.step({ r: 1, c: 0, rows: 3, cols: 4 }, { dr: 0, dc: -1, wrap: 'grid' }), { r: 0, c: 3 });
  assert.equal(KM.step({ r: 2, c: 3, rows: 3, cols: 4 }, { dr: 0, dc: 1, wrap: 'grid' }), null,
    'the last cell of the last row is the end — Tab never reaches the browser chrome (Issue #84)');
  assert.equal(KM.step({ r: 0, c: 0, rows: 3, cols: 4 }, { dr: 0, dc: -1, wrap: 'grid' }), null);
});

test('a move of nothing is nothing', () => {
  assert.equal(KM.step({ r: 1, c: 1, rows: 3, cols: 4 }, { dr: 0, dc: 0 }), null);
});

/* ── ⇧↑ / ⇧↓ extend a selection of ids, keyed like the checkbox column ── */

test('extending from nothing anchors on the row you are on and takes the next', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const out = KM.extend({ ids, anchor: null, at: 'b', dir: 1 });
  assert.deepEqual(out, { anchor: 'b', at: 'c', selected: new Set(['b', 'c']) });
});

test('extending walks the cursor and keeps the span between anchor and cursor', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const one = KM.extend({ ids, anchor: 'c', at: 'c', dir: -1 });
  assert.deepEqual([...one.selected], ['b', 'c']);
  const two = KM.extend({ ids, anchor: 'c', at: one.at, dir: -1 });
  assert.deepEqual([...two.selected], ['a', 'b', 'c']);
  assert.equal(two.at, 'a');
  // Walking back toward the anchor shrinks the run again.
  const three = KM.extend({ ids, anchor: 'c', at: two.at, dir: 1 });
  assert.deepEqual([...three.selected], ['b', 'c']);
});

test('extending past either end holds the cursor at the end', () => {
  const ids = ['a', 'b', 'c'];
  const out = KM.extend({ ids, anchor: 'a', at: 'c', dir: 1 });
  assert.equal(out.at, 'c');
  assert.deepEqual([...out.selected], ['a', 'b', 'c']);
});

/* ── the one branch not built ──────────────────────────────────────────── */

test('the port names where EDGE would go, and nothing more', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../public/grid-keymap.js', import.meta.url), 'utf8');
  assert.match(src, /EDGE/, 'the open-cell keymap says where the edge-through branch belongs');
  assert.ok(!/caret\.atEnd|caret\.atStart/.test(src), 'and does not build it');
});

/* ── the clipboard follows the selection (Feature #221) ─────────────────── */

/* Kyle, 2026-09-12 (B+): a click opens the cell exactly as before; ⌘C and
   ⌘V follow the selection, and when there is none they take the CELL. Text
   selected inside an open control is the browser's own copy and paste; a
   collapsed caret, a picker's popover, a checkbox and a resting cell all
   read as "no selection". */

test('at rest, ⌘C and ⌘V take the cell', () => {
  assert.equal(KM.clipboardTarget({ mode: 'rest' }), 'cell');
  assert.equal(KM.clipboardTarget({ mode: 'rest', selectionCollapsed: false }), 'cell', 'a page selection outside the cell is not the cell’s text');
});

test('open with text selected, the clipboard is the caret’s', () => {
  assert.equal(KM.clipboardTarget({ mode: 'edit', selectionCollapsed: false }), 'text');
});

test('open with a collapsed caret — or a control that has no caret — the clipboard takes the cell', () => {
  assert.equal(KM.clipboardTarget({ mode: 'edit', selectionCollapsed: true }), 'cell');
  assert.equal(KM.clipboardTarget({ mode: 'edit' }), 'cell', 'a number, date, select or checkbox control reports no selection at all');
});
