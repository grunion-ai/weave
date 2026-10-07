import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { TOOLS, dispatchTool } from '../src/mcp.js';
import { startServer } from '../src/server.js';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');

function plans(w = new Weave()) {
  w.createSpace({ name: 'Plans' });
  const trip = w.createTable({ space: 'Plans', name: 'Trip' });
  const todo = w.createTable({ space: 'Plans', name: 'To-do' });
  w.addField(todo.id, { name: 'Done', type: 'checkbox' });
  w.addField(todo.id, { name: 'Priority', type: 'select', config: { options: [{ name: 'P1', hue: 'red' }, { name: 'P2', hue: 'amber' }, { name: 'P3', hue: 'slate' }] } });
  w.addField(todo.id, { name: 'Due', type: 'date' });
  w.addField(todo.id, { name: 'Notes', type: 'text' });
  w.addRelation(todo.id, { name: 'Trip', targetDb: trip.id, cardinality: 'many-to-one', inverseName: 'To-dos' });
  w.addRelation(todo.id, { name: 'Parent', targetDb: todo.id, cardinality: 'many-to-one', inverseName: 'Children' });
  w.addRelation(todo.id, { name: 'Trips seen', targetDb: trip.id, cardinality: 'many-to-many', inverseName: 'Seen by' });
  return { w, trip, todo };
}

test('a view saves the list keys and reads them back by name, compact', () => {
  const { w } = plans();
  const a = w.createEntity('To-do', { name: 'a' });
  const b = w.createEntity('To-do', { name: 'b' });
  const v = w.tableView('To-do/Standard', {
    layout: 'list',
    group: [{ field: 'Trip', heading: 'chip' }, 'Priority'],
    completedBy: 'Done', nest: 'Parent',
    collapsed: ['Japan › P3', 'Completed'],
    order: [b.publicId, `#${a.publicId}`],
  });
  assert.equal(v.layout, 'list');
  assert.deepEqual(v.group, [{ field: 'Trip', heading: 'chip' }, { field: 'Priority' }], 'defaults drop out: names, not ids');
  assert.equal(v.completedBy, 'Done');
  assert.equal(v.nest, 'Parent');
  assert.deepEqual(v.collapsed, ['Japan › P3', 'Completed']);
  assert.deepEqual(v.order, [b.publicId, a.publicId], 'rows read as #ids');
  const text = JSON.stringify(w.tableView('To-do/Standard'));
  assert.ok(!text.includes(a.id) && !/"[0-9a-f]{8}-[0-9a-f]{4}-/.test(text.replace(/"id":"[^"]+"/, '')), `no UUIDs past the view's own id: ${text}`);
  const stored = w.getTable('To-do').tableViews[0];
  assert.deepEqual(stored.order, [b.id, a.id], 'stored by id so renames and #ids never drift');
  assert.equal(stored.group[0].field, w.getField('To-do', 'Trip').id);
});

test('a date level takes a grain; order and heading are checked against the field type', () => {
  const { w } = plans();
  assert.deepEqual(w.tableView('To-do/By due', { group: [{ field: 'Due', grain: 'week' }] }).group, [{ field: 'Due', grain: 'week' }]);
  assert.deepEqual(w.tableView('To-do/By due', { group: 'Priority › Trip' }).group, [{ field: 'Priority' }, { field: 'Trip' }], 'a path string is shorthand');
  for (const [group, re] of [
    [['Notes'], /cannot group/],
    [[{ field: 'Priority', heading: 'chip' }], /Only a link field/],
    [[{ field: 'Priority', order: 'table' }], /only a link field/],
    [['Trip', 'Priority', 'Due', 'Done'], /at most 3/],
    [['Trip', 'Trip'], /once/],
    [['Nope'], /Nope/],
  ]) assert.throws(() => w.tableView('To-do/By due', { group }), re, JSON.stringify(group));
});

test('completedBy takes a checkbox or toggle; nest takes a to-one link to the same table', () => {
  const { w } = plans();
  assert.throws(() => w.tableView('To-do/X', { completedBy: 'Priority' }), /checkbox or toggle/);
  assert.throws(() => w.tableView('To-do/X', { nest: 'Trip' }), /link from To-do to itself/);
  assert.throws(() => w.tableView('To-do/X', { nest: 'Children' }), /one parent/);
  assert.throws(() => w.tableView('To-do/X', { layout: 'board' }), /table or list/);
  const t = w.createEntity('Trip', { name: 'Japan' });
  assert.throws(() => w.tableView('To-do/X', { order: [t.id] }), /not a row of/);
});

test('null clears a key, Table keeps the list keys, and from copies them', () => {
  const { w } = plans();
  w.tableView('To-do/Standard', { layout: 'list', group: ['Priority'], completedBy: 'Done', nest: 'Parent' });
  const table = w.tableView('To-do/Standard', { layout: 'table' });
  assert.equal(table.layout, undefined, 'table is the default and reads as nothing');
  assert.deepEqual(table.group, [{ field: 'Priority' }], 'switching to Table loses nothing');
  const copy = w.tableView('To-do/Copy', { from: 'Standard', layout: 'list' });
  assert.equal(copy.completedBy, 'Done');
  const cleared = w.tableView('To-do/Standard', { group: null, completedBy: null, nest: null, collapsed: null, order: null });
  for (const k of ['group', 'completedBy', 'nest', 'collapsed', 'order']) assert.equal(cleared[k], undefined, k);
  assert.deepEqual(w.tableView('To-do/Copy').group, [{ field: 'Priority' }], 'the copy is its own view');
});

