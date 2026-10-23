import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { JOURNEYS, cellsOf } from './lib/journeys.mjs';
import { clickKey, unexplainedRaises } from './lib/clicks.mjs';
import { BUDGET_FILE, busyFaults, feedbackOf, judgeMs, median, skeletonDelay } from './lib/feedback.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const budget = JSON.parse(readFileSync(resolve(ROOT, BUDGET_FILE), 'utf8'));
const MS = { field: 'ms', unit: 'ms' };

test('the median of the runs is the middle one, or the mean of the middle two', () => {
  assert.equal(median([300, 20, 40]), 40);
  assert.equal(median([10, 30, 20, 40]), 25);
  assert.equal(median([null, 12]), 12, 'a run that painted nothing is left out');
  assert.equal(median([]), null);
});

test('a journey answers when its slowest action answers', () => {
  assert.equal(feedbackOf([{ kind: 'start', ms: null }, { kind: 'press', ms: 16 }, { kind: 'Tab', ms: 33 }]), 33);
  assert.equal(feedbackOf([{ kind: 'press', ms: null }]), null);
});

test('a time at or under its budget passes and a time over it is refused with the way to merge it', () => {
  assert.equal(judgeMs('edit-cell|desktop', 48, { 'edit-cell|desktop': 60 }), null);
  assert.equal(judgeMs('edit-cell|desktop', 60.4, { 'edit-cell|desktop': 60 }), null);
  const why = judgeMs('edit-cell|desktop', 1040, { 'edit-cell|desktop': 60 });
  assert.match(why, /edit-cell\|desktop first answered on screen 1040 ms after its action, budget 60 ms/);
  assert.match(why, /raised\["edit-cell\|desktop"\]/);
  assert.match(why, /test\/feedback-budget\.json/);
});

test('a journey with no budget is told what to write, and one that painted nothing is refused', () => {
  assert.match(judgeMs('new-thing|phone', 41.6, {}), /add "new-thing\|phone": 42/);
  assert.match(judgeMs('new-thing|phone', null, { 'new-thing|phone': 50 }), /painted nothing/);
});

test('a spinner inside the skeleton delay is refused; a skeleton after it is the loading state working', () => {
  const skeleton = { sel: '.sk-card', visual: true, at: 0, on: 160, since: 160, act: 'start', off: 1100 };
  assert.deepEqual(busyFaults([skeleton], 150), []);
  const early = { ...skeleton, sel: '.grid-loader', on: 20, since: 20 };
  assert.match(busyFaults([early], 150)[0], /\.grid-loader showed a loading state 20 ms after start, inside the 150 ms skeleton delay/);
});

test('aria-busy that clears inside the skeleton delay is refused; aria-busy on a slow action is not', () => {
  const blip = { sel: 'div.table-wrap[aria-busy]', visual: false, at: 100, on: 104, since: 4, act: 'press', off: 140 };
  assert.match(busyFaults([blip], 150)[0], /went busy 4 ms after press and settled 40 ms after it/);
  assert.deepEqual(busyFaults([{ ...blip, off: 1120 }], 150), []);
  assert.deepEqual(busyFaults([{ ...blip, off: null }], 150), [], 'still busy when the walk ended');
});

test('the skeleton delay is read from the app source wherever it lives', () => {
  assert.equal(skeletonDelay(), 150);
  const dir = mkdtempSync(join(tmpdir(), 'skeleton-'));
  writeFileSync(join(dir, 'a.js'), 'const X = 1;');
  writeFileSync(join(dir, 'b.js'), 'const SKELETON_SHOW_AFTER_MS = 90;');
  assert.equal(skeletonDelay(`${dir}/`), 90);
  writeFileSync(join(dir, 'b.js'), '');
  assert.throws(() => skeletonDelay(`${dir}/`), /SKELETON_SHOW_AFTER_MS/);
});

test('a raised feedback budget needs a new reason, as a raised click budget does', () => {
  const before = { ms: { 'edit-cell|desktop': 60 }, raised: {} };
  const after = { ms: { 'edit-cell|desktop': 90 }, raised: {} };
  assert.deepEqual(unexplainedRaises(before, after, MS), ['edit-cell|desktop rose from 60 to 90 ms with no reason: write one under raised["edit-cell|desktop"]']);
  assert.deepEqual(unexplainedRaises(before, { ...after, raised: { 'edit-cell|desktop': 'Issue #1: the save now waits for a lock' } }, MS), []);
  assert.deepEqual(unexplainedRaises(before, { ms: { 'edit-cell|desktop': 40 }, raised: {} }, MS), []);
});

test('the budget file covers every journey cell, and nothing else', () => {
  const want = JOURNEYS.flatMap((j) => cellsOf(j).map((c) => clickKey(j.name, c))).sort();
  assert.deepEqual(Object.keys(budget.ms).sort(), want);
  assert.ok(Object.values(budget.ms).every((n) => Number.isInteger(n) && n > 0));
  for (const k of Object.keys(budget.raised)) assert.ok(k in budget.ms, `raised["${k}"] names no journey`);
});

test('a journey let off the busy check names a journey and the Issue that will fix it', () => {
  for (const [k, why] of Object.entries(budget.busy)) {
    assert.ok(k in budget.ms, `busy["${k}"] names no journey`);
    assert.match(why, /Issue #\d+/, `busy["${k}"] names no Issue`);
  }
});

const budgetAt = (rev) => { try { return JSON.parse(execFileSync('git', ['show', `${rev}:${BUDGET_FILE}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch { return null; } };

test('this change raises no feedback budget without a reason (Issue #1042)', () => {
  assert.deepEqual(unexplainedRaises(budgetAt('HEAD^1'), budget, MS), []);
});
