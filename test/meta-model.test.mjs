import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave, WeaveError } from '../src/engine.js';
import { fresh } from './lib/fixtures.mjs';

test('every workspace carries the Workspace system space with Spaces and Tables', () => {
  const w = new Weave();
  const ws = w.getSpace('Workspace');
  assert.equal(ws.system, 'workspace');
  assert.equal(w.getTable('Spaces').system, 'spaces');
  assert.equal(w.getTable('Tables').system, 'tables');
  const names = w.listEntities(w.getTable('Spaces').id).map((e) => w.entityName(e));
  assert.deepEqual(names, ['Workspace']);
  const tNames = w.listEntities(w.getTable('Tables').id).map((e) => w.entityName(e)).sort();
  assert.deepEqual(tNames, ['Fields', 'Forms', 'Spaces', 'Tables', 'Views', 'Workflows', 'Workspaces']);
});

test('creating structure creates its row; the row follows renames and deletes', () => {
  const w = fresh();
  const spacesRows = () => w.listEntities(w.getTable('Spaces').id);
  const tablesRows = () => w.listEntities(w.getTable('Tables').id);
  const userSpaces = () => spacesRows().filter((e) => !w.state.spaces[e.sysId]?.system);
  const userTables = () => tablesRows().filter((e) => !w.state.tables[e.sysId]?.system);
  assert.deepEqual(userSpaces().map((e) => w.entityName(e)), ['Dev']);
  assert.deepEqual(userTables().map((e) => w.entityName(e)), ['Task']);

  const spaceField = Object.values(w.getTable('Tables').fields).find((f) => f.name === 'Space');
  assert.equal(spaceField.type, 'relation');
  const rowNamed = (rows, name) => rows.find((e) => w.entityName(e) === name);
  assert.equal(rowNamed(tablesRows(), 'Task').values[spaceField.id], rowNamed(spacesRows(), 'Dev').id);

  w.updateSpace('Dev', { name: 'Engineering' });
  assert.deepEqual(userSpaces().map((e) => w.entityName(e)), ['Engineering']);
  w.updateTable('Engineering/Task', { name: 'Job', description: 'work items' });
  assert.equal(w.entityName(userTables()[0]), 'Job');

  w.deleteTable('Engineering/Job');
  assert.equal(userTables().length, 0);
  w.deleteSpace('Engineering');
  assert.equal(rowNamed(spacesRows(), 'Engineering'), undefined);
});

test('a legacy workspace is backfilled with registry rows on load', () => {
  const w = fresh();
  const json = w.exportJSON();
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
  const names = w2.listEntities(w2.getTable('Spaces').id).map((e) => w2.entityName(e)).sort();
  assert.deepEqual(names, ['Dev', 'Workspace']);
  const t2 = w2.listEntities(w2.getTable('Tables').id).filter((e) => !w2.state.tables[e.sysId]?.system);
  assert.deepEqual(t2.map((e) => w2.entityName(e)), ['Task']);
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

  assert.throws(() => w.createEntity('Tables', { name: 'Orphan' }), /Space/);
});

test('renaming a registry row renames the real structure', () => {
  const w = fresh();
  const spacesT = w.getTable('Spaces');
  const row = w.listEntities(spacesT.id).find((e) => w.entityName(e) === 'Dev');
  w.updateEntity(row.id, { Name: 'Platform' });
  assert.ok(w.getSpace('Platform'));
  assert.ok(w.getTable('Platform/Task'), 'qualified refs follow the rename');

  const tRow = w.listEntities(w.getTable('Tables').id).find((e) => w.entityName(e) === 'Task');
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
  const spaceField = Object.values(w.getTable('Tables').fields).find((f) => f.name === 'Space');
  assert.throws(() => w.deleteField('Tables', spaceField.id), /system/i);
});

