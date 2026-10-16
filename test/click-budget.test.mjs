import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JOURNEYS, cellsOf } from './lib/journeys.mjs';
import { BUDGET_FILE, clickKey, judge, unexplainedRaises } from './lib/clicks.mjs';

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

const BEFORE = { clicks: { 'edit-cell|desktop': 2, 'open-row|desktop': 2 }, raised: {} };

test('a lower, equal or new budget needs no reason', () => {
  assert.deepEqual(unexplainedRaises(BEFORE, BEFORE), []);
  assert.deepEqual(unexplainedRaises(BEFORE, { clicks: { 'edit-cell|desktop': 1, 'open-row|desktop': 2 }, raised: {} }), []);
  assert.deepEqual(unexplainedRaises(BEFORE, { clicks: { ...BEFORE.clicks, 'add-row|desktop': 3 }, raised: {} }), [], 'a new journey sets its own baseline');
  assert.deepEqual(unexplainedRaises(null, BEFORE), [], 'no budget file before this change');
});

test('a raised budget with no reason is refused and names the key and the numbers', () => {
  const after = { clicks: { ...BEFORE.clicks, 'edit-cell|desktop': 3 }, raised: {} };
  assert.deepEqual(unexplainedRaises(BEFORE, after), ['edit-cell|desktop rose from 2 to 3 clicks with no reason: write one under raised["edit-cell|desktop"]']);
  assert.equal(unexplainedRaises(BEFORE, { ...after, raised: { 'edit-cell|desktop': '   ' } }).length, 1, 'a blank reason is no reason');
});

test('a raise carrying a new reason passes; an old reason does not cover a second raise', () => {
  const after = { clicks: { ...BEFORE.clicks, 'edit-cell|desktop': 3 }, raised: { 'edit-cell|desktop': 'Issue #950: deleting now asks to confirm' } };
  assert.deepEqual(unexplainedRaises(BEFORE, after), []);
  const again = { clicks: { ...after.clicks, 'edit-cell|desktop': 4 }, raised: after.raised };
  assert.equal(unexplainedRaises(after, again).length, 1);
});

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
