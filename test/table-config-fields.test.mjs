import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave, WeaveError } from '../src/engine.js';

/* Option F (Kyle, 2026-08-28): the table's view configuration is fields on
   its registry row. Field Order and Hidden Fields already live there; this
   adds Filter (workflow-state sets, formerly per-browser localStorage,
   Feature #38) and Sort (formerly ephemeral client state). Both are table
   truth: validated by updateTable, mirrored to the Tables row as text, and
   editable from either side through the same verb. */

function fresh() {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  w.addField('Task', {
    name: 'State',
    type: 'workflow',
    config: {
      states: [
        { name: 'Open', category: 'not-started', default: true },
        { name: 'Doing', category: 'in-progress' },
        { name: 'Done', category: 'done' },
      ],
    },
  });
  w.addField('Task', { name: 'Due', type: 'date' });
  return w;
}

const tableRowOf = (w, dbName) =>
  w.listEntities(w.getTable('Tables').id).find((e) => w.entityName(e) === dbName);
const tval = (w, row, fieldName) => {
  const t = w.getTable('Tables');
  const f = Object.values(t.fields).find((x) => x.name === fieldName);
  return row.values[f.id];
};

test('updateTable validates and stores filters; empty clears', () => {
  const w = fresh();
  w.updateTable('Task', { filters: { State: ['Open', 'Doing'] } });
  assert.deepEqual(w.getTable('Task').filters, { State: ['Open', 'Doing'] });
  w.updateTable('Task', { filters: {} });
  assert.equal(w.getTable('Task').filters, undefined);
  assert.throws(() => w.updateTable('Task', { filters: { Nope: ['Open'] } }), WeaveError);
  assert.throws(() => w.updateTable('Task', { filters: { Due: ['Open'] } }), WeaveError,
    'a non-workflow field cannot carry a state filter');
  assert.throws(() => w.updateTable('Task', { filters: { State: ['Bogus'] } }), WeaveError,
    'a state the workflow does not have is refused');
  assert.throws(() => w.updateTable('Task', { filters: ['State'] }), WeaveError);
});

test('updateTable validates and stores sort; empty clears', () => {
  const w = fresh();
  w.updateTable('Task', { sort: [{ field: 'Due', dir: 'desc' }, { field: 'Name' }] });
  assert.deepEqual(w.getTable('Task').sort, [{ field: 'Due', dir: 'desc' }, { field: 'Name', dir: 'asc' }]);
  w.updateTable('Task', { sort: [] });
  assert.equal(w.getTable('Task').sort, undefined);
  assert.throws(() => w.updateTable('Task', { sort: [{ field: 'Nope' }] }), WeaveError);
  assert.throws(() => w.updateTable('Task', { sort: [{ field: 'Due', dir: 'sideways' }] }), WeaveError);
});

test('the table row mirrors Filter and Sort as text', () => {
  const w = fresh();
  const row = () => tableRowOf(w, 'Task');
  assert.equal(tval(w, row(), 'Filter') ?? '', '');
  assert.equal(tval(w, row(), 'Sort') ?? '', '');
  w.updateTable('Task', { filters: { State: ['Open', 'Doing'] }, sort: [{ field: 'Due', dir: 'asc' }] });
  assert.equal(tval(w, row(), 'Filter'), 'State: Open, Doing');
  assert.equal(tval(w, row(), 'Sort'), 'Due asc');
  w.updateTable('Task', { filters: {}, sort: [] });
  assert.equal(tval(w, row(), 'Filter') ?? '', '');
  assert.equal(tval(w, row(), 'Sort') ?? '', '');
});