test('deleting a registry row is soft; hard is still the real, unrecoverable delete', () => {
  const w = fresh();
  const row = w.listEntities(w.getTable('Spaces').id).find((e) => w.entityName(e) === 'Dev');
  w.deleteEntity(row.id);
  assert.equal(w.findSpace('Dev'), undefined, 'a trashed space is hidden');
  w.restoreEntity(row.id);
  assert.ok(w.getSpace('Dev'), 'and restore brings it back whole');
  w.deleteEntity(row.id, { hard: true });
  assert.equal(w.findSpace('Dev'), undefined);
  assert.equal(w.findTable('Dev/Task'), undefined, 'the space took its tables with it');
  assert.equal(w.listEntities(w.getTable('Tables').id).filter((e) => !w.state.tables[e.sysId]?.system).length, 0);
  const sysRow = w.listEntities(w.getTable('Spaces').id).find((e) => w.entityName(e) === 'Workspace');
  assert.throws(() => w.deleteEntity(sysRow.id, { hard: true }), /system/i);
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

const tval = (w, row, name) => {
  const t = w.getTable('Tables');
  const f = Object.values(t.fields).find((x) => x.name === name);
  return w.getEntity(row.id).values[f.id];
};
const tableRowOf = (w, dbName) =>
  w.listEntities(w.getTable('Tables').id).find((e) => w.entityName(e) === dbName);

test('a table row carries its configuration as fields: Field Order and Hidden Fields', () => {
  const w = fresh();
  w.addField('Task', { name: 'Points', type: 'number' });
  w.addField('Task', { name: 'Due', type: 'date' });
  const row = tableRowOf(w, 'Task');
  assert.equal(tval(w, row, 'Field Order'), 'Name, Description, Points, Due, Chip, Card',
    'the row states the column order — the views close it');
  assert.equal(tval(w, row, 'Hidden Fields') ?? '', 'Chip, Card', 'only the views are hidden to start');

  w.updateTable('Task', { hiddenFields: ['Points', 'Created At'] });
  assert.equal(tval(w, tableRowOf(w, 'Task'), 'Hidden Fields'), 'Points');

  w.updateTable('Task', { fieldOrder: ['Due', 'Name', 'Points', 'Description'] });
  assert.equal(tval(w, tableRowOf(w, 'Task'), 'Field Order'), 'Due, Name, Points, Description, Chip, Card');
});

test('schema verbs that change the columns refresh the row', () => {
  const w = fresh();
  w.createTable({ space: 'Dev', name: 'Project' });
  w.addField('Task', { name: 'Points', type: 'number' });
  assert.equal(tval(w, tableRowOf(w, 'Task'), 'Field Order'), 'Name, Description, Points, Chip, Card');
  w.addRelation('Task', { name: 'Project', targetDb: 'Project', cardinality: 'many-to-one' });
  assert.equal(tval(w, tableRowOf(w, 'Task'), 'Field Order'), 'Name, Description, Points, Project, Chip, Card');
  assert.equal(tval(w, tableRowOf(w, 'Project'), 'Field Order'), 'Name, Description, Tasks, Chip, Card',
    'the inverse end lands on the far table row too');
  w.deleteField('Task', 'Points');
  assert.equal(tval(w, tableRowOf(w, 'Task'), 'Field Order'), 'Name, Description, Project, Chip, Card');
});

test('editing the row edits the table: Field Order and Hidden Fields write back', () => {
  const w = fresh();
  w.addField('Task', { name: 'Points', type: 'number' });
  const row = tableRowOf(w, 'Task');

  w.updateEntity(row.id, { 'Field Order': 'Points, Name, Description' });
  const db = w.getTable('Task');
  assert.deepEqual(db.fieldOrder.map((id) => db.fields[id].name), ['Points', 'Name', 'Description', 'Chip', 'Card'], 'the views may be left out; they close the order');

  w.updateEntity(row.id, { 'Hidden Fields': 'Points' });
  assert.deepEqual(w.tableView('Task/Standard').fields, ['Name', 'Description', 'Chip', 'Card'], 'the default view hides it; the list is the whole hidden set, so the chip and card it leaves out show');
  w.updateEntity(row.id, { 'Hidden Fields': '' });
  assert.deepEqual(w.tableView('Task/Standard').fields, ['Name', 'Description', 'Points', 'Chip', 'Card'], 'empty clears: every column shows, each where it stood');

  assert.throws(() => w.updateEntity(row.id, { 'Field Order': 'Name' }), /every field exactly once/);
  assert.throws(() => w.updateEntity(row.id, { 'Hidden Fields': 'Nope' }), /not a field/);
});

test('the description at the top of the table is the row Description, both ways', () => {
  const w = fresh();
  const row = tableRowOf(w, 'Task');
  w.updateEntity(row.id, { Description: 'All the work' });
  assert.equal(w.getTable('Task').description, 'All the work');
  w.updateTable('Task', { description: 'The work, refined' });
  const descF = Object.values(w.getTable('Tables').fields).find((f) => f.name === 'Description');
  assert.equal(w.getEntity(row.id).values[descF.id], 'The work, refined');
});

test('registry rows expose sysId so a row can open its structure', () => {
  const w = fresh();
  const spaceRow = w.listEntities(w.getTable('Spaces').id).find((e) => w.entityName(e) === 'Dev');
  assert.equal(w.readEntity(spaceRow.id).sysId, w.getSpace('Dev').id);
  const tableRow = tableRowOf(w, 'Task');
  assert.equal(w.readEntity(tableRow.id).sysId, w.getTable('Task').id);
  const viaQuery = w.query('Tables', {}).items.find((i) => i.name === 'Task');
  assert.equal(viaQuery.sysId, w.getTable('Task').id, 'query carries it too');
  const plain = w.createEntity(w.getTable('Task').id, { Name: 'row' });
  assert.equal(w.readEntity(plain.id).sysId, undefined, 'ordinary rows carry none');
});
