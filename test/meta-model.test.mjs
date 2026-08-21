import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave, WeaveError } from '../src/engine.js';

/* Feature #12 — the hierarchical meta-model. Space- and workspace-level
   structure uses the SAME field-based table mechanics as ordinary tables:
   a Workspace system space holds `Spaces` (rows = the spaces) and `Tables`
   (rows = the tables, related to their space's row). The rows are REAL
   entities synced by the engine's own verbs in both directions, so agents
   get CRUD, relations, automations and custom fields on structure for free —
   and there is no second source of truth to drift, because every mutation
   funnels through the same verb no matter which side it started on. */

function fresh() {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  return w;
}

test('every workspace carries the Workspace system space with Spaces and Tables', () => {
  const w = new Weave();
  const ws = w.getSpace('Workspace');
  assert.equal(ws.system, 'workspace');
  assert.equal(w.getTable('Spaces').system, 'spaces');
  assert.equal(w.getTable('Tables').system, 'tables');
  // The registry describes user structure; the registry itself is not a row.
  assert.equal(w.listEntities(w.getTable('Spaces').id).length, 0);
});

test('creating structure creates its row; the row follows renames and deletes', () => {
  const w = fresh();
  const spacesRows = () => w.listEntities(w.getTable('Spaces').id);
  const tablesRows = () => w.listEntities(w.getTable('Tables').id);
  assert.deepEqual(spacesRows().map((e) => w.entityName(e)), ['Dev']);
  assert.deepEqual(tablesRows().map((e) => w.entityName(e)), ['Task']);

  // The Tables row is RELATED to its space's row — the hierarchy is a relation.
  const spaceField = Object.values(w.getTable('Tables').fields).find((f) => f.name === 'Space');
  assert.equal(spaceField.type, 'relation');
  assert.equal(tablesRows()[0].values[spaceField.id], spacesRows()[0].id);

  w.updateSpace('Dev', { name: 'Engineering' });
  assert.deepEqual(spacesRows().map((e) => w.entityName(e)), ['Engineering']);
  w.updateTable('Engineering/Task', { name: 'Job', description: 'work items' });
  assert.equal(w.entityName(tablesRows()[0]), 'Job');

  w.deleteTable('Engineering/Job');
  assert.equal(tablesRows().length, 0);
  w.deleteSpace('Engineering');
  assert.equal(spacesRows().length, 0);
});

test('a legacy workspace is backfilled with registry rows on load', () => {
  const w = fresh();
  const json = w.exportJSON();
  // Simulate a pre-meta-model export: strip the system space and its rows.
  const ws = json.spaces[Object.keys(json.spaces).find((id) => json.spaces[id].system === 'workspace')];
  const sysTables = Object.values(json.tables).filter((t) => t.system);
  for (const t of sysTables) { delete json.tables[t.id]; }
  for (const [id, e] of Object.entries(json.entities)) {
    if (sysTables.some((t) => t.id === e.dbId)) delete json.entities[id];
  }
  delete json.spaces[ws.id];

  const w2 = new Weave();
  w2.importJSON(json);
  assert.equal(w2.getTable('Spaces').system, 'spaces');
  const names = w2.listEntities(w2.getTable('Spaces').id).map((e) => w2.entityName(e));
  assert.deepEqual(names, ['Dev']);
  assert.deepEqual(w2.listEntities(w2.getTable('Tables').id).map((e) => w2.entityName(e)), ['Task']);
});

test('creating a Spaces row creates the real space; a Tables row creates the real table', () => {
  const w = fresh();
  const row = w.createEntity('Spaces', { name: 'Ops' });
  assert.ok(w.getSpace('Ops'), 'the row IS the space');
  assert.equal(w.listEntities(w.getTable('Spaces').id).filter((e) => w.entityName(e) === 'Ops').length, 1,
    'one row, not one per side of the sync');

  const t = w.createEntity('Tables', { name: 'Jobs', values: { Space: row.id } });
  assert.ok(w.getTable('Ops/Jobs'), 'the row IS the table');
  assert.equal(w.entityName(t), 'Jobs');

  // A Tables row needs its space.
  assert.throws(() => w.createEntity('Tables', { name: 'Orphan' }), /Space/);
});

test('renaming a registry row renames the real structure', () => {
  const w = fresh();
  const spacesT = w.getTable('Spaces');
  const row = w.listEntities(spacesT.id)[0];
  w.updateEntity(row.id, { Name: 'Platform' });
  assert.ok(w.getSpace('Platform'));
  assert.ok(w.getTable('Platform/Task'), 'qualified refs follow the rename');

  const tRow = w.listEntities(w.getTable('Tables').id)[0];
  w.updateEntity(tRow.id, { Name: 'Ticket' });
  assert.ok(w.getTable('Platform/Ticket'));
});

test('custom fields live on registry rows like any other entity values', () => {
  const w = fresh();
  w.addField('Spaces', { name: 'Owner', type: 'text' });
  const row = w.listEntities(w.getTable('Spaces').id)[0];
  w.updateEntity(row.id, { Owner: 'kyle' });
  const ownerField = Object.values(w.getTable('Spaces').fields).find((f) => f.name === 'Owner');
  assert.equal(w.getEntity(row.id).values[ownerField.id], 'kyle');
  assert.ok(w.getSpace('Dev'), 'a value write does not disturb the real space');
});

test('the registry is protected structure', () => {
  const w = fresh();
  assert.throws(() => w.deleteTable('Spaces'), /system/i);
  assert.throws(() => w.deleteTable('Tables'), /system/i);
  assert.throws(() => w.deleteSpace('Workspace'), /system/i);
  // Name and Space are the sync itself; they cannot be removed.
  const spaceField = Object.values(w.getTable('Tables').fields).find((f) => f.name === 'Space');
  assert.throws(() => w.deleteField('Tables', spaceField.id), /system/i);
});

test('deleting a registry row is the real, unrecoverable delete — so it must be said', () => {
  const w = fresh();
  const row = w.listEntities(w.getTable('Spaces').id)[0];
  assert.throws(() => w.deleteEntity(row.id), /hard/i);
  assert.ok(w.getSpace('Dev'), 'the refused soft delete changed nothing');
  w.deleteEntity(row.id, { hard: true });
  assert.equal(w.findSpace('Dev'), undefined);
  assert.equal(w.findTable('Dev/Task'), undefined, 'the space took its tables with it');
  assert.equal(w.listEntities(w.getTable('Tables').id).length, 0);
});

test('moving a table between spaces is refused with a clear reason', () => {
  const w = fresh();
  w.createEntity('Spaces', { name: 'Ops' });
  const tRow = w.listEntities(w.getTable('Tables').id).find((e) => w.entityName(e) === 'Task');
  const opsRow = w.listEntities(w.getTable('Spaces').id).find((e) => w.entityName(e) === 'Ops');
  assert.throws(() => w.updateEntity(tRow.id, { Space: opsRow.id }), /move/i);
});

test('describeSchema flags the system space and tables so surfaces can badge them', () => {
  const w = new Weave();
  const schema = w.describeSchema();
  const ws = schema.find((s) => s.space === 'Workspace');
  assert.equal(ws.system, 'workspace');
  assert.equal(ws.tables.find((t) => t.name === 'Spaces').system, 'spaces');
});
