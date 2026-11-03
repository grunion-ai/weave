import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { unexplainedRaises } from './lib/clicks.mjs';
import { fastest, median } from './lib/feedback.mjs';
import { BUDGET_FILE, METRICS, RUNS, VITALS, clsOf, judgeVital, vitalKey } from './lib/vitals.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const budget = JSON.parse(readFileSync(resolve(ROOT, BUDGET_FILE), 'utf8'));
const VITAL = { field: 'vitals', unit: '' };

test('CLS is the largest session window of shifts: gaps over 1 s or windows over 5 s start a new one', () => {
  assert.equal(clsOf([]), 0);
  assert.equal(clsOf([{ t: 0, value: 0.02 }, { t: 500, value: 0.03 }]), 0.05);
  assert.equal(clsOf([{ t: 0, value: 0.02 }, { t: 1600, value: 0.03 }]), 0.03, 'a 1.6 s gap splits the window');
  const steady = Array.from({ length: 12 }, (_, i) => ({ t: i * 900, value: 0.01 }));
  assert.ok(Math.abs(clsOf(steady) - 0.06) < 1e-9, 'a window closes at 5 s');
});

test('a vital at or under its budget passes and one over it names the way to merge it', () => {
  assert.equal(judgeVital('load-home|desktop|lcp', 812.4, { 'load-home|desktop|lcp': 900 }), null);
  assert.equal(judgeVital('load-home|desktop|cls', 0.0204, { 'load-home|desktop|cls': 0.02 }), null);
  const why = judgeVital('load-home|desktop|inp', 140, { 'load-home|desktop|inp': 96 });
  assert.match(why, /load-home\|desktop\|inp measured 140, budget 96/);
  assert.match(why, /raised\["load-home\|desktop\|inp"\]/);
  assert.match(judgeVital('open-table|phone|cls', 0.0312, {}), /add "open-table\|phone\|cls": 0\.031/);
});

test('a raised vitals budget needs a new reason', () => {
  const before = { vitals: { 'load-home|desktop|lcp': 900 }, raised: {} };
  const after = { vitals: { 'load-home|desktop|lcp': 1200 }, raised: {} };
  assert.deepEqual(unexplainedRaises(before, after, VITAL), ['load-home|desktop|lcp rose from 900 to 1200 with no reason: write one under raised["load-home|desktop|lcp"]']);
  assert.deepEqual(unexplainedRaises(before, { ...after, raised: { 'load-home|desktop|lcp': 'Feature #1: the home page draws a chart' } }, VITAL), []);
});

test('the budget file covers LCP, CLS and INP for load-home and open-table on desktop and phone, and nothing else', () => {
  const want = VITALS.flatMap((j) => ['desktop', 'phone'].flatMap((c) => METRICS.map((m) => vitalKey(j.name, c, m)))).sort();
  assert.deepEqual(VITALS.map((j) => j.name), ['load-home', 'open-table']);
  assert.deepEqual(Object.keys(budget.vitals).sort(), want);
  assert.ok(Object.values(budget.vitals).every((n) => Number.isFinite(n) && n > 0));
  for (const k of Object.keys(budget.raised)) assert.ok(k in budget.vitals, `raised["${k}"] names no vital`);
});

const budgetAt = (rev) => { try { return JSON.parse(execFileSync('git', ['show', `${rev}:${BUDGET_FILE}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch { return null; } };

test('this change raises no vitals budget without a reason (Issue #1042)', () => {
  assert.deepEqual(unexplainedRaises(budgetAt('HEAD^1'), budget, VITAL), []);
});
const RECORDED = {
  'load-home|phone|lcp': { runs: [448, 232, 252, 572, 496, 472, 300], red: 350 },
  'open-table|desktop|inp': { runs: [184, 208, 224, 184, 152, 184, 152], red: 160 },
};

test('a budget is judged on the fastest of the seven runs, which a loaded runner cannot inflate (Issue #1327)', () => {
  for (const [key, { runs, red }] of Object.entries(RECORDED)) {
    assert.equal(runs.length, RUNS, `${key}: the recorded runs are one full pass`);
    assert.equal(fastest(runs), Math.min(...runs), `${key}: the judged value is the fastest run`);
    assert.ok(fastest(runs) < median(runs), `${key}: the median ${median(runs)} carries the runner, the fastest ${fastest(runs)} does not`);
    assert.equal(judgeVital(key, fastest(runs), { [key]: red }), null, `${key}: the fastest run clears ${red}, the budget main run 41238444862 held red against`);
    assert.match(judgeVital(key, median(runs), { [key]: red }), /make the page faster/, `${key}: the median is what turned main red`);
    assert.equal(judgeVital(key, fastest(runs), budget.vitals), null, `${key}: the fastest run clears the budget in force`);
  }
});

test('the raised budgets stand over the fastest runs they were raised past, and keep their reasons', () => {
  for (const [key, { runs }] of Object.entries(RECORDED)) {
    assert.ok(budget.vitals[key] >= Math.min(...runs), `${key}: a budget under the fastest run of a red main pass would red it again`);
  }
  assert.ok(budget.vitals['open-table|phone|inp'] >= 64, 'phone INP measured 56 to 64 on the green tips');
  for (const k of ['open-table|desktop|inp', 'open-table|phone|inp']) assert.match(budget.raised[k], /Issue #1215/);
  for (const k of ['load-home|phone|lcp', 'open-table|desktop|inp']) assert.match(budget.raised[k], /Issue #1273/);
});
