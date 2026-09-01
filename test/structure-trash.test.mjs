/* Structure trash (lifecycle regression gate, Phase 0a).

   Deleting a table or a space is now recoverable by default, the same
   contract entities have had since Feature #38: the structure keeps its id
   and its rows, and simply stops being visible. Restoring gives back exactly
   what was trashed — rows, relations, registry row. Purging stays the
   explicit, irreversible opt-in (`hard`), and it is still what the registry
   calls "the real delete".

   This re-rules the 2026-08 decision that structural deletes are always
   final: the lifecycle regression pack requires create → delete → restore at
   every level, so the tombstone moved up the ladder. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

function buildWorkspace() {
  const w = new Weave();
  w.createSpace({ name: 'Product' });
  const projects = w.createTable({ space: 'Product', name: 'Project' });
  const tasks = w.createTable({ space: 'Product', name: 'Task' });
  w.addRelation(tasks, { name: 'Project', targetDb: projects, cardinality: 'many-to-one', inverseName: 'Tasks' });
  const apollo = w.createEntity(projects, { name: 'Apollo' });
  const a = w.createEntity(tasks, { name: 'Alpha', values: { Project: apollo.id } });
  return { w, projects, tasks, apollo, a };
}

test('a trashed table disappears from listTables, schema and search but keeps its rows', () => {
  const { w, tasks, a } = buildWorkspace();
  w.deleteTable(tasks.id);

  assert.ok(!w.listTables().some((d) => d.id === tasks.id), 'listTables must hide the trash');
  const product = w.describeSchema().find((s) => s.space === 'Product');
  assert.deepEqual(product.tables.map((t) => t.name), ['Project']);
  assert.equal(w.search('Alpha').length, 0, 'rows of a trashed table are unsearchable');
  assert.ok(!w.universalSearch('Task').some((r) => r.kind === 'table'), 'and so is the table itself');

  // Direct access still works — restore and the trash view both need it.
  assert.ok(w.getTable(tasks.id).deletedAt);
  assert.equal(w.readEntity(a.id).name, 'Alpha', 'the rows were kept, not purged');
  assert.equal(w.findTable('Product/Task'), undefined, 'name lookups skip the trash');
});

test('trashing a table is idempotent and audited, and its registry row lands in the trash', () => {
  const { w, tasks } = buildWorkspace();
  w.deleteTable(tasks.id);
  const at = w.getTable(tasks.id).deletedAt;
  w.deleteTable(tasks.id);
  assert.equal(w.getTable(tasks.id).deletedAt, at, 'a second delete must not move the timestamp');
  assert.ok(w.listAudit().some((x) => x.action === 'table-trashed'));

  const registry = w.getTable('Tables');
  assert.ok(w.listTrash(registry.id).some((r) => r.name === 'Task'),
    'the Tables registry trash shows the trashed table');
});

test('restoreTable brings the table, its rows and its relations back intact', () => {
  const { w, tasks, apollo, a } = buildWorkspace();
  w.deleteTable(tasks.id);
  assert.deepEqual(w.readEntity(apollo.id).fields.Tasks, [], 'relations must not read through the trash');

  w.restoreTable(tasks.id);
  assert.equal(w.getTable('Product/Task').deletedAt, null);
  assert.equal(w.query(tasks.id, {}).total, 1);
  assert.equal(w.readEntity(a.id).fields.Project.name, 'Apollo', 'relations survive the round trip');
  assert.deepEqual(w.readEntity(apollo.id).fields.Tasks.map((t) => t.name), ['Alpha']);
  assert.ok(w.listAudit().some((x) => x.action === 'table-restored'));
  // Restoring a live table is a no-op, not an error.
  w.restoreTable(tasks.id);
});

test('a trashed table holds its name until it is restored or purged', () => {
  const { w, tasks } = buildWorkspace();
  w.deleteTable(tasks.id);
  assert.throws(() => w.createTable({ space: 'Product', name: 'Task' }), /trash/i);
  w.deleteTable(tasks.id, { hard: true });
  assert.ok(w.createTable({ space: 'Product', name: 'Task' }), 'a purge frees the name');
});

test('a trashed space hides itself and its tables; restore brings the whole subtree back', () => {
  const { w, tasks, apollo } = buildWorkspace();
  w.deleteSpace('Product');

  assert.ok(!w.listSpaces().some((s) => s.name === 'Product'));
  assert.ok(!w.listTables().some((d) => d.id === tasks.id), 'tables of a trashed space are hidden');
  assert.equal(w.describeSchema().find((s) => s.space === 'Product'), undefined);
  assert.equal(w.search('Alpha').length, 0);
  assert.equal(w.findSpace('Product'), undefined, 'name lookups skip the trash');

  w.restoreSpace(w.getTable(tasks.id).spaceId);
  assert.ok(w.findSpace('Product'));
  assert.deepEqual(w.describeSchema().find((s) => s.space === 'Product').tables.map((t) => t.name).sort(), ['Project', 'Task']);
  assert.equal(w.readEntity(apollo.id).fields.Tasks.length, 1, 'relations came back with the space');
});

test('a table cannot be restored while its space is in the trash', () => {
  const { w, tasks } = buildWorkspace();
  w.deleteTable(tasks.id);
  w.deleteSpace('Product');
  assert.throws(() => w.restoreTable(tasks.id), /space/i);
  w.restoreSpace(w.getTable(tasks.id).spaceId);
  w.restoreTable(tasks.id);
  assert.equal(w.getTable('Product/Task').deletedAt, null);
});

test('hard delete still purges — rows, registry rows, trash and all', () => {
  const { w, tasks, a } = buildWorkspace();
  w.deleteTable(tasks.id); // from the trash…
  w.deleteTable(tasks.id, { hard: true }); // …to gone
  assert.throws(() => w.getEntity(a.id), /not found/);
  assert.throws(() => w.getTable(tasks.id), /not found/);
  assert.deepEqual(w.listTrash(), [], 'a purge leaves nothing behind');

  w.deleteSpace('Product', { hard: true });
  assert.equal(w.findSpace('Product'), undefined);
  // The four system tables keep their registry rows (Issue #126) — only the
  // user structure is gone.
  const left = w.listEntities(w.getTable('Tables').id, { includeDeleted: true });
  assert.equal(left.filter((e) => !w.state.tables[e.sysId]?.system).length, 0);
});

test('registry rows speak the same contract: soft by default, hard purges, restore restores', () => {
  const { w, tasks } = buildWorkspace();
  const row = w.listEntities(w.getTable('Tables').id).find((e) => w.entityName(e) === 'Task');

  w.deleteEntity(row.id); // soft — routes to the structural trash
  assert.ok(w.getTable(tasks.id).deletedAt, 'trashing the row trashes the table');

  w.restoreEntity(row.id);
  assert.equal(w.getTable(tasks.id).deletedAt, null, 'restoring the row restores the table');

  w.deleteEntity(row.id, { hard: true });
  assert.throws(() => w.getTable(tasks.id), /not found/, 'hard on the row is still the real delete');
});

test('structure trash survives an export/import round trip', () => {
  const { w, tasks } = buildWorkspace();
  w.deleteTable(tasks.id);
  const reopened = new Weave();
  reopened.importJSON(w.exportJSON());
  assert.ok(!reopened.listTables().some((d) => d.name === 'Task'));
  reopened.restoreTable(tasks.id);
  assert.equal(reopened.query('Product/Task', {}).total, 1);
});

/* ---------- REST surface ---------- */

