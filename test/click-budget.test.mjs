import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JOURNEYS, cellsOf } from './lib/journeys.mjs';
import { BUDGET_FILE, clickKey, judge, unexplainedRaises } from './lib/clicks.mjs';
import { LEDGER as FEEDBACK } from './lib/feedback.mjs';
import { LEDGER as RENDER } from './lib/renders.mjs';
import { LEDGER as VITAL } from './lib/vitals.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const budget = JSON.parse(readFileSync(resolve(ROOT, BUDGET_FILE), 'utf8'));

test('a journey key is its name and cell', () => {
  assert.equal(clickKey('edit-cell', 'desktop'), 'edit-cell|desktop');
  assert.equal(clickKey('phone-picker', 'phone'), 'phone-picker|phone');
});

test('a count at its budget passes', () => {
  assert.equal(judge('edit-cell|desktop', 2, { 'edit-cell|desktop': 2 }), null);
  assert.equal(judge('load-home|desktop', 0, { 'load-home|desktop': 0 }), null);
});

test('a count above its budget is refused, and the refusal names the way to merge it', () => {
  const why = judge('edit-cell|desktop', 3, { 'edit-cell|desktop': 2 });
  assert.match(why, /edit-cell\|desktop took 3 clicks, budget 2/);
  assert.match(why, /raised/, 'names the reason field');
  assert.match(why, /test\/click-budget\.json/);
});

test('a count below its budget asks for the budget to come down in the same change', () => {
  const why = judge('edit-cell|desktop', 1, { 'edit-cell|desktop': 2 });
  assert.match(why, /edit-cell\|desktop took 1 click, budget 2/);
  assert.match(why, /lower .* to 1/);
});

test('a journey with no budget is refused and told what to write', () => {
  assert.match(judge('new-thing|phone', 4, {}), /add "new-thing\|phone": 4/);
});

const RAISES = [
  { ledger: 'click', key: 'edit-cell|desktop', steps: [1, 2, 3, 4], rose: 'edit-cell|desktop rose from 2 to 3 clicks with no reason: write one under raised["edit-cell|desktop"]' },
  { ledger: 'feedback', opts: FEEDBACK, key: 'edit-cell|desktop', steps: [40, 60, 90, 120], rose: 'edit-cell|desktop rose from 60 to 90 ms with no reason: write one under raised["edit-cell|desktop"]' },
  { ledger: 'render', opts: RENDER, key: 'edit-cell|desktop', steps: [4, 6, 9, 12], rose: 'edit-cell|desktop rose from 6 to 9 renders with no reason: write one under raised["edit-cell|desktop"]' },
  { ledger: 'vitals', opts: VITAL, key: 'load-home|desktop|lcp', steps: [700, 900, 1200, 1500], rose: 'load-home|desktop|lcp rose from 900 to 1200 with no reason: write one under raised["load-home|desktop|lcp"]' },
];

for (const { ledger, opts, key, steps: [lower, was, high, higher], rose } of RAISES) {
  const field = opts?.field ?? 'clicks';
  const at = (n, why = {}) => ({ [field]: { [key]: n, 'open-row|desktop': 2 }, raised: why });
  const raise = (...args) => unexplainedRaises(...args, ...(opts ? [opts] : []));
  const before = at(was);

  test(`a lower, equal or new ${ledger} budget needs no reason`, () => {
    assert.deepEqual(raise(before, before), []);
    assert.deepEqual(raise(before, at(lower)), []);
    assert.deepEqual(raise(before, { ...before, [field]: { ...before[field], 'add-row|desktop': 3 } }), [], 'a new key sets its own baseline');
    assert.deepEqual(raise(null, before), [], 'no budget file before this change');
  });

  test(`a raised ${ledger} budget with no reason is refused and names the key and the numbers`, () => {
    assert.deepEqual(raise(before, at(high)), [rose]);
    assert.equal(raise(before, at(high, { [key]: '   ' })).length, 1, 'a blank reason is no reason');
  });

  test(`a ${ledger} raise carrying a new reason passes; an old reason does not cover a second raise`, () => {
    const after = at(high, { [key]: 'Issue #950: deleting now asks to confirm' });
    assert.deepEqual(raise(before, after), []);
    assert.equal(raise(after, at(higher, after.raised)).length, 1);
  });
}

test('the budget file covers every journey cell, and nothing else', () => {
  const want = JOURNEYS.flatMap((j) => cellsOf(j).map((c) => clickKey(j.name, c))).sort();
  assert.deepEqual(Object.keys(budget.clicks).sort(), want);
  assert.ok(Object.values(budget.clicks).every((n) => Number.isInteger(n) && n >= 0));
  for (const k of Object.keys(budget.raised)) assert.ok(k in budget.clicks, `raised["${k}"] names no journey`);
});

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
const budgetAt = (rev) => { try { return JSON.parse(git('show', `${rev}:${BUDGET_FILE}`)); } catch { return null; } };

test('this change raises no click budget without a reason (Feature #338)', () => {
  assert.deepEqual(unexplainedRaises(budgetAt('HEAD^1'), budget), []);
});
