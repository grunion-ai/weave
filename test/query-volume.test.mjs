import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { seed, percentile } from '../scripts/bench-query.mjs';

const ROWS = 50000;
const RUNS = 20;
const WARMUPS = 2;
export const LOOKUP_SORT_RATIO_CEILING = 4;

test(`the first page of a ${ROWS}-row table sorted by a lookup costs at most ${LOOKUP_SORT_RATIO_CEILING}x the unsorted first page (Issues #1093, #1511)`, (t) => {
  const w = new Weave();
  const { row } = seed(w, { rows: ROWS, owners: 1000 });
  const sorted = () => w.query(row.id, { limit: 50, sort: [{ field: 'Owner name', dir: 'asc' }] });
  const unsorted = () => w.query(row.id, { limit: 50 });
  for (let i = 0; i < WARMUPS; i++) { sorted(); unsorted(); }
  const times = { sorted: [], unsorted: [] };
  for (let i = 0; i < RUNS; i++) {
    for (const [name, page] of [['sorted', sorted], ['unsorted', unsorted]]) {
      const t0 = performance.now();
      const out = page();
      times[name].push(performance.now() - t0);
      assert.equal(out.items.length, 50);
      assert.equal(out.total, ROWS);
    }
  }
  for (const list of Object.values(times)) list.sort((a, b) => a - b);
  const sortedP50 = percentile(times.sorted, 0.5);
  const unsortedP50 = percentile(times.unsorted, 0.5);
  const ratio = sortedP50 / unsortedP50;
  t.diagnostic(`query-volume lookup sort p50 ${sortedP50.toFixed(1)} ms (p95 ${percentile(times.sorted, 0.95).toFixed(1)} ms), unsorted p50 ${unsortedP50.toFixed(1)} ms, ratio ${ratio.toFixed(2)}x, ceiling ${LOOKUP_SORT_RATIO_CEILING}x`);
  assert.ok(ratio <= LOOKUP_SORT_RATIO_CEILING,
    `the lookup-sorted first page reads ${sortedP50.toFixed(1)} ms at p50 against ${unsortedP50.toFixed(1)} ms unsorted (${ratio.toFixed(1)}x): the sort is walking every row again instead of reusing its cached keys and order`);
});
