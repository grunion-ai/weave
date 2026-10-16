import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/grid-window.js');
const GW = globalThis.WeaveGridWindow;

const win = (over = {}) => GW.windowFor({ scrollTop: 0, viewportH: 600, rowH: 30, total: 2087, ...over });

test('an empty table is an empty window with no spacers', () => {
  assert.deepEqual(win({ total: 0 }), { start: 0, end: 0, topPad: 0, bottomPad: 0, prefetchOffset: null });
});

test('a table shorter than the viewport is drawn whole', () => {
  const w = win({ total: 12 });
  assert.equal(w.start, 0);
  assert.equal(w.end, 12);
  assert.equal(w.topPad, 0);
  assert.equal(w.bottomPad, 0);
});

test('at the top the window is one viewport plus two buffers ahead, and nothing behind', () => {
  const w = win();
  assert.equal(w.start, 0);
  assert.equal(w.end, 20 + 2 * 20, 'view + 2 buffers ahead');
  assert.equal(w.topPad, 0);
  assert.equal(w.bottomPad, (2087 - w.end) * 30, 'the spacer stands in for every row not drawn');
});

test('the buffer is never fewer than 20 rows, however short the viewport', () => {
  const w = win({ viewportH: 90, total: 500 });
  assert.equal(w.end, 3 + 2 * 20);
});

test('scrolled down the middle, the buffer leads in the direction of travel', () => {
  const w = win({ scrollTop: 30 * 1000, direction: 1 });
  assert.equal(w.start, 1000 - 20, 'one buffer behind');
  assert.equal(w.end, 1000 + 20 + 40, 'two ahead');
  assert.equal(w.topPad, w.start * 30);
  assert.equal(w.bottomPad, (2087 - w.end) * 30);
});

test('scrolling up flips the buffer: two behind the eye, one ahead', () => {
  const w = win({ scrollTop: 30 * 1000, direction: -1 });
  assert.equal(w.start, 1000 - 40);
  assert.equal(w.end, 1000 + 20 + 20);
});

test('at the bottom the window ends on the last row and the bottom spacer is zero', () => {
  const w = win({ scrollTop: 30 * 2087 - 600 });
  assert.equal(w.end, 2087);
  assert.equal(w.bottomPad, 0);
  assert.ok(w.start < 2087 - 20, 'and reaches back past the viewport');
});

test('a scrollTop past the end, or negative, is clamped rather than thrown', () => {
  assert.equal(win({ scrollTop: 30 * 5000 }).end, 2087);
  assert.equal(win({ scrollTop: -400 }).start, 0);
});

test('an unmeasured row height (0, NaN, missing) falls back to the density default', () => {
  for (const rowH of [0, NaN, undefined, -3]) {
    const w = win({ rowH, total: 100 });
    assert.equal(w.topPad, 0);
    assert.equal(w.bottomPad, (100 - w.end) * GW.ROW_H.comfortable, `rowH ${rowH} reads as the comfortable default`);
  }
  assert.ok(GW.ROW_H.compact < GW.ROW_H.comfortable, 'compact rows are shorter');
});

test('the spacers and the drawn rows always add up to the whole table', () => {
  for (const scrollTop of [0, 300, 29_999, 30 * 2000, 30 * 2087]) {
    for (const direction of [1, -1]) {
      const w = win({ scrollTop, direction });
      assert.equal(w.topPad + (w.end - w.start) * 30 + w.bottomPad, 2087 * 30, `at ${scrollTop} going ${direction}`);
      assert.ok(w.start <= w.end);
    }
  }
});

test('pagesFor names every page the window touches', () => {
  assert.deepEqual(GW.pagesFor({ start: 0, end: 60 }, 200, 2087), [0]);
  assert.deepEqual(GW.pagesFor({ start: 180, end: 260 }, 200, 2087), [0, 200]);
  assert.deepEqual(GW.pagesFor({ start: 1990, end: 2087 }, 200, 2087), [1800, 2000]);
  assert.deepEqual(GW.pagesFor({ start: 0, end: 0 }, 200, 0), []);
});

test('prefetchOffset is the page past the leading edge, in the direction of travel', () => {
  assert.equal(win().prefetchOffset, 200);
  assert.equal(win({ scrollTop: 30 * 1000, direction: 1 }).prefetchOffset, 1200);
  assert.equal(win({ scrollTop: 30 * 1000, direction: -1 }).prefetchOffset, 600);
  assert.equal(win({ scrollTop: 30 * 2087 }).prefetchOffset, null);
  assert.equal(win({ scrollTop: 0, direction: -1 }).prefetchOffset, null);
  assert.equal(win({ total: 150 }).prefetchOffset, null);
});

test('scrollTopFor puts a row inside the viewport with the least motion', () => {
  const rowH = 30, viewportH = 600, headH = 40;
  assert.equal(GW.scrollTopFor({ index: 25, rowH, viewportH, headH, scrollTop: 300 }), 300);
  assert.equal(GW.scrollTopFor({ index: 100, rowH, viewportH, headH, scrollTop: 0 }), 101 * rowH - viewportH);
  assert.equal(GW.scrollTopFor({ index: 3, rowH, viewportH, headH, scrollTop: 900 }), 3 * rowH - headH);
  assert.equal(GW.scrollTopFor({ index: 10, rowH, viewportH, headH, scrollTop: 290 }), 10 * rowH - headH, 'a row under the sticky header is not in view');
});

test('travelFor reads a direction from a row of travel, never from a pixel (Issue #317)', () => {
  const rowH = 30;
  assert.deepEqual(GW.travelFor({ scrollTop: 973, lastTop: 1000, direction: 1, rowH }), { direction: 1, lastTop: 1000 });
  assert.deepEqual(GW.travelFor({ scrollTop: 969, lastTop: 1000, direction: 1, rowH }), { direction: -1, lastTop: 969 });
  assert.deepEqual(GW.travelFor({ scrollTop: 1030, lastTop: 1000, direction: -1, rowH }), { direction: 1, lastTop: 1030 });
  assert.deepEqual(GW.travelFor({ scrollTop: 940, lastTop: 1000, direction: 1, rowH }), { direction: -1, lastTop: 940 });
  assert.deepEqual(GW.travelFor({ scrollTop: 1000, lastTop: 1000, direction: -1, rowH }), { direction: -1, lastTop: 1000 });
  assert.deepEqual(GW.travelFor({ scrollTop: 20, lastTop: 0, rowH: 0 }), { direction: 1, lastTop: 0 });
  assert.deepEqual(GW.travelFor({ scrollTop: 50, lastTop: 0, rowH: 0 }), { direction: 1, lastTop: 50 });
});
