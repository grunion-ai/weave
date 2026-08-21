import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave, WeaveError } from '../src/engine.js';
import { startServer } from '../src/server.js';

/* Feature #65 — system fields. Every entity records who made it and who last
   changed it, alongside the timestamps it already carries. The four are
   SYSTEM fields: read-only, engine-maintained, shown or hidden per table —
   never stored in db.fields, never writable through values. Actor identity
   rides the engine instance (`w.actor`); each surface names its caller
   (server: X-Weave-Actor header, CLI: WEAVE_ACTOR or the OS user, MCP: the
   client name). This is the plumbing #14's audit log stands on. */

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
    // No header → the surface's own name, not a stale one from last request.
    const res2 = await fetch(`${base}/api/tables/Task/entities`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Anonymous' }),
    });
    assert.equal((await res2.json()).createdBy, 'web');
  } finally {
    server.close();
  }
});
