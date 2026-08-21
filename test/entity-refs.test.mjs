import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave, WeaveError } from '../src/engine.js';
import { startServer } from '../src/server.js';

function seed() {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Issue' });
  w.createEntity('Issue', { name: 'Crash on save', doc: 'details' });
  return w;
}

test('engine getEntity accepts Table#pid and Space/Table#pid refs', () => {
  const w = seed();
  assert.equal(w.entityName(w.getEntity('Issue#1')), 'Crash on save');
  assert.equal(w.entityName(w.getEntity('Dev/Issue#1')), 'Crash on save');
  assert.throws(() => w.getEntity('Issue#99'), WeaveError);
  assert.throws(() => w.getEntity('Nope#1'), WeaveError);
});

test('REST /api/entities/:ref and /e/:ref accept Table#pid refs', async () => {
  const w = seed();
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const got = await fetch(`${base}/api/entities/Issue%231`);
    assert.equal(got.status, 200);
    assert.equal((await got.json()).name, 'Crash on save');

    const patched = await fetch(`${base}/api/entities/Issue%231`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: { Name: 'Crash fixed' } }),
    });
    assert.equal(patched.status, 200);
    assert.equal((await patched.json()).name, 'Crash fixed');

    const doc = await fetch(`${base}/e/Issue%231/doc.md`);
    assert.equal(doc.status, 200);
    assert.equal(await doc.text(), 'details');

    assert.equal((await fetch(`${base}/api/entities/Issue%2399`)).status, 404);
  } finally {
    server.close();
  }
});

test('findEntity (relation targets) accepts qualified Table#pid refs', () => {
  const w = seed();
  w.createTable({ space: 'Dev', name: 'Task' });
  w.createEntity('Task', { name: 'Fix it' });
  w.addRelation('Task', { name: 'Issue', targetDb: 'Issue', cardinality: 'many-to-one' });
  // Bare pid and uuid already work; the qualified form must too (Issue #21).
  assert.equal(w.entityName(w.findEntity('Issue', 'Issue#1')), 'Crash on save');
  assert.equal(w.entityName(w.findEntity('Issue', 'Dev/Issue#1')), 'Crash on save');
  // A qualified ref naming a DIFFERENT table must not resolve by pid.
  assert.equal(w.findEntity('Issue', 'Task#1'), undefined);
  // And the link path (relation target normalization) takes the qualified form.
  w.link('Task#1', 'Issue', 'Issue#1');
  const rel = Object.values(w.getTable('Task').fields).find((f) => f.name === 'Issue');
  assert.equal(w.getEntity('Task#1').values[rel.id], w.getEntity('Issue#1').id);
});
