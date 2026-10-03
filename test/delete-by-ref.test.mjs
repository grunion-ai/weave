/* Deleting a row by its Table#N reference (Issue #597).

   Every entity verb takes an id or a "Table#publicId" reference, and the MCP
   tool descriptions say so, so agents pass references. deleteEntity resolved
   the row from the reference and then kept using the reference: a soft
   delete trashed the row and answered "not found", and a hard delete purged
   nothing and answered purged:true. A delete answers success exactly when it
   deleted, and names the row's real id. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { dispatchTool } from '../src/mcp.js';

function workspace() {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  w.createTable({ space: 'S', name: 'T' });
  const a = w.createEntity('T', { name: 'a' });
  const b = w.createEntity('T', { name: 'b' });
  return { w, a, b };
}

test('engine: a soft delete by Table#N trashes the row and answers it by its id', () => {
  const { w, a } = workspace();
  const out = w.deleteEntity('T#1');
  assert.equal(out.id, a.id);
  assert.ok(out.deletedAt);
  assert.equal(w.query('T', {}).total, 1);
  // Again, on a row already in the trash: same answer, no throw.
  assert.equal(w.deleteEntity('T#1').id, a.id);
  // The trashed row answers its ref the way it answers its id.
  assert.equal(w.readEntity('T#1').id, a.id);
  assert.equal(w.restoreEntity('T#1').id, a.id);
  assert.equal(w.query('T', {}).total, 2);
});

test('engine: a hard delete by Table#N purges the row and names its real id', () => {
  const { w, b } = workspace();
  assert.deepEqual(w.deleteEntity('T#2', { hard: true }), { id: b.id, purged: true });
  assert.equal(w.query('T', { includeDeleted: true }).total, 1);
  assert.throws(() => w.readEntity(b.id), /not found/);
});

test('engine: undo brings back a row soft-deleted by Table#N', () => {
  const { w, a } = workspace();
  w.deleteEntity('T#1');
  w.undo();
  assert.equal(w.readEntity(a.id).deletedAt, null);
  assert.equal(w.query('T', {}).total, 2);
});

test('MCP: weave_delete_entity by Table#N answers the delete that landed', () => {
  const { w, a, b } = workspace();
  const soft = dispatchTool(w, 'weave_delete_entity', { entity: 'T#1' });
  assert.equal(soft.id, a.id);
  assert.equal(dispatchTool(w, 'weave_query', { db: 'T' }).total, 1);
  const hard = dispatchTool(w, 'weave_delete_entity', { entity: 'T#2', hard: true });
  assert.equal(hard.id, b.id);
  assert.equal(hard.purged, true);
  assert.equal(dispatchTool(w, 'weave_query', { db: 'T', includeDeleted: true }).total, 1);
});

test('REST: DELETE /api/entities/T#N soft and hard', async () => {
  const { w, a, b } = workspace();
  const { server } = await startServer(w, { port: 0 });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const soft = await fetch(`${base}/api/entities/${encodeURIComponent('T#1')}`, { method: 'DELETE' });
    assert.equal(soft.status, 200);
    assert.equal((await soft.json()).id, a.id);
    const hard = await fetch(`${base}/api/entities/${encodeURIComponent('T#2')}?hard=1`, { method: 'DELETE' });
    assert.equal(hard.status, 200);
    const purged = await hard.json();
    assert.equal(purged.id, b.id);
    assert.equal(purged.purged, true);
    assert.equal(w.query('T', { includeDeleted: true }).total, 1);
  } finally {
    server.close();
  }
});
