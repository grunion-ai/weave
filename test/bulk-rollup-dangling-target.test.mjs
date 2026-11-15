import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

function seeded() {
  const w = new Weave({ name: 'bulk' });
  w.createSpace({ name: 'Ops' });
  const task = w.createTable({ space: 'Ops', name: 'Task' });
  const owner = w.createTable({ space: 'Ops', name: 'Owner' });
  w.addRelation(task.id, { name: 'Owner', targetDb: owner.id, cardinality: 'many-to-one' });
  const row = w.createEntity(task.id, { Name: 'one' });
  const { token } = w.createAccount({ name: 'ed', role: 'editor' });
  w.setRequireAuth(true);
  return { w, task, owner, row, token };
}

async function bulk(port, token, body) {
  const res = await fetch(`http://127.0.0.1:${port}/api/bulk`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

test('a bulk rollup through a relation whose target table is gone is not mistaken for a schema change and does not crash', async () => {
  const { w, task, row, token } = seeded();
  const field = w.getField(task.id, 'Owner');
  field.config.targetDb = 'tbl_purged';
  assert.equal(w.state.tables.tbl_purged, undefined);
  const { server, port } = await startServer(w, { port: 0 });
  try {
    const answer = await bulk(port, token, { op: 'rollup', ids: [row.id], field: 'Owner' });
    assert.notEqual(answer.status, 403, JSON.stringify(answer.json));
    assert.ok(answer.status < 500, `${answer.status} ${JSON.stringify(answer.json)}`);
  } finally {
    server.close();
  }
});

test('a bulk rollup through a relation to a system table is refused to an editor token', async () => {
  const { w, task, row, token } = seeded();
  w.getField(task.id, 'Owner').config.targetDb = w.getTable('System/Tables').id;
  const { server, port } = await startServer(w, { port: 0 });
  try {
    const answer = await bulk(port, token, { op: 'rollup', ids: [row.id], field: 'Owner' });
    assert.equal(answer.status, 403);
  } finally {
    server.close();
  }
});