test('REST: table and space delete are soft, restore un-deletes, ?hard=1 purges', async () => {
  const { w, tasks } = buildWorkspace();
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, path) => {
    const res = await fetch(base + path, { method });
    return { status: res.status, data: await res.json() };
  };
  try {
    assert.equal((await api('DELETE', `/api/tables/${tasks.id}`)).status, 200);
    assert.ok(!(await api('GET', '/api/tables')).data.some((t) => t.name === 'Task'));

    assert.equal((await api('POST', `/api/tables/${tasks.id}/restore`)).status, 200);
    assert.ok((await api('GET', '/api/tables')).data.some((t) => t.name === 'Task'));

    const spaceId = w.getTable(tasks.id).spaceId;
    assert.equal((await api('DELETE', `/api/spaces/${spaceId}`)).status, 200);
    assert.ok(!(await api('GET', '/api/spaces')).data.some((s) => s.name === 'Product'));
    assert.equal((await api('POST', `/api/spaces/${spaceId}/restore`)).status, 200);
    assert.ok((await api('GET', '/api/spaces')).data.some((s) => s.name === 'Product'));

    assert.equal((await api('DELETE', `/api/tables/${tasks.id}?hard=1`)).status, 200);
    assert.equal((await api('GET', `/api/tables/${tasks.id}`)).status, 404);
  } finally {
    server.close();
  }
});