test('editing the row text writes back through the schema verb', () => {
  const w = fresh();
  const row = tableRowOf(w, 'Task');
  w.updateEntity(row.id, { Filter: 'State: Done', Sort: 'Due desc, Name asc' });
  assert.deepEqual(w.getTable('Task').filters, { State: ['Done'] });
  assert.deepEqual(w.getTable('Task').sort, [{ field: 'Due', dir: 'desc' }, { field: 'Name', dir: 'asc' }]);
  w.updateEntity(row.id, { Filter: '', Sort: '' });
  assert.equal(w.getTable('Task').filters, undefined);
  assert.equal(w.getTable('Task').sort, undefined);
  assert.throws(() => w.updateEntity(row.id, { Filter: 'State: Bogus' }), WeaveError,
    'the row edit gets the same validation as the verb, because it is the verb');
  assert.throws(() => w.updateEntity(row.id, { Filter: 'no colon here' }), WeaveError);
  assert.throws(() => w.updateEntity(row.id, { Sort: 'Nope asc' }), WeaveError);
});

test('describeSchema emits filters and sort', () => {
  const w = fresh();
  w.updateTable('Task', { filters: { State: ['Open'] }, sort: [{ field: 'Due', dir: 'asc' }] });
  const task = w.describeSchema().flatMap((s) => s.tables).find((t) => t.name === 'Task');
  assert.deepEqual(task.filters, { State: ['Open'] });
  assert.deepEqual(task.sort, [{ field: 'Due', dir: 'asc' }]);
  const bare = new Weave();
  bare.createSpace({ name: 'S' });
  bare.createTable({ space: 'S', name: 'T' });
  const t2 = bare.describeSchema().flatMap((s) => s.tables).find((t) => t.name === 'T');
  assert.ok(!('filters' in t2) && !('sort' in t2), 'unset config stays absent, like hiddenFields');
});

test('a sort without a direction defaults asc when parsed from the row', () => {
  const w = fresh();
  const row = tableRowOf(w, 'Task');
  w.updateEntity(row.id, { Sort: 'Due' });
  assert.deepEqual(w.getTable('Task').sort, [{ field: 'Due', dir: 'asc' }]);
});

/* Issue #233: the Σ row (space rollups pinned under the field headers) has a
   visibility switch that is table truth like the filter and the sort —
   `hideRollups` on the table, mirrored as the Hide Rollups checkbox on the
   Tables row, absent while the row is shown. */
test('updateTable stores hideRollups; false clears; anything else is refused', () => {
  const w = fresh();
  assert.equal(w.getTable('Task').hideRollups, undefined, 'shown by default, nothing stored');
  w.updateTable('Task', { hideRollups: true });
  assert.equal(w.getTable('Task').hideRollups, true);
  w.updateTable('Task', { hideRollups: false });
  assert.equal(w.getTable('Task').hideRollups, undefined, 'false is the absence, like an empty sort');
  assert.throws(() => w.updateTable('Task', { hideRollups: 'yes' }), WeaveError);
});

test('the table row mirrors Hide Rollups as a checkbox and writes it back through the verb', () => {
  const w = fresh();
  const row = () => tableRowOf(w, 'Task');
  assert.equal(!!tval(w, row(), 'Hide Rollups'), false);
  w.updateTable('Task', { hideRollups: true });
  assert.equal(tval(w, row(), 'Hide Rollups'), true);
  w.updateEntity(row().id, { 'Hide Rollups': false });
  assert.equal(w.getTable('Task').hideRollups, undefined);
  w.updateEntity(row().id, { 'Hide Rollups': true });
  assert.equal(w.getTable('Task').hideRollups, true);
});

test('describeSchema, export/import and duplicate carry hideRollups only when set', () => {
  const w = fresh();
  const find = (ww, name) => ww.describeSchema().flatMap((s) => s.tables).find((t) => t.name === name);
  assert.ok(!('hideRollups' in find(w, 'Task')), 'unset stays absent');
  w.updateTable('Task', { hideRollups: true });
  assert.equal(find(w, 'Task').hideRollups, true);
  const w2 = new Weave();
  w2.importJSON(w.exportJSON());
  assert.equal(w2.getTable('Task').hideRollups, true, 'survives the interchange layer');
  const copy = w.duplicateTable('Task');
  assert.equal(w.getTable(copy.id).hideRollups, true, 'a duplicate reads the same way');
});
