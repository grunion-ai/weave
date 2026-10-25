import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CEILING_FILE, overCeiling, tallyMisses, touchKey, unexplainedRaises } from './lib/touch.mjs';
import { states } from './lib/states.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const file = JSON.parse(readFileSync(new URL(`../${CEILING_FILE}`, import.meta.url), 'utf8'));

test('a miss is keyed by its surface and the element and classes the probe labels it with', () => {
  assert.equal(touchKey('list', 'button.k.k-state "State: Open (click to change)"'), 'list | button.k.k-state');
  assert.deepEqual(tallyMisses('list', [{ label: 'a.x "one"' }, { label: 'a.x "two"' }, { label: 'button "b"' }]), { 'list | a.x': 2, 'list | button': 1 });
});

test('the gate fails only a count over its ceiling, and a key the ceiling does not hold', () => {
  assert.deepEqual(overCeiling({ 'list | a.x': 2 }, { 'list | a.x': 2 }), []);
  assert.deepEqual(overCeiling({ 'list | a.x': 3 }, { 'list | a.x': 2 }), [{ key: 'list | a.x', seen: 3, ceiling: 2 }]);
  assert.deepEqual(overCeiling({ 'board | a.y': 1 }, {}), [{ key: 'board | a.y', seen: 1, ceiling: 0 }], 'zero tolerance outside the ceiling');
});

test('a new or raised ceiling needs a new reason; a lower one needs none', () => {
  const before = { misses: { 'list | a.x': 2 }, raised: { 'list | a.x': 'Feature #1: why' } };
  assert.deepEqual(unexplainedRaises(before, { misses: { 'list | a.x': 1 }, raised: {} }), []);
  assert.equal(unexplainedRaises(before, { misses: { 'list | a.x': 3 }, raised: before.raised }).length, 1, 'an old reason does not cover a second raise');
  assert.deepEqual(unexplainedRaises(before, { misses: { 'list | a.x': 3 }, raised: { 'list | a.x': 'Issue #2: a new reason' } }), []);
  assert.equal(unexplainedRaises(null, { misses: { 'board | b': 1 }, raised: { 'board | b': '  ' } }).length, 1, 'a blank reason is no reason');
});

test('every ceiling key names a state the touch probe walks, with a positive count and a reason', () => {
  const walked = new Set(states({ tag: 'touch' }).map((st) => (st.open ? `${st.surface.name}+${st.open.name}` : st.surface.name)));
  for (const [k, n] of Object.entries(file.misses)) {
    assert.ok(walked.has(k.split(' | ')[0]), `${k}: not a state the touch gate walks, as surface or surface+open`);
    assert.ok(Number.isInteger(n) && n > 0, `${k}: a positive count`);
    assert.ok(String(file.raised[k] ?? '').trim(), `${k}: says why`);
  }
  for (const k of Object.keys(file.raised)) assert.ok(k in file.misses, `raised["${k}"] names no ceiling`);
});

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const at = (rev) => { try { return JSON.parse(git('show', `${rev}:${CEILING_FILE}`)); } catch { return null; } };

test('this change raises no touch ceiling without a reason, against HEAD and the base it merges into', () => {
  assert.deepEqual(unexplainedRaises(at('HEAD'), file), []);
  assert.deepEqual(unexplainedRaises(at('HEAD^1'), at('HEAD') ?? file), []);
});
