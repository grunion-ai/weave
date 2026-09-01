/* Soft delete (weave Feature #38, first half).

   Deleting an entity is recoverable by default: the row keeps its id, its
   publicId, its relations and its documents, and simply stops being visible.
   Everything that reads "the rows of a table" — list, query, search, relation
   targets, lookups and rollups — must agree on that, or a deleted entity
   leaks back in through whichever surface forgot to ask. Purging is the
   explicit, irreversible opt-in. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { TOOLS, dispatchTool } from '../src/mcp.js';

function buildWorkspace() {
  const w = new Weave();
  w.createSpace({ name: 'Product' });
  const projects = w.createTable({ space: 'Product', name: 'Project' });
  const tasks = w.createTable({ space: 'Product', name: 'Task' });
  w.addField(tasks, { name: 'Estimate', type: 'number' });
  w.addRelation(tasks, { name: 'Project', targetDb: projects, cardinality: 'many-to-one', inverseName: 'Tasks' });
  w.addField(projects, { name: 'Task count', type: 'rollup', config: { relationField: 'Tasks', aggregate: 'count' } });
  w.addField(projects, { name: 'Effort', type: 'rollup', config: { relationField: 'Tasks', targetField: 'Estimate', aggregate: 'sum' } });
  w.addField(projects, { name: 'Task names', type: 'lookup', config: { relationField: 'Tasks', targetField: 'Name' } });
  const apollo = w.createEntity(projects, { name: 'Apollo' });
  const a = w.createEntity(tasks, { name: 'Alpha', values: { Estimate: 3, Project: apollo.id } });
  const b = w.createEntity(tasks, { name: 'Beta', values: { Estimate: 5, Project: apollo.id } });
  return { w, projects, tasks, apollo, a, b };
}

test('a deleted entity disappears from list, query and search but is still readable by id', () => {
  const { w, tasks, a } = buildWorkspace();
  w.deleteEntity(a.id);

  assert.deepEqual(w.listEntities(tasks.id).map((e) => w.entityName(e)), ['Beta']);
  assert.equal(w.query(tasks, {}).total, 1);
  assert.equal(w.search('Alpha').length, 0, 'deleted entities must not surface in search');

  // Direct access still works — the trash view and restore both need it.
  const read = w.readEntity(a.id);
  assert.equal(read.name, 'Alpha');
  assert.ok(read.deletedAt, 'readEntity must expose deletedAt');
  assert.equal(w.readEntity(w.query(tasks, {}).items[0].id).deletedAt, null,
    'a live entity reports deletedAt: null');
});

test('deleting is recorded in activity and is idempotent', () => {
  const { w, a } = buildWorkspace();
  const at = w.deleteEntity(a.id).deletedAt;
  assert.ok(at);
  assert.equal(w.readEntity(a.id).activity.at(-1).kind, 'deleted');
  // A second delete must not move the timestamp or stack another activity row.
  assert.equal(w.deleteEntity(a.id).deletedAt, at);
  assert.equal(w.readEntity(a.id).activity.filter((x) => x.kind === 'deleted').length, 1);
});

test('deleted entities drop out of relations, lookups and rollups', () => {
  const { w, projects, apollo, a } = buildWorkspace();
  let read = w.readEntity(apollo.id);
  assert.equal(read.fields['Task count'], 2);
  assert.equal(read.fields.Effort, 8);
  assert.deepEqual(read.fields['Task names'], ['Alpha', 'Beta']);

  w.deleteEntity(a.id);
  read = w.readEntity(apollo.id);
  assert.equal(read.fields['Task count'], 1, 'a deleted task must not be counted');
  assert.equal(read.fields.Effort, 5);
  assert.deepEqual(read.fields['Task names'], ['Beta']);
  assert.deepEqual(read.fields.Tasks.map((t) => t.name), ['Beta'],
    'the relation collection must not list deleted targets');

  // Filtering by a related value must not match through a deleted row either.
  assert.equal(w.query(projects, { where: [['Tasks.Name', '=', 'Alpha']] }).total, 0);
});

test('restore brings the entity and its relations back intact', () => {
  const { w, tasks, apollo, a } = buildWorkspace();
  w.deleteEntity(a.id);
  const restored = w.restoreEntity(a.id);

  assert.equal(restored.deletedAt, null);
  assert.equal(w.query(tasks, {}).total, 2);
  assert.equal(w.readEntity(apollo.id).fields['Task count'], 2, 'relations survive the round trip');
  assert.equal(w.readEntity(a.id).activity.at(-1).kind, 'restored');
  assert.equal(w.readEntity(a.id).publicId, a.publicId, 'the public id is preserved');
  // Restoring a live entity is a no-op, not an error.
  assert.equal(w.restoreEntity(a.id).activity.filter((x) => x.kind === 'restored').length, 1);
});

test('trash lists deleted entities, per table or workspace-wide', () => {
  const { w, tasks, projects, a, apollo } = buildWorkspace();
  assert.deepEqual(w.listTrash(), []);

  w.deleteEntity(a.id);
  w.deleteEntity(apollo.id);

  assert.deepEqual(w.listTrash(tasks).map((e) => e.name), ['Alpha']);
  assert.deepEqual(w.listTrash(projects).map((e) => e.name), ['Apollo']);
  assert.equal(w.listTrash().length, 2, 'no table ref = the whole workspace');
  assert.ok(w.listTrash()[0].deletedAt, 'trash rows carry their deletion time');
});

test('includeDeleted opts a read back into seeing the trash', () => {
  const { w, tasks, a } = buildWorkspace();
  w.deleteEntity(a.id);
  assert.equal(w.listEntities(tasks.id, { includeDeleted: true }).length, 2);
  assert.equal(w.query(tasks, { includeDeleted: true }).total, 2);
  assert.equal(w.query(tasks, { includeDeleted: true, where: [['Name', '=', 'Alpha']] }).total, 1);
});

test('hard delete purges the row and unlinks it for good', () => {
  const { w, tasks, apollo, a } = buildWorkspace();
  w.deleteEntity(a.id, { hard: true });

  assert.throws(() => w.getEntity(a.id), /not found/);
  assert.deepEqual(w.listTrash(), [], 'a purged row is not in the trash — it is gone');
  assert.equal(w.readEntity(apollo.id).fields['Task count'], 1);
  assert.equal(w.listEntities(tasks.id, { includeDeleted: true }).length, 1);
});

test('a soft-deleted entity can be purged from the trash', () => {
  const { w, a } = buildWorkspace();
  w.deleteEntity(a.id);
  w.deleteEntity(a.id, { hard: true });
  assert.throws(() => w.getEntity(a.id), /not found/);
});

/* Purging the container really drops it: a hard table delete takes every
   row with it, live and trashed alike, so nothing is left pointing at a
   table that no longer exists. (The soft default is structure-trash.test.mjs
   territory.) */
