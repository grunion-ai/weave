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
   Tables row.

   Issue #249 (Kyle, 2026-09-08) inverts the default: a table has no Σ row
   until someone asks for one. That forced the flag to be honest in both
   directions — `hideRollups: false` is now STORED, and means "this table opts
   in", so a table Kyle switched on is no longer indistinguishable from one he
   never touched. Absent reads as hidden, which is what every table that
   predates this change already was under the old default. */
test('a table hides the Σ row until it opts in, and the opt-in is stored', () => {
  const w = fresh();
  assert.equal(w.getTable('Task').hideRollups, undefined, 'nothing stored on a new table');
  w.updateTable('Task', { hideRollups: false });
  assert.equal(w.getTable('Task').hideRollups, false, 'shown is stored, not the absence (Issue #249)');
  w.updateTable('Task', { hideRollups: true });
  assert.equal(w.getTable('Task').hideRollups, true);
  assert.throws(() => w.updateTable('Task', { hideRollups: 'yes' }), WeaveError);
});

test('the table row mirrors Hide Rollups as a checkbox and writes it back through the verb', () => {
  const w = fresh();
  const row = () => tableRowOf(w, 'Task');
  assert.equal(tval(w, row(), 'Hide Rollups'), true, 'a table nobody opted in reads as hidden (Issue #249)');
  w.updateTable('Task', { hideRollups: false });
  assert.equal(tval(w, row(), 'Hide Rollups'), false);
  w.updateEntity(row().id, { 'Hide Rollups': true });
  assert.equal(w.getTable('Task').hideRollups, true);
  w.updateEntity(row().id, { 'Hide Rollups': false });
  assert.equal(w.getTable('Task').hideRollups, false, 'unchecking opts the table in, and says so');
});

test('describeSchema, export/import and duplicate carry hideRollups in both directions', () => {
  const w = fresh();
  const find = (ww, name) => ww.describeSchema().flatMap((s) => s.tables).find((t) => t.name === name);
  assert.ok(!('hideRollups' in find(w, 'Task')), 'untouched stays absent');
  w.updateTable('Task', { hideRollups: false });
  assert.equal(find(w, 'Task').hideRollups, false, 'the opt-in travels (Issue #249)');
  const w2 = new Weave();
  w2.importJSON(w.exportJSON());
  assert.equal(w2.getTable('Task').hideRollups, false, 'survives the interchange layer');
  const copy = w.duplicateTable('Task');
  assert.equal(w.getTable(copy.id).hideRollups, false, 'a duplicate reads the same way');
  w.updateTable('Task', { hideRollups: true });
  assert.equal(find(w, 'Task').hideRollups, true);
});

/* No migration, by construction (Issue #249): every table stored before this
   change is either `hideRollups: true` (hidden then, hidden now) or absent
   (shown then — and now hidden, which IS the ask). Nothing stored has to be
   rewritten for the new default to read correctly. */
test('a workspace written under the old default reads without a rewrite', () => {
  // Old "off" — the only thing the old shape ever stored — still reads off,
  // and the Tables row still says so, with nothing rewritten.
  const w = fresh();
  w.updateTable('Task', { hideRollups: true });
  const w2 = new Weave();
  w2.importJSON(JSON.parse(JSON.stringify(w.exportJSON())));
  assert.equal(w2.getTable('Task').hideRollups, true, 'the stored value is untouched');
  assert.equal(tval(w2, tableRowOf(w2, 'Task'), 'Hide Rollups'), true);
  // Old "on" was the absence, and the absence is now off — Kyle's ask.
  const w3 = fresh();
  const w4 = new Weave();
  w4.importJSON(JSON.parse(JSON.stringify(w3.exportJSON())));
  assert.equal(w4.getTable('Task').hideRollups, undefined, 'nothing to rewrite');
  assert.equal(tval(w4, tableRowOf(w4, 'Task'), 'Hide Rollups'), true, 'and it reads hidden');
});
