/* Table views (Feature #229, Kyle's rulings 2026-09-23 and 2026-09-25): a
   strip of named views over one table. Order is the only signal of the
   default: the leftmost view opens with the table. Blank — the raw table —
   is no longer a tab; it stays readable as 'Task/blank' (and the old
   …/view/blank link), computed and never stored. A table keeps at least one
   view.

   The agent surface is the primary door, so it is tested first and hardest:
   one verb (`tableView` / `weave_table_view` / `weave table view` /
   `/api/tables/:t/views/:v`), names instead of ids, one ordered `fields` list
   that carries visibility and order together, relative edits (show, hide,
   move) so a wide table is never resent, and compact reads. Filters and sort
   are updateTable's shapes through updateTable's validators. The UI is a
   second door onto the same write path; the registry row (Workspace/Views)
   is a third. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave, WeaveError } from '../src/engine.js';
import { TOOLS, dispatchTool } from '../src/mcp.js';
import { startServer } from '../src/server.js';

function fresh() {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  w.addField('Task', {
    name: 'State', type: 'workflow', config: { states: [
      { name: 'Open', category: 'not-started', default: true },
      { name: 'Doing', category: 'in-progress' },
      { name: 'Done', category: 'done' },
    ] },
  });
  w.addField('Task', { name: 'Due', type: 'date' });
  w.addField('Task', { name: 'Points', type: 'number' });
  return w;
}
const names = (list) => list.map((v) => v.name);

/* ---------- reads ---------- */

test('a new table has one view, Standard; the list is the strip, in order, and Blank is not in it', () => {
  const w = fresh();
  const list = w.tableView('Task');
  assert.equal(list.table, 'Dev/Task');
  assert.deepEqual(names(list.views), ['Standard']);
  assert.deepEqual(Object.keys(list.views[0]).sort(), ['fields', 'id', 'name'], 'no default flag: the first view is the default');
  assert.deepEqual(list.views[0].fields, ['Name', 'Description', 'State', 'Due', 'Points'],
    'every field in schema order; the chip and card stay hidden as before');
});

test('reads are compact: names, default flag, fields, filters, sort — never rows or field definitions', () => {
  const w = fresh();
  w.createEntity('Task', { name: 'one' });
  w.tableView('Task/Open work', { fields: ['Name', 'State'], filters: { State: ['Open'] }, sort: [{ field: 'Due', dir: 'desc' }] });
  const one = w.tableView('Task/Open work');
  assert.deepEqual(Object.keys(one).sort(), ['fields', 'filters', 'id', 'name', 'sort']);
  assert.deepEqual(one.fields, ['Name', 'State'], 'names, not definitions');
  const list = JSON.stringify(w.tableView('Task'));
  assert.ok(!list.includes('"type"') && !list.includes('"items"') && !list.includes('one'), `no field types, no rows: ${list}`);
});

test('Blank is still readable by name: the raw table, schema order, no filter, no sort', () => {
  const w = fresh();
  w.tableView('Task/Standard', { hide: ['Due'], filters: { State: ['Done'] }, sort: [{ field: 'Due' }] });
  assert.deepEqual(w.tableView('Task/blank'), {
    name: 'Blank', blank: true, fields: ['Name', 'Description', 'State', 'Due', 'Points'],
  });
  assert.equal(w.getTable('Task').tableViews.some((v) => /blank/i.test(v.name)), false, 'never stored');
});

/* ---------- writes ---------- */

test('one call defines a view: fields carry visibility and order together', () => {
  const w = fresh();
  const v = w.tableView('Task/Triage', { fields: ['State', 'Name', 'Points'] });
  assert.equal(v.created, true);
  assert.deepEqual(v.fields, ['State', 'Name', 'Points'], 'listed = visible, in that order; unlisted = hidden');
  assert.deepEqual(names(w.tableView('Task').views), ['Standard', 'Triage']);
  assert.equal(w.tableView('Task/Triage').created, undefined, 'a read never says created');
});