test('a deleted field or row falls out of the read; the rest of the view stands', () => {
  const { w } = plans();
  const a = w.createEntity('To-do', { name: 'a' });
  const b = w.createEntity('To-do', { name: 'b' });
  w.tableView('To-do/Standard', { group: ['Priority', 'Trip'], completedBy: 'Done', order: [a.publicId, b.publicId] });
  w.deleteField('To-do', 'Priority');
  w.deleteEntity(a.id);
  const v = w.tableView('To-do/Standard');
  assert.deepEqual(v.group, [{ field: 'Trip' }]);
  assert.deepEqual(v.order, [b.publicId]);
  assert.equal(v.completedBy, 'Done');
});

test('duplicating the table keeps its list keys on the copy\'s own fields, and leaves the rows\' order behind', () => {
  const { w } = plans();
  const a = w.createEntity('To-do', { name: 'a' });
  w.tableView('To-do/Standard', { layout: 'list', group: ['Priority', { field: 'Trip', heading: 'chip' }], completedBy: 'Done', nest: 'Parent', order: [a.publicId] });
  const copy = w.duplicateTable('To-do');
  const v = w.tableView(`${copy.id}/Standard`);
  assert.deepEqual(v.group, [{ field: 'Priority' }, { field: 'Trip', heading: 'chip' }]);
  assert.equal(v.nest, 'Parent');
  assert.equal(v.completedBy, 'Done');
  assert.equal(v.order, undefined);
  const stored = w.getTable(copy.id).tableViews[0];
  assert.equal(stored.nest, w.getField(copy.id, 'Parent').id, 'the copy\'s own Parent link');
});

test('the Views registry row shows Layout and Group, and writing them writes the view', () => {
  const { w } = plans();
  w.tableView('To-do/Standard', { layout: 'list', group: [{ field: 'Trip', heading: 'chip' }, 'Priority'] });
  const t = w.getTable('Views');
  const rowOf = () => w.listEntities(t.id).map((e) => w.readEntity(e.id)).find((r) => r.name === 'Standard' && (r.fields.Table?.[0]?.name ?? r.fields.Table?.name) === 'To-do');
  assert.equal(rowOf().fields.Layout, 'list');
  assert.equal(rowOf().fields.Group, 'Trip › Priority');
  w.updateEntity(rowOf().id, { Group: 'Trip' });
  assert.deepEqual(w.tableView('To-do/Standard').group, [{ field: 'Trip', heading: 'chip' }], 'a level that stays keeps its heading');
  w.updateEntity(rowOf().id, { Layout: '' });
  assert.equal(w.tableView('To-do/Standard').layout, undefined);
});

test('describeSchema carries layout, group, completedBy and nest into a fresh workspace; rows never travel', () => {
  const { w } = plans();
  const a = w.createEntity('To-do', { name: 'a' });
  w.tableView('To-do/Standard', { layout: 'list', group: [{ field: 'Trip', heading: 'chip' }], completedBy: 'Done', nest: 'Parent', order: [a.publicId], collapsed: ['Completed'] });
  const w2 = new Weave();
  w2.applySchema(w.describeSchema());
  const v = w2.tableView('To-do/Standard');
  assert.equal(v.layout, 'list');
  assert.deepEqual(v.group, [{ field: 'Trip', heading: 'chip' }]);
  assert.equal(v.completedBy, 'Done');
  assert.equal(v.nest, 'Parent');
  assert.equal(v.order, undefined);
  assert.equal(v.collapsed, undefined);
});

test('the agent writes the list keys through weave_table_view with names, and the schema stays small', () => {
  const { w } = plans();
  const v = dispatchTool(w, 'weave_table_view', { view: 'To-do/Standard', layout: 'list', group: ['Trip', 'Priority'], completedBy: 'Done', nest: 'Parent' });
  assert.deepEqual(v.group, [{ field: 'Trip' }, { field: 'Priority' }]);
  const tool = TOOLS.find((t) => t.name === 'weave_table_view');
  for (const k of ['layout', 'group', 'completedBy', 'nest', 'collapsed', 'order']) assert.ok(tool.inputSchema.properties[k], `schema names ${k}`);
  assert.ok(JSON.stringify(tool).length < 2300, `weave_table_view is ${JSON.stringify(tool).length} bytes`);
});

test('the CLI and REST take the same keys', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-list-'));
  try {
    const data = join(dir, 'w.db');
    const fw = new Weave({ path: data });
    plans(fw);
    fw.save?.();
    const cli = (...args) => JSON.parse(execFileSync(process.execPath, [BIN, '--data', data, ...args], { encoding: 'utf8' }));
    const v = cli('table', 'view', 'To-do/Standard', '--layout', 'list', '--group', 'Trip,Priority', '--completed-by', 'Done', '--nest', 'Parent');
    assert.equal(v.layout, 'list');
    assert.deepEqual(v.group, [{ field: 'Trip' }, { field: 'Priority' }]);
    assert.equal(v.completedBy, 'Done');
    assert.equal(cli('table', 'view', 'To-do/Standard', '--group', '[{"field":"Trip","heading":"chip"}]').group[0].heading, 'chip');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const { w } = plans();
  const { server } = await startServer(w, { port: 0 });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const tid = w.getTable('To-do').id;
    const res = await fetch(`${base}/api/tables/${tid}/views/Standard`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ layout: 'list', collapsed: ['Completed'] }) });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).collapsed, ['Completed']);
    const schema = await (await fetch(`${base}/api/schema`)).json();
    const t = schema.flatMap((s) => s.tables).find((x) => x.id === tid);
    assert.equal(t.views[0].layout, 'list', 'the client reads the keys from the schema');
  } finally { server.close(); }
});
