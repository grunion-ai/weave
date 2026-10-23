import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { seed, percentile } from '../scripts/bench-query.mjs';

const ROWS = 50000;
const RUNS = 20;
const WARMUPS = 2;
export const LOOKUP_SORT_P95_BUDGET_MS = 6;

test(`the first page of a ${ROWS}-row table sorted by a lookup answers under ${LOOKUP_SORT_P95_BUDGET_MS} ms at p95 (Issue #1093)`, () => {
  const w = new Weave();
  const { row } = seed(w, { rows: ROWS, owners: 1000 });
  const page = () => w.query(row.id, { limit: 50, sort: [{ field: 'Owner name', dir: 'asc' }] });
  for (let i = 0; i < WARMUPS; i++) page();
  const times = [];
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    const out = page();
    times.push(performance.now() - t);
    assert.equal(out.items.length, 50);
    assert.equal(out.total, ROWS);
  }
  times.sort((a, b) => a - b);
  const p95 = percentile(times, 0.95);
  const p50 = percentile(times, 0.5);
  assert.ok(p95 < LOOKUP_SORT_P95_BUDGET_MS, `p95 ${p95.toFixed(1)} ms (p50 ${p50.toFixed(1)} ms), budget ${LOOKUP_SORT_P95_BUDGET_MS} ms`);
});