test('a view starts from the system default unless `from` names another; from copies (Duplicate view)', () => {
  const w = fresh();
  w.tableView('Task/Standard', { hide: ['Points'], filters: { State: ['Open'] } });
  assert.deepEqual(w.tableView('Task/Fresh', { sort: [{ field: 'Name' }] }).fields,
    ['Name', 'Description', 'State', 'Due', 'Points'], 'a new name without from starts from every field, no filter, no sort');
  const copy = w.tableView('Task/Copy', { from: 'Standard' });
  assert.deepEqual(copy.fields, ['Name', 'Description', 'State', 'Due']);
  assert.deepEqual(copy.filters, { State: ['Open'] });
  w.tableView('Task/Copy', { hide: ['Due'] });
  assert.deepEqual(w.tableView('Task/Standard').fields, ['Name', 'Description', 'State', 'Due'], 'the copy is its own view');
  assert.throws(() => w.tableView('Task/Copy', { from: 'Standard' }), /already has a view/);
  assert.throws(() => w.tableView('Task/X', { from: 'Nope' }), /Nope/);
});

test('relative edits: show, hide and move never need the whole list', () => {
  const w = fresh();
  w.tableView('Task/V', { fields: ['Name', 'Points'] });
  assert.deepEqual(w.tableView('Task/V', { show: ['State'] }).fields, ['Name', 'State', 'Points'],
    'show puts a field back at its schema position among the visible ones');
  assert.deepEqual(w.tableView('Task/V', { show: 'Description' }).fields, ['Name', 'Description', 'State', 'Points'], 'one name is a list of one');
  assert.deepEqual(w.tableView('Task/V', { hide: ['Description'] }).fields, ['Name', 'State', 'Points']);
  assert.deepEqual(w.tableView('Task/V', { move: { field: 'Points', before: 'Name' } }).fields, ['Points', 'Name', 'State']);
  assert.deepEqual(w.tableView('Task/V', { move: { field: 'Points', after: 'State' } }).fields, ['Name', 'State', 'Points']);
  assert.deepEqual(w.tableView('Task/V', { move: { field: 'Due', after: 'Name' } }).fields, ['Name', 'Due', 'State', 'Points'],
    'moving a hidden field shows it where it lands');
  assert.deepEqual(w.tableView('Task/V', { move: [{ field: 'Name', after: 'Points' }, { field: 'Due', before: 'Name' }] }).fields,
    ['State', 'Points', 'Due', 'Name'], 'moves apply in order');
});

test('bad field references and shapes are refused, and nothing is half-written', () => {
  const w = fresh();
  w.tableView('Task/V', { fields: ['Name', 'State'] });
  const before = JSON.stringify(w.tableView('Task/V'));
  assert.throws(() => w.tableView('Task/V', { fields: ['Name', 'Nope'] }), /Nope/);
  assert.throws(() => w.tableView('Task/V', { fields: ['Name', 'Name'] }), /once/);
  assert.throws(() => w.tableView('Task/V', { fields: 'Name' }), /list/);
  assert.throws(() => w.tableView('Task/V', { hide: ['Nope'] }), /Nope/);
  assert.throws(() => w.tableView('Task/V', { move: { field: 'Name' } }), /before|after/);
  assert.throws(() => w.tableView('Task/V', { move: { field: 'Name', before: 'Due' } }), /hidden/);
  assert.throws(() => w.tableView('Task/V', { show: ['Due'], colour: 'red' }), /colour/);
  assert.throws(() => w.tableView('Task/V', { show: ['Due'], filters: { State: ['Bogus'] } }), /Bogus/);
  assert.equal(JSON.stringify(w.tableView('Task/V')), before, 'a refused write leaves the view as it was');
  assert.throws(() => w.tableView('Task/Never', { fields: ['Nope'] }), /Nope/);
  assert.deepEqual(names(w.tableView('Task').views), ['Standard', 'V'], 'a refused create creates nothing');
});

