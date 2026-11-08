import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { withServer } from './lib/fixtures.mjs';
import { prPlan, SMOKE, gating } from '../scripts/ci-test.mjs';
import { testFiles, lanes } from '../scripts/test.mjs';

const ROOT = join(import.meta.dirname, '..');

test('withServer serves the given workspace on a free port with its options and hands back what the body returns (Issue #666)', async () => {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  let held;
  const out = await withServer(w, { limits: { bodyBytes: 1024 } }, async (running) => {
    held = running;
    assert.ok(running.port > 0);
    assert.equal(running.base, `http://127.0.0.1:${running.port}`);
    const res = await running.fetch('/api/health');
    assert.equal(res.status, 200);
    await res.text();
    return 'body result';
  });
  assert.equal(out, 'body result');
  assert.equal(held.server.listening, false, 'the server is closed once the body settles');
});

test('withServer with only a body serves a blank workspace and closes even when the body throws (Issue #666)', async () => {
  let held;
  await assert.rejects(withServer(async (running) => {
    held = running;
    const res = await running.fetch('/api/health');
    assert.equal(res.status, 200);
    throw new Error('body failed');
  }), /body failed/);
  assert.equal(held.server.listening, false);
});

test('a change to the shared server fixture selects no browser suite beyond the smoke set, so it never widens the PR gate (Issue #666, Issue #966)', () => {
  const groups = gating(lanes(testFiles(ROOT), ROOT));
  const manifest = prPlan(groups, ['test/lib/fixtures.mjs'], (file) => readFileSync(join(ROOT, file), 'utf8'), () => 1);
  const browser = manifest.filter((s) => s.lane === 'browser').flatMap((s) => s.files).sort();
  assert.deepEqual(browser, [...SMOKE].sort());
});
