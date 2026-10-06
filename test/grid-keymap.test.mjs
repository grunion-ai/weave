import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/grid-keymap.js');
const KM = globalThis.WeaveGridKeymap;

const k = (key, mod = {}) => ({ key, shift: false, meta: false, alt: false, ...mod });
const st = (over = {}) => ({ mode: 'rest', readonly: false, sel: new Set(), ...over });
const at = (key, mod, over) => KM.keymap(k(key, mod), st(over));
const act = (key, mod, over) => at(key, mod, over).type;

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
  assert.deepEqual(at('End'), { type: 'move', to: 'end' });
  assert.deepEqual(at('Home'), { type: 'move', to: 'home' });
  assert.equal(act('Escape'), 'none', 'Escape with nothing chosen is the browser’s');
});

test('with no row picked up, ⇧↑ / ⇧↓ grow a range of cells', () => {
  assert.deepEqual(at('ArrowUp', { shift: true }), { type: 'extendRange', dr: -1, dc: 0 });
  assert.deepEqual(at('ArrowDown', { shift: true }), { type: 'extendRange', dr: 1, dc: 0 });
});

test('Space still picks the ROW up, and ⇧↑ / ⇧↓ still extend that run (Feature #134)', () => {
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

test('open, ← and → belong to the caret — REST never steps out', () => {
  for (const key of ['ArrowLeft', 'ArrowRight']) {
    assert.equal(act(key, {}, { mode: 'edit' }), 'none', `${key} is the caret’s`);
    assert.equal(act(key, { shift: true }, { mode: 'edit' }), 'none', `⇧${key} selects text`);
  }
});

test('open, Home and End place the caret — the window does not move', () => {
  const open = { mode: 'edit' };
  assert.deepEqual(at('End', {}, open), { type: 'caret', to: 'end' });
  assert.deepEqual(at('Home', {}, open), { type: 'caret', to: 'home' });
  for (const mod of [{ shift: true }, { alt: true }, { meta: true }]) {
    assert.equal(act('End', mod, open), 'none', `${JSON.stringify(mod)} End is the browser’s`);
    assert.equal(act('Home', mod, open), 'none', `${JSON.stringify(mod)} Home is the browser’s`);
  }
  assert.deepEqual(at('End'), { type: 'move', to: 'end' });
  assert.deepEqual(at('Home'), { type: 'move', to: 'home' });
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

test('keyOf reads ⌘ and Ctrl as one modifier, and carries shift and alt', () => {
  assert.deepEqual(KM.keyOf({ key: 'a', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }),
    { key: 'a', meta: true, shift: false, alt: false });
  assert.deepEqual(KM.keyOf({ key: 'a', metaKey: false, ctrlKey: true, shiftKey: true, altKey: true }),
    { key: 'a', meta: true, shift: true, alt: true });
});

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
  const three = KM.extend({ ids, anchor: 'c', at: two.at, dir: 1 });
  assert.deepEqual([...three.selected], ['b', 'c']);
});

test('extending past either end holds the cursor at the end', () => {
  const ids = ['a', 'b', 'c'];
  const out = KM.extend({ ids, anchor: 'a', at: 'c', dir: 1 });
  assert.equal(out.at, 'c');
  assert.deepEqual([...out.selected], ['a', 'b', 'c']);
});

test('the open-cell keymap does not build the edge-through branch', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../public/grid-keymap.js', import.meta.url), 'utf8');
  assert.ok(!/caret\.atEnd|caret\.atStart/.test(src), 'no caret.atEnd or caret.atStart branch');
});

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

test('on a rating cell a digit sets it and Backspace clears it to 0 (Feature #231)', () => {
  assert.deepEqual(at('3', {}, { rate: 5 }), { type: 'rate', value: 3 });
  assert.deepEqual(at('0', {}, { rate: 5 }), { type: 'rate', value: 0 });
  assert.deepEqual(at('9', {}, { rate: 5 }), { type: 'rate', value: 5 }, 'past the max is the max');
  assert.deepEqual(at('Backspace', {}, { rate: 5 }), { type: 'rate', value: 0 });
  assert.deepEqual(at('Delete', {}, { rate: 5 }), { type: 'rate', value: 0 });
  assert.equal(act('x', {}, { rate: 5 }), 'none', 'a letter opens nothing: a rating has no text box');
  assert.equal(act('3', {}, { rate: 5, readonly: true }), 'none', 'a read-only rating keeps its value');
  assert.equal(act('3', { meta: true }, { rate: 5 }), 'none', '⌘3 is the browser\'s');
  assert.equal(act('ArrowRight', {}, { rate: 5 }), 'move', 'the arrows still walk the grid');
  assert.equal(act('3', {}, { mode: 'edit', rate: 5 }), 'none');
});

const PROBE_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter', 'Escape', 'Home', 'End',
  ' ', 'Backspace', 'Delete', 'PageUp', 'PageDown', 'F2', 'a', 'x', 'Q', '1', '/', '?', ';'];
const PROBE_MODS = [{}, { meta: true }, { shift: true }, { meta: true, shift: true }];
const PROBE_STATES = [{}, { sel: new Set(['r1']) }, { range: true }, { flip: true }, { readonly: true }];
const folded = (key) => (key.length === 1 && key !== ' ' && key !== '?' ? 'char' : key);
const answers = (mode, presses) => {
  const out = new Set();
  for (const p of presses) for (const s of PROBE_STATES) {
    const type = KM.keymap(k(p.key, p), st({ ...s, mode })).type;
    if (type !== 'none') out.add(`${folded(p.key)} → ${type}`);
  }
  return out;
};

test('at rest, ? opens the key sheet; in an open cell it is typed (Issue #268)', () => {
  assert.equal(act('?', { shift: true }), 'help', 'the ? a keyboard sends carries ⇧');
  assert.equal(act('?'), 'help');
  assert.equal(act('?', {}, { readonly: true }), 'help', 'a read-only cell still answers ?');
  assert.equal(act('?', { shift: true }, { mode: 'edit' }), 'none', 'open, ? is a character like any other');
  assert.equal(act('?', { meta: true }), 'none', '⌘? is not the sheet');
});

test('the key sheet lists every key the keymap answers, in both modes (Issue #268)', () => {
  assert.ok(Array.isArray(KM.bindings) && KM.bindings.length > 0, 'the keymap exports its rows');
  for (const mode of ['rest', 'edit']) {
    const probe = PROBE_KEYS.flatMap((key) => PROBE_MODS.map((m) => ({ key, ...m })));
    const rows = KM.bindings.filter((b) => b.mode === mode);
    const listed = answers(mode, rows.flatMap((b) => b.press));
    for (const hit of answers(mode, probe)) {
      assert.ok(listed.has(hit), `${mode}: the keymap answers ${hit} and no row on the sheet says so`);
    }
  }
});

test('every row on the key sheet is a key the keymap still answers, with words to print (Issue #268)', () => {
  for (const b of KM.bindings) {
    assert.ok(['rest', 'edit'].includes(b.mode), `${b.keys}: a known mode`);
    assert.ok(b.keys && b.does, `${JSON.stringify(b)}: keys and what they do, as the sheet prints them`);
    assert.ok(b.press.length > 0, `${b.keys}: at least one press`);
    const live = answers(b.mode, b.press).size > 0;
    assert.equal(live, !b.browser, b.browser
      ? `${b.mode} ${b.keys} is marked the browser's, but the keymap now claims it`
      : `${b.mode} ${b.keys} is on the sheet, but the keymap no longer answers it`);
  }
});
