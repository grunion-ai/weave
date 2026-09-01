import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

/* Feature #52 — Fields as entities. The Workspace system space gains a third
   registry table, `Fields`: one row per field of every user table, related to
   its table's row and carrying the definition as a `field`-type value (#85).
   The registry IS the schema surface: create a row and the column exists,
   rename the row and the column renames, edit its Definition and the config
   changes — the same one-verb-per-mutation sync the Spaces/Tables registry
   uses (#12). Non-definable types (relation, lookup, rollup, formula) appear
   as rows too — the registry is complete — but their Definition is empty and
   their shape is edited through the schema verbs that understand them. */

function fresh() {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  return w;
}

const rowsOf = (w) => w.listEntities(w.getTable('Fields').id);
const rowNamed = (w, name) => rowsOf(w).find((e) => w.entityName(e) === name);
const valOf = (w, row, fieldName) => {
  const f = Object.values(w.getTable('Fields').fields).find((x) => x.name === fieldName);
  return row.values[f.id];
};

test('every user field is a row: defaults, adds, renames, deletes', () => {
  const w = fresh();
  // Task arrives with Name + Description; both are rows bound to Task's row.
  assert.deepEqual(rowsOf(w).map((e) => w.entityName(e)).sort(), ['Description', 'Name']);
  const tableRow = w.listEntities(w.getTable('Tables').id).find((e) => w.entityName(e) === 'Task');
  assert.equal(valOf(w, rowsOf(w)[0], 'Table'), tableRow.id);

  w.addField('Task', { name: 'Estimate', type: 'number' });
  const est = rowNamed(w, 'Estimate');
  assert.ok(est, 'addField syncs a row');
  assert.deepEqual(valOf(w, est, 'Definition'), { type: 'number', config: {} });
  assert.equal(valOf(w, est, 'Type'), 'number');

  w.updateField('Task', 'Estimate', { name: 'Points' });
  assert.ok(rowNamed(w, 'Points'), 'a schema rename renames the row');

  w.deleteField('Task', 'Points');
  assert.equal(rowNamed(w, 'Points'), undefined, 'a schema delete drops the row');
});

test('the registry excludes the registry: system tables have no field rows', () => {
  const w = fresh();
  // Only Task's two default fields; nothing from Spaces/Tables/Fields.
  assert.equal(rowsOf(w).length, 2);
});

test('creating a Fields row materializes the real column', () => {
  const w = fresh();
  const tableRow = w.listEntities(w.getTable('Tables').id).find((e) => w.entityName(e) === 'Task');
  const row = w.createEntity('Fields', {
    name: 'Priority',
    values: { Table: tableRow.id, Definition: { type: 'select', config: { options: [{ name: 'P0' }, { name: 'P1' }] } } },
  });
  const made = Object.values(w.getTable('Task').fields).find((f) => f.name === 'Priority');
  assert.ok(made, 'the column exists');
  assert.equal(made.type, 'select');
  const t = w.createEntity('Task', { name: 'T', values: { Priority: 'P1' } });
  assert.equal(w.getEntity(t.id).values[made.id], 'p1');
  assert.equal(w.entityName(row), 'Priority');

  // A row without its Table or Definition cannot become a column.
  assert.throws(() => w.createEntity('Fields', { name: 'Orphan', values: { Definition: { type: 'text' } } }), /Table/);
  assert.throws(() => w.createEntity('Fields', { name: 'Blank', values: { Table: tableRow.id } }), /Definition/);
});

test('renaming a Fields row renames the real column', () => {
  const w = fresh();
  w.addField('Task', { name: 'Estimate', type: 'number' });
  w.updateEntity(rowNamed(w, 'Estimate').id, { Name: 'Points' });
  assert.ok(Object.values(w.getTable('Task').fields).find((f) => f.name === 'Points'));
});