test('filters and sort are updateTable\'s shapes through updateTable\'s validators', () => {
  const w = fresh();
  const msg = (fn) => { try { fn(); } catch (e) { return e.message; } return null; };
  for (const bad of [{ filters: { Nope: ['Open'] } }, { filters: { Due: ['Open'] } }, { filters: { State: ['Bogus'] } }, { filters: ['State'] },
    { sort: [{ field: 'Nope' }] }, { sort: [{ field: 'Due', dir: 'sideways' }] }, { sort: 'Due' }]) {
    const viaTable = msg(() => w.updateTable('Task', bad));
    assert.ok(viaTable, `updateTable refuses ${JSON.stringify(bad)}`);
    assert.equal(msg(() => w.tableView('Task/V', bad)), viaTable, `one validator, one message: ${JSON.stringify(bad)}`);
  }
  const v = w.tableView('Task/V', { filters: { State: ['Open', 'Doing'] }, sort: [{ field: 'Due', dir: 'desc' }, { field: 'Name' }] });
  assert.deepEqual(v.filters, { State: ['Open', 'Doing'] });
  assert.deepEqual(v.sort, [{ field: 'Due', dir: 'desc' }, { field: 'Name', dir: 'asc' }]);
  const cleared = w.tableView('Task/V', { filters: {}, sort: [] });
  assert.ok(!('filters' in cleared) && !('sort' in cleared), 'empty clears');
});

test('a partial update changes only the keys it names', () => {
  const w = fresh();
  w.tableView('Task/V', { fields: ['Name', 'State'], filters: { State: ['Open'] }, sort: [{ field: 'Name' }] });
  const v = w.tableView('Task/V', { show: ['Due'] });
  assert.deepEqual(v.filters, { State: ['Open'] });
  assert.deepEqual(v.sort, [{ field: 'Name', dir: 'asc' }]);
  const v2 = w.tableView('Task/V', { filters: { State: ['Done'] } });
  assert.deepEqual(v2.fields, ['Name', 'State', 'Due']);
});

test('Blank is read-only and its name is reserved', () => {
  const w = fresh();
  assert.throws(() => w.tableView('Task/blank', { hide: ['Due'] }), (e) => e instanceof WeaveError && /read-only/.test(e.message) && /from/.test(e.message));
  assert.throws(() => w.tableView('Task/Blank', { delete: true }), /read-only/);
  assert.throws(() => w.tableView('Task/Standard', { name: 'Blank' }), /reserved/);
  assert.throws(() => w.tableView('Task/a/b', { show: ['Due'] }), /not found|No table/);
  const v = w.tableView('Task/From blank', { from: 'blank', hide: ['Description'] });
  assert.deepEqual(v.fields, ['Name', 'State', 'Due', 'Points']);
});

test('position is the single source of the default: position 0 opens first; default: true is an alias for it', () => {
  const w = fresh();
  w.tableView('Task/A', { from: 'blank' });
  w.tableView('Task/B', { from: 'blank' });
  assert.deepEqual(names(w.tableView('Task').views), ['Standard', 'A', 'B']);
  const b = w.tableView('Task/B', { position: 0 });
  assert.equal(b.default, undefined, 'reads carry no default flag; order says it');
  assert.deepEqual(names(w.tableView('Task').views), ['B', 'Standard', 'A'], 'position 0 is the default');
  w.tableView('Task/A', { default: true });
  assert.deepEqual(names(w.tableView('Task').views), ['A', 'B', 'Standard'], 'old callers: default: true moves the view to position 0');
  w.tableView('Task/A', { position: 2 });
  assert.deepEqual(names(w.tableView('Task').views), ['B', 'Standard', 'A']);
  w.tableView('Task/B', { position: 99 });
  assert.deepEqual(names(w.tableView('Task').views), ['Standard', 'A', 'B'], 'clamped to the end');
  assert.throws(() => w.tableView('Task/Standard', { default: false }), /position/, 'the first view is the default until another moves ahead of it');
  assert.throws(() => w.tableView('Task/A', { position: -1 }), /position/);
});

