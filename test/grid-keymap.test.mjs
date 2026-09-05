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
  assert.deepEqual(at('ArrowUp', { shift: true }), { type: 'extendSelect', dir: -1 });
  assert.deepEqual(at('ArrowDown', { shift: true }), { type: 'extendSelect', dir: 1 });
  assert.equal(act('a', { meta: true }), 'selectAll');
  assert.equal(act('Escape', {}, { sel: new Set(['r1']) }), 'clearSelect');
  assert.equal(act('Escape'), 'none', 'Escape with nothing chosen is the browser’s');
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