test('editing a Definition edits the config; changing its type is refused', () => {
  const w = fresh();
  w.addField('Task', { name: 'State', type: 'select', config: { options: [{ name: 'a' }] } });
  const row = rowNamed(w, 'State');
  w.updateEntity(row.id, { Definition: { type: 'select', config: { options: [{ name: 'a' }, { name: 'b' }] } } });
  const f = Object.values(w.getTable('Task').fields).find((x) => x.name === 'State');
  assert.equal(f.config.options.length, 2);
  assert.throws(() => w.updateEntity(row.id, { Definition: { type: 'text', config: {} } }), /type/i);
});

test('deleting a Fields row deletes the real column — hard only', () => {
  const w = fresh();
  w.addField('Task', { name: 'Estimate', type: 'number' });
  const row = rowNamed(w, 'Estimate');
  assert.throws(() => w.deleteEntity(row.id), /hard/i);
  w.deleteEntity(row.id, { hard: true });
  assert.equal(Object.values(w.getTable('Task').fields).find((f) => f.name === 'Estimate'), undefined);
});

test('a deleted table takes its field rows with it', () => {
  const w = fresh();
  w.addField('Task', { name: 'Estimate', type: 'number' });
  w.deleteTable('Dev/Task', { hard: true });
  assert.equal(rowsOf(w).length, 0);
});

test('relations and computed fields are rows without a Definition', () => {
  const w = fresh();
  w.createTable({ space: 'Dev', name: 'Project' });
  w.addRelation('Task', { name: 'Project', targetDb: 'Project', cardinality: 'many-to-one' });
  const rel = rowNamed(w, 'Project');
  assert.ok(rel, 'the relation is in the registry');
  assert.ok(valOf(w, rel, 'Definition') == null, 'no definition on a relation row');
  assert.equal(valOf(w, rel, 'Type'), 'relation');
  // Its shape belongs to the schema verbs; the registry refuses to guess.
  assert.throws(() => w.updateEntity(rel.id, { Definition: { type: 'text', config: {} } }), /type|relation/i);
});

test('the Name field of a table is marked and its row cannot be deleted', () => {
  const w = fresh();
  const nameRow = rowsOf(w).find((e) => w.entityName(e) === 'Name');
  assert.throws(() => w.deleteEntity(nameRow.id, { hard: true }), /Name/);
});

/* The registry's relations are the point of it: a Fields row belongs to its
   Tables row (`Table` / inverse `Fields`), and a Tables row to its Spaces row
   (`Space` / inverse `Tables`). Both links were written once at row creation
   and never re-asserted, so a link that was wrong — or that could not be
   written yet because the parent row did not exist during bootstrap — stayed
   wrong forever, and the two sides of the registry disagreed about which
   fields a table has. Kyle found it by asking why tables were not registered
   to fields and fields to tables (2026-08-23). */

const drift = (w, table, row, fieldName, value) => {
  const f = Object.values(w.getTable(table).fields).find((x) => x.name === fieldName);
  const live = w.getEntity(row.id);
  const prev = live.values[f.id];
  for (const id of (Array.isArray(prev) ? prev : prev == null ? [] : [prev])) {
    const far = w.getEntity(id);
    const inv = w.getTable(table).fields[f.id].config.inverseFieldId;
    if (far && inv) far.values[inv] = (far.values[inv] ?? []).filter((x) => x !== row.id);
  }
  live.values[f.id] = value;
  for (const id of (Array.isArray(value) ? value : value == null ? [] : [value])) {
    const far = w.getEntity(id);
    const inv = w.getTable(table).fields[f.id].config.inverseFieldId;
    if (far && inv) far.values[inv] = [...(far.values[inv] ?? []), row.id];
  }
  w.save();
};

const relOf = (w, table, row, fieldName) => {
  const f = Object.values(w.getTable(table).fields).find((x) => x.name === fieldName);
  const v = row.values[f.id];
  return Array.isArray(v) ? v : v == null ? [] : [v];
};

