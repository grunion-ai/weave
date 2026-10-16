import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/grid-window.js');
const GW = globalThis.WeaveGridWindow;

const win = (over = {}) => GW.windowFor({ scrollTop: 0, viewportH: 600, rowH: 30, total: 2087, ...over });

test('an empty table is an empty window with no spacers', () => {
  assert.deepEqual(win({ total: 0 }), { start: 0, end: 0, topPad: 0, bottomPad: 0 });
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

test('Issue #961: scrolled down the middle, the window holds two buffers on both sides', () => {
  const w = win({ scrollTop: 30 * 1000 });
  assert.equal(w.start, 1000 - 40, 'two behind, so a reversal mid-fling still lands on drawn rows');
  assert.equal(w.end, 1000 + 20 + 40, 'two ahead');
  assert.equal(w.topPad, w.start * 30);
  assert.equal(w.bottomPad, (2087 - w.end) * 30);
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
    const w = win({ scrollTop });
    assert.equal(w.topPad + (w.end - w.start) * 30 + w.bottomPad, 2087 * 30, `at ${scrollTop}`);
    assert.ok(w.start <= w.end);
  }
});

test('scrollTopFor puts a row inside the viewport with the least motion', () => {
  const rowH = 30, viewportH = 600, headH = 40;
  assert.equal(GW.scrollTopFor({ index: 25, rowH, viewportH, headH, scrollTop: 300 }), 300);
  assert.equal(GW.scrollTopFor({ index: 100, rowH, viewportH, headH, scrollTop: 0 }), 101 * rowH - viewportH);
  assert.equal(GW.scrollTopFor({ index: 3, rowH, viewportH, headH, scrollTop: 900 }), 3 * rowH - headH);
  assert.equal(GW.scrollTopFor({ index: 10, rowH, viewportH, headH, scrollTop: 290 }), 10 * rowH - headH, 'a row under the sticky header is not in view');
});

test('Issue #962: the feed asks for the next page once the loaded rows end within three screens', () => {
  const feed = (over = {}) => GW.feedFor({ scrollTop: 0, viewportH: 600, rowH: 30, loaded: 200, total: 900, ...over });
  assert.equal(feed(), null, 'at the top of 200 loaded rows there are nine screens left');
  assert.equal(feed({ scrollTop: 200 * 30 - 4 * 600 }), 200, 'three screens left: ask for the rows from 200');
  assert.equal(feed({ scrollTop: 200 * 30 - 5 * 600 }), null, 'four screens left: not yet');
  assert.equal(feed({ loaded: 900 }), null, 'every row is here');
  assert.equal(feed({ loaded: 50, total: 900, viewportH: 2000 }), 50, 'a tall viewport past its rows asks at once');
});

test('Issue #961: a refresh batch is whole pages and stays under the server cap of 500 rows', () => {
  assert.equal(GW.BATCH % GW.PAGE, 0);
  assert.ok(GW.BATCH <= 500);
});
