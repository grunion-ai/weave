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

test('Issue #938: scrolled down the middle, the window holds two buffers on both sides', () => {
  const w = win({ scrollTop: 30 * 1000 });
  assert.equal(w.start, 1000 - 40, 'two buffers behind');
  assert.equal(w.end, 1000 + 20 + 40, 'two ahead');
  assert.equal(w.topPad, w.start * 30);
  assert.equal(w.bottomPad, (2087 - w.end) * 30);
});

test('Issue #938: a reversal reaches the rows already drawn, so the window carries no direction', () => {
  assert.equal(GW.travelFor, undefined, 'the direction state went with the asymmetric window');
  const flat = win({ scrollTop: 30 * 1000 });
  for (const direction of [1, -1, 0, undefined]) {
    assert.deepEqual(win({ scrollTop: 30 * 1000, direction }), flat, `direction ${direction} moved the window`);
  }
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

const page = (over = {}) => ({
  total: 2,
  trashCount: 0,
  all: 2,
  items: [
    { id: 'a', revision: 'r1', fields: { Name: 'Alpha', Note: 'one' }, raw: { Name: 'Alpha', Note: 'one' }, updatedAt: '2026-11-01T00:00:00.000Z', modifiedBy: 'kyle', createdAt: '2026-10-01T00:00:00.000Z', createdBy: 'kyle' },
    { id: 'b', revision: 'r2', fields: { Name: 'Beta', Note: 'two' }, raw: { Name: 'Beta', Note: 'two' }, updatedAt: '2026-11-01T00:00:00.000Z', modifiedBy: 'kyle', createdAt: '2026-10-01T00:00:00.000Z', createdBy: 'kyle' },
  ],
  ...over,
});
const touched = (over = {}) => {
  const fresh = page(over);
  fresh.items = fresh.items.map((item, i) => (i ? item : { ...item, revision: 'r9', updatedAt: '2026-11-13T00:00:00.000Z' }));
  return fresh;
};
const DRAWN = ['Name', 'Note'];

test('a page whose stamps moved but whose drawn cells did not draws the same grid (Issue #1702)', () => {
  assert.equal(GW.samePage(page(), touched(), DRAWN), true);
});

test('a page with a changed cell draws a different grid (Issue #1702)', () => {
  const fresh = touched();
  fresh.items[0].fields.Note = 'moved';
  fresh.items[0].raw.Note = 'moved';
  assert.equal(GW.samePage(page(), fresh, DRAWN), false);
});

test('a view that draws Modified At or Modified By holds the stamp against the cache (Issue #1702)', () => {
  assert.equal(GW.samePage(page(), touched(), [...DRAWN, 'Modified At']), false);
  assert.equal(GW.samePage(page(), touched(), [...DRAWN, 'Modified By']), true, 'the author did not change, only the time did');
  const author = touched();
  author.items[0].modifiedBy = 'sam';
  assert.equal(GW.samePage(page(), author, [...DRAWN, 'Modified By']), false);
});

test('a moved row count, trash count or row order draws a different grid (Issue #1702)', () => {
  assert.equal(GW.samePage(page(), touched({ total: 3 }), DRAWN), false);
  assert.equal(GW.samePage(page(), touched({ trashCount: 1 }), DRAWN), false);
  assert.equal(GW.samePage(page(), touched({ all: 3 }), DRAWN), false);
  const swapped = touched();
  swapped.items.reverse();
  assert.equal(GW.samePage(page(), swapped, DRAWN), false);
});

test('a missing page is never the same page (Issue #1702)', () => {
  assert.equal(GW.samePage(null, page(), DRAWN), false);
  assert.equal(GW.samePage(page(), null, DRAWN), false);
});

test('a field named like a stamp is compared, never stripped (Issue #1702)', () => {
  const cached = page();
  const fresh = touched();
  cached.items[0].fields.updatedAt = 'keep';
  fresh.items[0].fields.updatedAt = 'changed';
  assert.equal(GW.samePage(cached, fresh, [...DRAWN, 'updatedAt']), false);
});