test('rename, and delete: the next view becomes the default; the last view cannot be deleted', () => {
  const w = fresh();
  w.tableView('Task/A', { from: 'blank' });
  assert.equal(w.tableView('Task/A', { name: 'Alpha' }).name, 'Alpha');
  assert.throws(() => w.tableView('Task/Alpha', { name: 'standard' }), /already/);
  assert.throws(() => w.tableView('Task/Alpha', { name: 'a/b' }), /\//);
  assert.throws(() => w.tableView('Task/Nope'), /not found/);
  assert.deepEqual(w.tableView('Task/Standard', { delete: true }), { name: 'Standard', deleted: true });
  assert.deepEqual(names(w.tableView('Task').views), ['Alpha'], 'the next view is first, so it is the default');
  assert.throws(() => w.tableView('Task/Alpha', { delete: true }),
    (e) => e instanceof WeaveError && /at least one view/.test(e.message) && /Alpha/.test(e.message));
  assert.deepEqual(names(w.tableView('Task').views), ['Alpha'], 'the refusal changed nothing');
  w.updateTable('Task', { filters: { State: ['Open'] } });
  assert.deepEqual(w.tableView('Task/Alpha').filters, { State: ['Open'] }, 'the legacy verb writes the leftmost view');
});

/* ---------- the legacy table verbs are the default view ---------- */

test('updateTable filters, sort and hiddenFields write the default view; describeSchema reads it back', () => {
  const w = fresh();
  w.tableView('Task/Other', { from: 'blank' });
  w.updateTable('Task', { filters: { State: ['Open'] }, sort: [{ field: 'Due', dir: 'desc' }], hiddenFields: ['Points', 'Chip', 'Card'] });
  const d = w.tableView('Task/Standard');
  assert.deepEqual(d.filters, { State: ['Open'] });
  assert.deepEqual(d.sort, [{ field: 'Due', dir: 'desc' }]);
  assert.deepEqual(d.fields, ['Name', 'Description', 'State', 'Due']);
  assert.deepEqual(w.tableView('Task/Other').fields, ['Name', 'Description', 'State', 'Due', 'Points'], 'only the default moved');
  const t = w.describeSchema().flatMap((s) => s.tables).find((x) => x.name === 'Task');
  assert.deepEqual(t.filters, { State: ['Open'] });
  assert.deepEqual(t.sort, [{ field: 'Due', dir: 'desc' }]);
  assert.deepEqual(t.hiddenFields, ['Points', 'Chip', 'Card']);
  w.updateTable('Task', { hiddenFields: ['Chip', 'Card'] });
  assert.deepEqual(w.tableView('Task/Standard').fields, ['Name', 'Description', 'State', 'Due', 'Points'], 'unhiding puts it back at its schema place');
});

test('a new field shows in every view; a dropped field leaves them; a rename keeps visibility, filter and sort', () => {
  const w = fresh();
  w.tableView('Task/V', { fields: ['Name', 'State'], filters: { State: ['Open'] }, sort: [{ field: 'State' }] });
  w.addField('Task', { name: 'Owner', type: 'text' });
  assert.deepEqual(w.tableView('Task/V').fields, ['Name', 'State', 'Owner']);
  assert.ok(w.tableView('Task/Standard').fields.includes('Owner'));
  w.updateField('Task', 'State', { name: 'Stage' });
  const v = w.tableView('Task/V');
  assert.deepEqual(v.fields, ['Name', 'Stage', 'Owner']);
  assert.deepEqual(v.filters, { Stage: ['Open'] });
  assert.deepEqual(v.sort, [{ field: 'Stage', dir: 'asc' }]);
  w.deleteField('Task', 'Stage');
  const after = w.tableView('Task/V');
  assert.deepEqual(after.fields, ['Name', 'Owner']);
  assert.ok(!after.filters && !after.sort, 'a filter or sort on a dropped field goes with it');
});

/* ---------- migration ---------- */

test('a workspace from before views: each table\'s filter, sort and hidden set become a Standard view, first in the strip', () => {
  const w = fresh();
  const dump = w.exportJSON();
  const task = Object.values(dump.tables).find((t) => t.name === 'Task');
  const byName = (n) => Object.values(task.fields).find((f) => f.name === n).id;
  delete task.tableViews;
  task.filters = { State: ['Open', 'Doing'] };
  task.sort = [{ field: 'Due', dir: 'desc' }];
  task.hiddenFields = ['Points', 'Chip', 'Card'];
  task.fieldOrder = [byName('Due'), ...task.fieldOrder.filter((id) => id !== byName('Due'))];
  const w2 = new Weave();
  w2.importJSON(dump);
  const list = w2.tableView('Task');
  assert.deepEqual(names(list.views), ['Standard']);
  assert.deepEqual(list.views[0], {
    id: list.views[0].id, name: 'Standard',
    fields: ['Due', 'Name', 'Description', 'State'],
    filters: { State: ['Open', 'Doing'] }, sort: [{ field: 'Due', dir: 'desc' }],
  }, 'no one loses what they saw: same columns, same order, same filter, same sort');
  const t = w2.getTable('Task');
  assert.ok(!('filters' in t) && !('sort' in t) && !('hiddenFields' in t), 'the legacy keys are gone: one source');
});

/* ---------- the schema document ---------- */

test('describeSchema emits views compactly and applySchema round-trips them', () => {
  const w = fresh();
  w.tableView('Task/Open work', { fields: ['State', 'Name'], filters: { State: ['Open'] }, sort: [{ field: 'Due', dir: 'desc' }] });
  w.tableView('Task/Open work', { position: 0 });
  const doc = w.describeSchema();
  const t = doc.flatMap((s) => s.tables).find((x) => x.name === 'Task');
  assert.deepEqual(t.views.map(({ id, ...v }) => v), [
    { name: 'Open work', fields: ['State', 'Name'], filters: { State: ['Open'] }, sort: [{ field: 'Due', dir: 'desc' }] },
    { name: 'Standard', fields: ['Name', 'Description', 'State', 'Due', 'Points'] },
  ]);
  assert.deepEqual(w.applySchema(doc), [], 'an untouched document is a no-op');
  const other = new Weave();
  other.applySchema(doc.filter((s) => !s.system));
  assert.deepEqual(other.tableView('Task').views.map(({ id, ...v }) => v), w.tableView('Task').views.map(({ id, ...v }) => v),
    'a fresh workspace grows the same views');
  t.views[1].fields = ['Name'];
  t.views.push({ name: 'Mine', fields: ['Name', 'Due'] });
  w.applySchema(doc);
  assert.deepEqual(w.tableView('Task/Standard').fields, ['Name']);
  assert.deepEqual(w.tableView('Task/Mine').fields, ['Name', 'Due']);
  t.views.splice(2, 1);
  assert.throws(() => w.applySchema(doc), /allowDestructive/, 'an omitted view is a deletion');
  w.applySchema(doc, { allowDestructive: true });
  assert.deepEqual(names(w.tableView('Task').views), ['Open work', 'Standard']);
});

test('applySchema round-trips the order, and can replace every view without tripping the last-view rule', () => {
  const w = fresh();
  w.tableView('Task/A', { fields: ['Name'] });
  w.tableView('Task/B', { fields: ['Name', 'Due'] });
  const doc = w.describeSchema();
  const t = doc.flatMap((s) => s.tables).find((x) => x.name === 'Task');
  t.views = [t.views[2], t.views[0], t.views[1]];
  w.applySchema(doc);
  assert.deepEqual(names(w.tableView('Task').views), ['B', 'Standard', 'A'], 'the document order is the strip order');
  assert.deepEqual(w.applySchema(w.describeSchema()), [], 'and it reads back unchanged');
  t.views = [{ name: 'Only', fields: ['Name', 'State'] }];
  w.applySchema(doc, { allowDestructive: true });
  assert.deepEqual(names(w.tableView('Task').views), ['Only'], 'the new view lands before the old ones go');
  t.views = [];
  assert.throws(() => w.applySchema(doc, { allowDestructive: true }), /at least one view/);
  assert.deepEqual(names(w.tableView('Task').views), ['Only']);
});

test('duplicate and export/import carry the views', () => {
  const w = fresh();
  w.tableView('Task/V', { fields: ['Name', 'Due'], sort: [{ field: 'Due' }] });
  const copy = w.duplicateTable('Task');
  assert.deepEqual(w.tableView(copy.id).views.map(({ id, ...v }) => v), w.tableView('Task').views.map(({ id, ...v }) => v));
  const w2 = new Weave();
  w2.importJSON(w.exportJSON());
  assert.deepEqual(w2.tableView('Dev/Task/V').fields, ['Name', 'Due'], 'Space/Table/View addresses it too');
});

/* ---------- the registry row is a door onto the same verb ---------- */

const viewRows = (w) => {
  const t = w.getTable('Views');
  return w.listEntities(t.id).map((e) => w.readEntity(e.id));
};

test('every view is a Workspace/Views row, related to its table', () => {
  const w = fresh();
  w.tableView('Task/Open work', { fields: ['Name', 'State'], filters: { State: ['Open'] }, sort: [{ field: 'Due', dir: 'desc' }] });
  const rows = viewRows(w).filter((r) => r.fields.Table?.[0]?.name === 'Task' || r.fields.Table?.name === 'Task');
  const row = rows.find((r) => r.name === 'Open work');
  assert.ok(row, `a row per view: ${JSON.stringify(rows.map((r) => r.name))}`);
  assert.equal(row.fields.Fields, 'Name, State');
  assert.equal(row.fields.Filter, 'State: Open');
  assert.equal(row.fields.Sort, 'Due desc');
  assert.equal(Number(row.fields.Position), 1);
  assert.equal(row.fields.Default, false);
  assert.equal(rows.find((r) => r.name === 'Standard').fields.Default, true);
  assert.ok(!viewRows(w).some((r) => /^blank$/i.test(r.name)), 'Blank has no row: it is never stored');
});

test('editing a Views row writes through the verb, with the verb\'s validation', () => {
  const w = fresh();
  w.tableView('Task/V', { fields: ['Name', 'State'] });
  const rowId = viewRows(w).find((r) => r.name === 'V').id;
  w.updateEntity(rowId, { Fields: 'State, Name, Due', Filter: 'State: Done', Sort: 'Due desc' });
  const v = w.tableView('Task/V');
  assert.deepEqual(v.fields, ['State', 'Name', 'Due']);
  assert.deepEqual(v.filters, { State: ['Done'] });
  assert.deepEqual(v.sort, [{ field: 'Due', dir: 'desc' }]);
  assert.throws(() => w.updateEntity(rowId, { Fields: 'Name, Nope' }), /Nope/);
  assert.throws(() => w.updateEntity(rowId, { Filter: 'State: Bogus' }), /Bogus/);
  w.updateEntity(rowId, { Default: true });
  assert.equal(w.tableView('Task').views[0].name, 'V', 'Default on the row moves the view to position 0');
  assert.equal(Number(w.readEntity(rowId).fields.Position), 0);
  w.updateEntity(rowId, { Name: 'Renamed' });
  assert.equal(w.tableView('Task/Renamed').name, 'Renamed');
  const tableRow = w.listEntities(w.getTable('Tables').id).find((e) => w.entityName(e) === 'Task');
  const made = w.createEntity('Views', { name: 'By row', values: { Table: tableRow.id, Fields: 'Name' } });
  assert.deepEqual(w.tableView('Task/By row').fields, ['Name'], 'a new row is a new view');
  assert.equal(w.entityName(made), 'By row');
  w.deleteEntity(made.id);
  assert.throws(() => w.tableView('Task/By row'), /not found/, 'deleting the row deletes the view');
  for (const v of w.tableView('Task').views.slice(1)) w.tableView(`Task/${v.id}`, { delete: true });
  const last = viewRows(w).find((r) => r.name === w.tableView('Task').views[0].name);
  assert.throws(() => w.deleteEntity(last.id), /at least one view/, 'the row door keeps the last view too');
});

/* ---------- MCP ---------- */

const call = (w, name, args) => dispatchTool(w, name, args ?? {});

test('weave_table_view: one tool reads, defines, edits and deletes', () => {
  const w = fresh();
  assert.deepEqual(names(call(w, 'weave_table_view', { view: 'Task' }).views), ['Standard']);
  const v = call(w, 'weave_table_view', { view: 'Task/Open bugs', fields: ['Name', 'State'], filters: { State: ['Open'] } });
  assert.deepEqual(v.fields, ['Name', 'State']);
  assert.deepEqual(call(w, 'weave_table_view', { view: 'Task/Open bugs', move: { field: 'State', before: 'Name' } }).fields, ['State', 'Name']);
  assert.throws(() => call(w, 'weave_table_view', { view: 'Task/blank', hide: ['Due'] }), /read-only/);
  call(w, 'weave_table_view', { view: 'Task/Open bugs', position: 0 });
  assert.deepEqual(names(call(w, 'weave_table_view', { view: 'Task' }).views), ['Open bugs', 'Standard'], 'position 0 is the default');
  call(w, 'weave_table_view', { view: 'Task/Standard', default: true });
  assert.deepEqual(names(call(w, 'weave_table_view', { view: 'Task' }).views), ['Standard', 'Open bugs'], 'default: true still works, as position 0');
  assert.deepEqual(call(w, 'weave_table_view', { view: 'Task/Open bugs', delete: true }), { name: 'Open bugs', deleted: true });
  assert.throws(() => call(w, 'weave_table_view', { view: 'Task/Standard', delete: true }), /at least one view/);
});

test('the view tool stays small: one tool, a lean schema', () => {
  const tool = TOOLS.find((t) => t.name === 'weave_table_view');
  assert.ok(tool, 'weave_table_view is a tool');
  const bytes = JSON.stringify(tool).length;
  assert.ok(bytes <= 1400, `every agent turn pays for this schema; keep it under 1400 bytes (is ${bytes})`);
  assert.equal(TOOLS.filter((t) => /view/.test(t.name)).length, 2, 'weave_views (share pages) and weave_table_view — no CRUD fan-out');
});

/* ---------- REST ---------- */

test('REST: the same verb at /api/tables/:table/views[/:view]', async () => {
  const w = fresh();
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const req = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  try {
    const list = await req('GET', '/api/tables/Task/views');
    assert.deepEqual(names(list.body.views), ['Standard']);
    const made = await req('PATCH', '/api/tables/Task/views/Open%20work', { fields: ['Name', 'State'], sort: [{ field: 'Due' }] });
    assert.equal(made.status, 200);
    assert.deepEqual(made.body.fields, ['Name', 'State']);
    assert.equal(made.body.created, true);
    const byId = await req('GET', `/api/tables/Task/views/${made.body.id}`);
    assert.equal(byId.body.name, 'Open work', 'a view answers to its id as well as its name');
    const one = await req('GET', '/api/tables/Task/views/Open%20work');
    assert.deepEqual(one.body.sort, [{ field: 'Due', dir: 'asc' }]);
    const blank = await req('PATCH', '/api/tables/Task/views/blank', { hide: ['Due'] });
    assert.equal(blank.status, 400);
    assert.match(blank.body.error, /read-only/);
    const gone = await req('DELETE', '/api/tables/Task/views/Open%20work');
    assert.deepEqual(gone.body, { name: 'Open work', deleted: true });
  } finally { server.close(); }
});

/* ---------- CLI ---------- */

test('CLI: weave table view reads and writes with the same keys', () => {
  const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
  const dir = mkdtempSync(join(tmpdir(), 'weave-table-views-'));
  const data = join(dir, 'ws.db');
  const cli = (...args) => JSON.parse(execFileSync('node', [BIN, ...args, '--data', data], { encoding: 'utf8' }));
  try {
    cli('space', 'create', 'Dev');
    cli('table', 'create', 'Dev', 'Task');
    cli('field', 'add', 'Task', 'Due', 'date');
    assert.deepEqual(cli('table', 'view', 'Task/Soon', '--fields', 'Name,Due', '--sort', '[{"field":"Due"}]').fields, ['Name', 'Due']);
    assert.deepEqual(cli('table', 'view', 'Task/Soon', '--move', 'Due', '--before', 'Name').fields, ['Due', 'Name']);
    assert.deepEqual(cli('table', 'view', 'Task/Soon', '--show', 'Description').fields, ['Due', 'Name', 'Description']);
    cli('table', 'view', 'Task/Soon', '--hide', 'Name', '--default');
    assert.deepEqual(names(cli('table', 'view', 'Task').views), ['Soon', 'Standard'], '--default moves it to position 0');
    cli('table', 'view', 'Task/Standard', '--position', '0');
    assert.deepEqual(names(cli('table', 'view', 'Task').views), ['Standard', 'Soon']);
    assert.deepEqual(cli('table', 'view', 'Task/Soon', '--delete'), { name: 'Soon', deleted: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a writer token cannot change a view: it was table config before, and the gate follows it', async () => {
  const w = fresh();
  const writer = w.createAccount({ name: 'bot', role: 'writer' }).token;
  const admin = w.createAccount({ name: 'root', role: 'admin' }).token;
  w.setRequireAuth(true);
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const patch = (token) => fetch(`${base}/api/tables/Task/views/Standard`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ hide: ['Due'] }),
  });
  try {
    assert.equal((await patch(writer)).status, 403);
    assert.ok(w.tableView('Task/Standard').fields.includes('Due'), 'nothing moved');
    const read = await fetch(`${base}/api/tables/Task/views`, { headers: { Authorization: `Bearer ${writer}` } });
    assert.equal(read.status, 200, 'reading the strip is a read');
    assert.equal((await patch(admin)).status, 200);
  } finally { server.close(); }
});
