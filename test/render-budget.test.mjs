import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JOURNEYS, cellsOf } from './lib/journeys.mjs';
import { clickKey, unexplainedRaises } from './lib/clicks.mjs';
import { BUDGET_FILE, judgeRenders } from './lib/renders.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const budget = JSON.parse(readFileSync(resolve(ROOT, BUDGET_FILE), 'utf8'));
const RENDERS = { field: 'renders', unit: 'renders' };

test('a render count at or under its budget passes; a median between counts rounds up', () => {
  assert.equal(judgeRenders('edit-cell|desktop', 6, { 'edit-cell|desktop': 6 }), null);
  assert.match(judgeRenders('edit-cell|desktop', 6.5, { 'edit-cell|desktop': 6 }), /rendered in 7 frames, budget 6/);
});

test('a count over its budget names the way to merge it; a missing budget or count says what to do', () => {
  const why = judgeRenders('open-row|desktop', 40, { 'open-row|desktop': 30 });
  assert.match(why, /raised\["open-row\|desktop"\]/);
  assert.match(why, /test\/render-budget\.json/);
  assert.match(judgeRenders('new-thing|phone', 4, {}), /add "new-thing\|phone": 4/);
  assert.match(judgeRenders('edit-cell|desktop', null, { 'edit-cell|desktop': 6 }), /no render count/);
});

test('a raised render budget needs a new reason', () => {
  const before = { renders: { 'edit-cell|desktop': 6 }, raised: {} };
  const after = { renders: { 'edit-cell|desktop': 9 }, raised: {} };
  assert.deepEqual(unexplainedRaises(before, after, RENDERS), ['edit-cell|desktop rose from 6 to 9 renders with no reason: write one under raised["edit-cell|desktop"]']);
  assert.deepEqual(unexplainedRaises(before, { ...after, raised: { 'edit-cell|desktop': 'Feature #1: the save shows a check' } }, RENDERS), []);
});

test('the budget file covers every journey cell, and nothing else', () => {
  const want = JOURNEYS.flatMap((j) => cellsOf(j).map((c) => clickKey(j.name, c))).sort();
  assert.deepEqual(Object.keys(budget.renders).sort(), want);
  assert.ok(Object.values(budget.renders).every((n) => Number.isInteger(n) && n > 0));
  for (const k of Object.keys(budget.raised)) assert.ok(k in budget.renders, `raised["${k}"] names no journey`);
});

const budgetAt = (rev) => { try { return JSON.parse(execFileSync('git', ['show', `${rev}:${BUDGET_FILE}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch { return null; } };

test('this change raises no render budget without a reason (Issue #1042)', () => {
  assert.deepEqual(unexplainedRaises(budgetAt('HEAD^1'), budget, RENDERS), []);
});