test('hard-deleting a table purges its rows, live and trashed alike', () => {
  const { w, tasks, a } = buildWorkspace();
  w.deleteEntity(a.id); // one already in the trash, one still live
  w.deleteTable(tasks.id, { hard: true });

  assert.deepEqual(w.listTrash(), [], 'no orphans may survive their table');
  assert.throws(() => w.getEntity(a.id), /not found/);
});

test('hard-deleting a space purges every row it contained', () => {
  const { w, a, apollo } = buildWorkspace();
  w.deleteEntity(a.id);
  w.deleteSpace('Product', { hard: true });

  assert.deepEqual(w.listTrash(), []);
  assert.throws(() => w.getEntity(apollo.id), /not found/);
});

test('soft deletion survives a save/reload cycle', () => {
  const { w, tasks, a } = buildWorkspace();
  w.deleteEntity(a.id);
  const reopened = new Weave();
  reopened.importJSON(w.exportJSON());
  const tbl = reopened.getTable('Product/Task');
  assert.equal(reopened.query(tbl, {}).total, 1);
  assert.equal(reopened.listTrash(tbl).length, 1);
  assert.equal(reopened.listTrash(tbl)[0].id, a.id);
});

test('csv export and entity counts reflect only live rows', () => {
  const { w, tasks, a } = buildWorkspace();
  w.deleteEntity(a.id);
  const csv = w.exportCSV(tasks);
  assert.ok(!csv.includes('Alpha'), 'a deleted row must not be exported');
  assert.ok(csv.includes('Beta'));
});

/* ---------- REST surface ---------- */

test('REST: delete is soft, restore un-deletes, ?hard=1 purges', async () => {
  const { w, tasks, a, b } = buildWorkspace();
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, path) => {
    const res = await fetch(base + path, { method });
    return { status: res.status, data: await res.json() };
  };
  try {
    assert.equal((await api('DELETE', `/api/entities/${a.id}`)).status, 200);
    assert.equal((await api('POST', '/api/tables/Task/query')).data.total, 1);

    const trash = await api('GET', '/api/tables/Task/trash');
    assert.equal(trash.status, 200);
    assert.deepEqual(trash.data.items.map((e) => e.name), ['Alpha']);

    assert.equal((await api('POST', `/api/entities/${a.id}/restore`)).status, 200);
    assert.equal((await api('POST', '/api/tables/Task/query')).data.total, 2);

    assert.equal((await api('DELETE', `/api/entities/${b.id}?hard=1`)).status, 200);
    assert.equal((await api('GET', '/api/tables/Task/trash')).data.items.length, 0);
    assert.equal((await api('POST', '/api/tables/Task/query')).data.total, 1);
  } finally {
    server.close();
  }
});

/* ---------- agent surfaces: MCP and CLI must not be second-class ---------- */

test('MCP exposes the same delete / restore / trash contract', () => {
  const { w, a } = buildWorkspace();
  const names = TOOLS.map((t) => t.name);
  assert.ok(names.includes('weave_restore_entity'));
  assert.ok(names.includes('weave_trash'));
  assert.ok(TOOLS.find((t) => t.name === 'weave_delete_entity').inputSchema.properties.hard,
    'delete must advertise the hard/purge opt-in');

  dispatchTool(w, 'weave_delete_entity', { entity: a.id });
  assert.equal(dispatchTool(w, 'weave_query', { db: 'Task' }).total, 1);
  assert.equal(dispatchTool(w, 'weave_trash', {}).items.length, 1);

  dispatchTool(w, 'weave_restore_entity', { entity: a.id });
  assert.equal(dispatchTool(w, 'weave_query', { db: 'Task' }).total, 2);

  dispatchTool(w, 'weave_delete_entity', { entity: a.id, hard: true });
  assert.equal(dispatchTool(w, 'weave_trash', {}).items.length, 0);
  assert.equal(dispatchTool(w, 'weave_query', { db: 'Task' }).total, 1);
});

test('CLI documents delete --hard, restore and trash', () => {
  const help = readFileSync(new URL('../bin/weave.js', import.meta.url), 'utf8');
  for (const cmd of ['restore', 'trash']) {
    assert.ok(help.includes(`case '${cmd}'`), `CLI must implement '${cmd}'`);
  }
  assert.match(help, /delete <ref> \[--hard\]/, 'the help text must document --hard');
});
