import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave, WeaveError } from '../src/engine.js';
import { startServer } from '../src/server.js';

function fresh(actor) {
  const w = new Weave(actor ? { actor } : {});
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  return w;
}

test('who created and who last modified, per actor', () => {
  const w = fresh('ada');
  const t = w.createEntity('Task', { name: 'T' });
  assert.equal(t.createdBy, 'ada');
  assert.equal(t.modifiedBy, 'ada');

  w.actor = 'grace';
  w.updateEntity(t.id, { Name: 'T2' });
  const read = w.getEntity(t.id);
  assert.equal(read.createdBy, 'ada', 'createdBy never changes');
  assert.equal(read.modifiedBy, 'grace');
});

test('the default actor is local, and activity entries carry the actor', () => {
  const w = fresh();
  const t = w.createEntity('Task', { name: 'T' });
  assert.equal(t.createdBy, 'local');
  w.actor = 'ada';
  w.setDoc(t.id, 'hello');
  const last = w.getEntity(t.id).activity.at(-1);
  assert.equal(last.actor, 'ada');
});

test('system fields are read-only and per-table visibility is schema state', () => {
  const w = fresh();
  assert.throws(() => w.createEntity('Task', { name: 'T', values: { 'Created By': 'me' } }), /not found|read-only/i);

  w.updateTable('Task', { systemFields: ['Created At', 'Modified By'] });
  const schema = w.describeSchema();
  const task = schema.find((sp) => !sp.system).tables.find((t) => t.name === 'Task');
  assert.deepEqual(task.systemFields, ['Created At', 'Modified By']);
  assert.throws(() => w.updateTable('Task', { systemFields: ['Nope'] }), /system field/i);
});

test('readEntity exposes the four system values', () => {
  const w = fresh('ada');
  const t = w.createEntity('Task', { name: 'T' });
  const read = w.readEntity(t.id);
  assert.equal(read.createdBy, 'ada');
  assert.equal(read.modifiedBy, 'ada');
  assert.ok(read.createdAt);
  assert.ok(read.updatedAt);
});

test('the server names its caller from X-Weave-Actor', async () => {
  const w = fresh();
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/tables/Task/entities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Weave-Actor': 'agent-7' },
      body: JSON.stringify({ name: 'Via HTTP' }),
    });
    assert.equal(res.status, 201);
    const e = await res.json();
    assert.equal(e.createdBy, 'agent-7');
    const res2 = await fetch(`${base}/api/tables/Task/entities`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Anonymous' }),
    });
    assert.equal((await res2.json()).createdBy, 'web');
  } finally {
    server.close();
  }
});

test('Activity is no system column: refused on write, stripped from old tables, still on the entity read (Feature #315)', () => {
  const w = fresh('ada');
  assert.throws(() => w.updateTable('Task', { systemFields: ['Activity'] }), /'Activity' is not a system field/);
  w.updateTable('Task', { systemFields: ['Created At'] });
  const dump = w.exportJSON();
  const task = Object.values(dump.tables).find((x) => x.name === 'Task');
  task.systemFields = ['Created At', 'Activity'];
  for (const v of task.tableViews) v.fields.push('sys:Activity');
  const w2 = new Weave();
  w2.importJSON(dump);
  const after = w2.getTable('Task');
  assert.deepEqual(after.systemFields, ['Created At'], 'an old table loses its Activity switch on load');
  assert.ok(after.tableViews.every((v) => !v.fields.includes('sys:Activity')), 'and no view keeps an Activity column');
  const schema = w2.describeSchema();
  const doc = schema.find((sp) => !sp.system).tables.find((t) => t.name === 'Task');
  doc.systemFields = ['Created At', 'Activity'];
  w2.applySchema(schema);
  assert.deepEqual(w2.getTable('Task').systemFields, ['Created At'], 'an old schema document applies without bringing it back');
  const t = w2.createEntity('Task', { name: 'T' });
  w2.setDoc(t.id, 'hello');
  assert.ok(w2.readEntity(t.id).activity.length >= 2, 'the entity read keeps its history: created + doc-updated');
});
