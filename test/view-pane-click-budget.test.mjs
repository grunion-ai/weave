import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { GOALS, BUDGET_FILE } from './lib/view-pane-goals.mjs';
import { unexplainedRaises } from './lib/clicks.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const budget = JSON.parse(readFileSync(resolve(ROOT, BUDGET_FILE), 'utf8'));

test('the View pane budget file holds one count per goal of the 2026-11-27 trial, and nothing else', () => {
  assert.deepEqual(Object.keys(budget.clicks).sort(), GOALS.map((g) => g.name).sort());
  assert.ok(Object.values(budget.clicks).every((n) => Number.isInteger(n) && n > 0));
  for (const k of Object.keys(budget.raised)) assert.ok(k in budget.clicks, `raised["${k}"] names no goal`);
});

const budgetAt = (rev) => {
  try { return JSON.parse(execFileSync('git', ['show', `${rev}:${BUDGET_FILE}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch { return null; }
};

test('this change raises no View pane click budget without a reason', () => {
  assert.deepEqual(unexplainedRaises(budgetAt('HEAD^1'), budget), []);
});
