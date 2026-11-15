import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { seedWeaver } from '../src/weaver-seed.js';
import { syncQualityMirror } from '../src/quality-mirror.js';

const scanned = (name) => [{ file: 'test/alpha.test.mjs', name, cases: ['one', 'two'] }];

test('a suite whose scanned name changed is renamed in the mirror without a second row', () => {
  const w = seedWeaver(new Weave());
  w.state.meta.name = 'weave';
  syncQualityMirror(w, scanned('Alpha suite'));
  const suites = w.getTable('Quality/Suite');
  assert.deepEqual(w.listEntities(suites.id).map((r) => w.entityName(r)), ['Alpha suite']);

  const summary = syncQualityMirror(w, scanned('Alpha, renamed'));
  assert.equal(summary.renamedSuites, 1);
  assert.deepEqual(w.listEntities(suites.id).map((r) => w.entityName(r)), ['Alpha, renamed']);
  assert.equal(syncQualityMirror(w, scanned('Alpha, renamed')).renamedSuites, 0);
});
