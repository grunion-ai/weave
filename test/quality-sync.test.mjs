import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { seedWeaver } from '../src/weaver-seed.js';
import { scanSuites, planQualityMirror } from '../src/quality-mirror.js';
import { http, readMirror, apply, drift } from '../scripts/quality-sync.mjs';
import { withServer } from './lib/fixtures.mjs';

const ROOT = join(import.meta.dirname, '..');

test('the sync over HTTP heals a drifted tracker, writes run results onto Case Status, and leaves no drift (Issue #1244, Issue #1245)', async () => {
  const w = seedWeaver(new Weave());
  w.state.meta.name = 'weave';
  const suite = w.getTable('Quality/Suite');
  const ghost = w.createEntity(suite, { name: 'Ghost', values: { File: 'test/deleted-long-ago.test.mjs' } });
  w.createEntity(w.getTable('Quality/Case'), { name: 'orphaned', values: { Suite: ghost.id } });
  const scanned = scanSuites(ROOT);
  const target = scanned.find((s) => s.file === 'test/quality-sync.test.mjs');
  const results = new Map([[target.file, { ok: false, cases: new Map([[target.cases[0], 'Failing']]) }]]);

  await withServer(w, async ({ base }) => {
    const call = http(base, null);
    const before = await readMirror(call);
    const { ops, summary } = planQualityMirror(before.rows, scanned, results);
    assert.deepEqual(summary.missingFiles, ['test/deleted-long-ago.test.mjs']);
    assert.ok(drift(summary) > 0);
    await apply(call, ops, before);
    const after = await readMirror(call);
    const again = planQualityMirror(after.rows, scanned, results).summary;
    assert.equal(drift(again), 0, JSON.stringify(again));
    assert.equal(again.statusChanges, 0);
    const row = after.rows.find((r) => r.file === target.file);
    assert.equal(row.cases.find((c) => c.name === target.cases[0]).status, 'Failing');
  });
});

test('the sync refuses a workspace that is not the weave tracker (Issue #1244)', async () => {
  const w = new Weave();
  w.state.meta.name = 'scratch';
  await withServer(w, async ({ base }) => {
    await assert.rejects(readMirror(http(base, null)), /not weave/);
  });
});
