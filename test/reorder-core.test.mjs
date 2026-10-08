import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
await import('../public/reorder.js');
const R = globalThis.WeaveReorder;

test('one shared reorder module is loaded before app.js (Feature #282)', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('<script src="/reorder.js" defer></script>'), 'index.html loads public/reorder.js');
  assert.ok(html.indexOf('/reorder.js') < html.indexOf('"/app.js"'), 'before app.js');
  assert.equal(R.HOLD_MS, 250, 'a long press of 250 ms lifts on touch');
});

test('edgeSpeed scrolls only inside the edge band and past the edge, and stops the moment the pointer leaves it (Issues #3, #432, #450)', () => {
  assert.equal(R.edgeSpeed(300, 100, 500), 0, 'the middle of the container holds still');
  assert.equal(R.edgeSpeed(100 + R.BAND + 1, 100, 500), 0, 'one pixel inside the band edge holds still');
  assert.ok(R.edgeSpeed(105, 100, 500) < 0, 'near the top edge it scrolls back');
  assert.ok(R.edgeSpeed(495, 100, 500) > 0, 'near the bottom edge it scrolls on');
  assert.ok(R.edgeSpeed(498, 100, 500) > R.edgeSpeed(470, 100, 500), 'deeper in the band is faster');
  assert.equal(R.edgeSpeed(560, 100, 500), R.STEP, 'past the edge runs at full speed');
  assert.equal(R.edgeSpeed(40, 100, 500), -R.STEP, 'both ways');
  assert.ok(R.edgeSpeed(105, 100, 160) < 0, 'a short container still scrolls at its edge');
  assert.equal(R.edgeSpeed(125, 100, 160), 0, 'because its band narrows to a third');
  assert.equal(R.edgeSpeed(130, 100, 160), 0, 'and keeps a still middle');
});

test('nearest picks the item under or closest to the pointer, in two dimensions (Issue #115 multi-column values)', () => {
  const col = (left, tops) => tops.map((top) => ({ left, right: left + 100, top, bottom: top + 30, width: 100, height: 30 }));
  const rects = [...col(0, [0, 30, 60]), ...col(130, [0, 30])];
  assert.equal(R.nearest(rects, 50, 45), 1, 'inside a row');
  assert.equal(R.nearest(rects, 50, 140), 2, 'below a column, its last row');
  assert.equal(R.nearest(rects, 170, 45), 4, 'the second column');
  assert.equal(R.nearest([], 0, 0), -1, 'nothing to pick');
  assert.equal(R.before(rects[1], 50, 40, 'y'), true, 'the top half lands before');
  assert.equal(R.before(rects[1], 50, 50, 'y'), false, 'the bottom half lands after');
  assert.equal(R.before(rects[3], 140, 10, 'x'), true, 'the left half lands before on a row of columns');
});

test('columnShift opens a gap the width of the dragged column and slides only the neighbours between (Feature #282)', () => {
  const widths = [100, 60, 80, 40];
  assert.deepEqual(R.columnShift({ widths, from: 3, to: 0 }), [40, 40, 40, 0], 'moving left pushes the passed columns right by its width');
  assert.deepEqual(R.columnShift({ widths, from: 0, to: 2 }), [0, -100, -100, 0], 'moving right pulls them left');
  assert.deepEqual(R.columnShift({ widths, from: 1, to: 1 }), [0, 0, 0, 0], 'no move, no slide');
  const lefts = [0, 100, 160, 240];
  assert.equal(R.gapStart({ lefts, widths, from: 3, to: 0 }), 0, 'the gap opens where the target started');
  assert.equal(R.gapStart({ lefts, widths, from: 0, to: 2 }), 140, 'or ends where the last passed column ended');
  assert.equal(R.gapStart({ lefts, widths, from: 1, to: 1 }), 100, 'a column dropped on itself stays put');
});
