/* The row window, the pure half (Issue #271).

   A grid used to draw every row: the Case table's 2,087 rows were 58,706 DOM
   nodes and one 17–52 s task on open, for fifteen rows on screen. Kyle's
   decision (2026-09-12): render the rows in view plus a buffer, keep the
   buffer AHEAD of the scroll direction so the next rows are painted before
   they scroll in, and hold the rest as two spacer rows whose heights keep the
   scrollbar honest. Data arrives in pages of 200 in sort/filter order, and
   the page past the window's leading edge is fetched before it is needed.

   No DOM here: scroll geometry in, a window and the pages to have ready out.
   public/app.js paints it. */
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
  // 600 / 30 = 20 rows in view; the buffer is one viewport of rows (min 20).
  const w = win();
  assert.equal(w.start, 0);
  assert.equal(w.end, 20 + 2 * 20, 'view + 2 buffers ahead');
  assert.equal(w.topPad, 0);
  assert.equal(w.bottomPad, (2087 - w.end) * 30, 'the spacer stands in for every row not drawn');
});

test('the buffer is never fewer than 20 rows, however short the viewport', () => {
  const w = win({ viewportH: 90, total: 500 }); // 3 rows in view
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

/* ── pages: which 200-row slices the window needs, and the one to have ready ── */

test('pagesFor names every page the window touches', () => {
  assert.deepEqual(GW.pagesFor({ start: 0, end: 60 }, 200, 2087), [0]);
  assert.deepEqual(GW.pagesFor({ start: 180, end: 260 }, 200, 2087), [0, 200]);
  assert.deepEqual(GW.pagesFor({ start: 1990, end: 2087 }, 200, 2087), [1800, 2000]);
  assert.deepEqual(GW.pagesFor({ start: 0, end: 0 }, 200, 0), []);
});

test('prefetchOffset is the page past the leading edge, in the direction of travel', () => {
  // Heading down from the top: the window ends at row 60, page 0 is loaded
  // with it, so the page to have ready is the one after — 200.
  assert.equal(win().prefetchOffset, 200);
  // Deep in the table heading down: the window [980, 1060) sits in page 800
  // and 1000; the next is 1200.
  assert.equal(win({ scrollTop: 30 * 1000, direction: 1 }).prefetchOffset, 1200);
  // Heading up from the same place: the window [960, 1040) starts in page
  // 800; the one before it is 600.
  assert.equal(win({ scrollTop: 30 * 1000, direction: -1 }).prefetchOffset, 600);
  // At either end there is nothing further to fetch.
  assert.equal(win({ scrollTop: 30 * 2087 }).prefetchOffset, null);
  assert.equal(win({ scrollTop: 0, direction: -1 }).prefetchOffset, null);
  // A whole table in one page prefetches nothing.
  assert.equal(win({ total: 150 }).prefetchOffset, null);
});

test('scrollTopFor puts a row inside the viewport with the least motion', () => {
  // scrollTop is body-relative: how many body pixels sit above the viewport's
  // top edge; headH is the sticky header covering that edge.
  const rowH = 30, viewportH = 600, headH = 40;
  // Already in view: no move.
  assert.equal(GW.scrollTopFor({ index: 25, rowH, viewportH, headH, scrollTop: 300 }), 300);
  // Below the view: the row lands at the bottom edge.
  assert.equal(GW.scrollTopFor({ index: 100, rowH, viewportH, headH, scrollTop: 0 }), 101 * rowH - viewportH);
  // Above the view (or under the header): the row lands just under the header.
  assert.equal(GW.scrollTopFor({ index: 3, rowH, viewportH, headH, scrollTop: 900 }), 3 * rowH - headH);
  assert.equal(GW.scrollTopFor({ index: 10, rowH, viewportH, headH, scrollTop: 290 }), 10 * rowH - headH, 'a row under the sticky header is not in view');
});
