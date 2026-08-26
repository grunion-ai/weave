/* The marks, drawn (Issue #87).

   A mark was the Unicode character rendered at the font size, so every one of
   them came out a different optical size — Kyle: "bug quater done and 3/4 done
   are too small… reflresh is also too small". A size scale cannot fix that;
   the box was already right and the ink inside it was not. These are the same
   marks as flat vectors on the Iconly canvas.

   The contract that matters most is the key: a row that stored '✓' months ago
   must keep working and simply start drawing. */

import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/field-dialog-core.js');
await import('../public/mark-icons.js');
const core = globalThis.fieldDialogCore;
const marks = globalThis.weaveMarkIcons;

test('every mark an author can pick has a shape', () => {
  for (const g of core.STATE_ICONS.filter(Boolean)) {
    assert.ok(marks.has(g), `no shape for ${g}`);
    assert.ok(marks.markSvg(g).length > 20, `${g} has an empty shape`);
  }
});

test('the key is the stored character, so nothing has to migrate', () => {
  // '✓' is what a state saved in June holds. It must resolve without a lookup
  // table, a prefix, or a rewrite of the row.
  assert.ok(marks.has('✓'));
  assert.equal(marks.markSvg('nope'), null);
  assert.equal(marks.markSvg(''), null);
});

test('the chrome controls Kyle called out are drawn too', () => {
  for (const g of ['⟳', '⛶', '⧉', '‹', '↑', '↓']) assert.ok(marks.has(g), `${g} is still a font glyph`);
});

test('every shape is one flat vector on the shared canvas', () => {
  for (const [g, svg] of Object.entries(marks.MARKS)) {
    assert.doesNotMatch(svg, /<svg|viewBox/, `${g} carries its own svg element`);
    assert.doesNotMatch(svg, /fill="#|stroke="#|rgb\(/, `${g} hard-codes a colour`);
    // No number is bigger than the canvas. Relative segments carry negative
    // deltas, so this checks magnitude; the real overflow gate is the browser
    // bounding-box case in test/icon-vocabulary-browser.test.mjs.
    for (const n of svg.match(/-?\d+(\.\d+)?/g) ?? []) {
      assert.ok(Math.abs(Number(n)) <= 24.5, `${g} has ${n} outside the canvas`);
    }
  }
});

test('a stroked mark carries the weight of a filled one', () => {
  const widths = new Set();
  for (const svg of Object.values(marks.MARKS)) {
    for (const m of svg.matchAll(/stroke-width="([\d.]+)"/g)) widths.add(m[1]);
  }
  assert.deepEqual([...widths], ['2.6'], 'one stroke weight across the whole set');
});

test('letters stay letters — a pictograph would lose what the letterform says', () => {
  for (const ch of ['ƒ', 'Σ', 'B', 'I', '¶', '#']) {
    assert.equal(marks.has(ch), false, `${ch} should stay type`);
  }
});