test('a field row that points at the wrong table is repaired', () => {
  const w = fresh();
  w.createTable({ space: 'Dev', name: 'Project' });
  const projectRow = w.listEntities(w.getTable('Tables').id).find((e) => w.entityName(e) === 'Project');
  const orderRow = (w.addField('Task', { name: 'Order', type: 'number' }), rowNamed(w, 'Order'));

  // Drift as a legacy workspace carries it: the row surface refuses a move
  // ('A field cannot move between tables'), so write the stored value directly.
  drift(w, 'Fields', orderRow, 'Table', projectRow.id);
  assert.deepEqual(relOf(w, 'Fields', w.getEntity(orderRow.id), 'Table'), [projectRow.id], 'setup: drifted');

  w.rebuildRegistry();

  const taskRow = w.listEntities(w.getTable('Tables').id).find((e) => w.entityName(e) === 'Task');
  assert.deepEqual(relOf(w, 'Fields', w.getEntity(orderRow.id), 'Table'), [taskRow.id],
    'the field row is registered back to the table that actually owns the column');
  const listed = relOf(w, 'Tables', w.getEntity(taskRow.id), 'Fields');
  assert.ok(listed.includes(orderRow.id), 'and the table lists it among its fields');
});

test('a field row with no table at all is repaired', () => {
  const w = fresh();
  w.addField('Task', { name: 'Order', type: 'number' });
  const row = rowNamed(w, 'Order');
  drift(w, 'Fields', row, 'Table', []);
  assert.deepEqual(relOf(w, 'Fields', w.getEntity(row.id), 'Table'), [], 'setup: orphaned');

  w.rebuildRegistry();

  const taskRow = w.listEntities(w.getTable('Tables').id).find((e) => w.entityName(e) === 'Task');
  assert.deepEqual(relOf(w, 'Fields', w.getEntity(row.id), 'Table'), [taskRow.id]);
});

test('a table row with no space is repaired', () => {
  const w = fresh();
  const taskRow = w.listEntities(w.getTable('Tables').id).find((e) => w.entityName(e) === 'Task');
  drift(w, 'Tables', taskRow, 'Space', []);
  assert.deepEqual(relOf(w, 'Tables', w.getEntity(taskRow.id), 'Space'), [], 'setup: orphaned');

  w.rebuildRegistry();

  const spaceRow = w.listEntities(w.getTable('Spaces').id).find((e) => w.entityName(e) === 'Dev');
  assert.deepEqual(relOf(w, 'Tables', w.getEntity(taskRow.id), 'Space'), [spaceRow.id]);
  assert.ok(relOf(w, 'Spaces', w.getEntity(spaceRow.id), 'Tables').includes(taskRow.id),
    'and the space lists the table');
});

/* The invariant both repairs exist to hold: the registry and the schema agree
   about every field of every table, in both directions. */
test('every field of every table is registered to it, and only to it', () => {
  const w = fresh();
  w.createTable({ space: 'Dev', name: 'Project' });
  w.addField('Task', { name: 'Order', type: 'number' });
  w.addField('Project', { name: 'Budget', type: 'number' });
  w.addRelation('Task', { name: 'Project', targetDb: 'Project', cardinality: 'many-to-one' });

  const report = w.registryReport();
  assert.deepEqual(report.problems, [], 'a freshly built workspace has a clean registry');

  for (const db of w.listTables().filter((t) => !t.system)) {
    const tableRow = w.listEntities(w.getTable('Tables').id).find((e) => e.sysId === db.id);
    const listed = relOf(w, 'Tables', w.getEntity(tableRow.id), 'Fields')
      .map((id) => w.entityName(w.getEntity(id))).sort();
    const actual = db.fieldOrder.map((id) => db.fields[id].name).sort();
    assert.deepEqual(listed, actual, `${db.name}: the registry lists exactly its fields`);
  }
});

test('registryReport names a drifted link instead of hiding it', () => {
  const w = fresh();
  const row = rowNamed(w, 'Name');
  drift(w, 'Fields', row, 'Table', []);
  const report = w.registryReport();
  assert.equal(report.problems.length, 1);
  assert.match(report.problems[0].problem, /table/i);
  assert.equal(w.rebuildRegistry().repaired, 1);
  assert.deepEqual(w.registryReport().problems, []);
});
