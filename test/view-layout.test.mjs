/* Column widths and the frozen zone are view configuration (Feature #233).
   They ride the one view verb (`tableView` / `weave_table_view` /
   `weave table view` / `/api/tables/:t/views/:v`) beside field order, by
   name, and reads stay compact: a view with no widths and nothing frozen
   past # reads exactly as before. Kyle's rule 2 is an engine rule too: a
   hidden field keeps its width and its place for when it returns. */
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

function fresh() {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  w.addField('Task', { name: 'State', type: 'select', config: { options: ['Open', 'Done'] } });
  w.addField('Task', { name: 'Due', type: 'date' });
  w.addField('Task', { name: 'Points', type: 'number' });
  return w;
}

test('widths are names to pixels on the view; a write merges, null clears one', () => {
  const w = fresh();
  const v = w.tableView('Task/Standard', { widths: { Name: 240, Due: 150.4 } });
  assert.deepEqual(v.widths, { Name: 240, Due: 150 }, 'rounded, by name');
  assert.deepEqual(w.tableView('Task/Standard', { widths: { Points: 96 } }).widths, { Name: 240, Due: 150, Points: 96 }, 'a write names only what changes');
  assert.deepEqual(w.tableView('Task/Standard', { widths: { Due: null } }).widths, { Name: 240, Points: 96 });
  const none = w.tableView('Task/Standard', { widths: { Name: null, Points: null } });
  assert.ok(!('widths' in none), 'no widths, no key: reads stay compact');
});

test('bad widths are refused whole', () => {
  const w = fresh();
  w.tableView('Task/Standard', { widths: { Name: 240 } });
  const before = JSON.stringify(w.tableView('Task/Standard'));
  assert.throws(() => w.tableView('Task/Standard', { widths: { Nope: 200 } }), /Nope/);
  assert.throws(() => w.tableView('Task/Standard', { widths: { Due: 'wide' } }), /width/);
  assert.throws(() => w.tableView('Task/Standard', { widths: { Due: 12 } }), /width/);
  assert.throws(() => w.tableView('Task/Standard', { widths: { Due: 20000 } }), /width/);
  assert.throws(() => w.tableView('Task/Standard', { widths: [200] }), /widths/);
  assert.throws(() => w.tableView('Task/Standard', { widths: { Due: 200, Nope: 1 } }), /Nope/);
  assert.equal(JSON.stringify(w.tableView('Task/Standard')), before, 'nothing half-written');
});

test('frozen counts the leading fields frozen after #; 0 is the default and is not emitted', () => {
  const w = fresh();
  assert.ok(!('frozen' in w.tableView('Task/Standard')), 'only # is frozen by default');
  assert.equal(w.tableView('Task/Standard', { frozen: 2 }).frozen, 2);
  assert.ok(!('frozen' in w.tableView('Task/Standard', { frozen: 0 })));
  assert.throws(() => w.tableView('Task/Standard', { frozen: -1 }), /frozen/);
  assert.throws(() => w.tableView('Task/Standard', { frozen: 1.5 }), /frozen/);
  assert.throws(() => w.tableView('Task/Standard', { frozen: 6 }), /frozen/, 'no more than the fields that show');
});

test('a move and its freeze land in one write (the grid\'s drop across the seam)', () => {
  const w = fresh();
  const v = w.tableView('Task/Standard', { move: { field: 'Due', before: 'Name' }, frozen: 1 });
  assert.deepEqual(v.fields.slice(0, 2), ['Due', 'Name']);
  assert.equal(v.frozen, 1);
  const back = w.tableView('Task/Standard', { move: { field: 'Due', after: 'Name' }, frozen: 0 });
  assert.deepEqual(back.fields.slice(0, 2), ['Name', 'Due']);
  assert.ok(!('frozen' in back));
});

test('a hidden field keeps its width and its place, and a frozen one its freeze', () => {
  const w = fresh();
  w.tableView('Task/Standard', { move: { field: 'Due', before: 'Name' }, widths: { Due: 150 } });
  w.tableView('Task/Standard', { hide: ['Due'] });
  const hidden = w.tableView('Task/Standard');
  assert.ok(!hidden.fields.includes('Due'));
  assert.equal(hidden.widths.Due, 150, 'the width stays with the view');
  assert.deepEqual(w.tableView('Task/Standard', { show: ['Due'] }).fields,
    ['Due', 'Name', 'Description', 'State', 'Points'], 'back where it was, not at its schema place');
  // Frozen: Due and Name frozen; hiding Due takes one out of the zone, showing it puts it back.
  w.tableView('Task/Standard', { frozen: 2 });
  const h = w.tableView('Task/Standard', { hide: ['Due'] });
  assert.equal(h.frozen, 1, 'Name stays frozen alone; nothing else is pulled into the zone');
  const s = w.tableView('Task/Standard', { show: ['Due'] });
  assert.equal(s.frozen, 2);
  assert.deepEqual(s.fields.slice(0, 2), ['Due', 'Name']);
  // Hiding a field that is not frozen leaves the zone alone.
  assert.equal(w.tableView('Task/Standard', { hide: ['Points'] }).frozen, 2);
});

test('rename keeps the width; a dropped field leaves widths and the zone; a new field starts unsized', () => {
  const w = fresh();
  w.tableView('Task/Standard', { widths: { Due: 150, State: 130 }, frozen: 3 });
  w.updateField('Task', 'Due', { name: 'Deadline' });
  assert.deepEqual(w.tableView('Task/Standard').widths, { Deadline: 150, State: 130 });
  w.deleteField('Task', 'State');
  const v = w.tableView('Task/Standard');
  assert.deepEqual(v.widths, { Deadline: 150 });
  assert.equal(v.frozen, 2, 'the zone shrinks by the frozen field that left');
  w.addField('Task', { name: 'Owner', type: 'text' });
  assert.equal(w.tableView('Task/Standard').widths.Owner, undefined, 'a new field wears its type default until someone sizes it');
});

test('describeSchema carries widths and frozen, applySchema round-trips them, duplicate re-points them', () => {
  const w = fresh();
  w.tableView('Task/Standard', { widths: { Name: 240 }, frozen: 1 });
  const doc = w.describeSchema();
  const t = doc.flatMap((s) => s.tables).find((x) => x.name === 'Task');
  assert.deepEqual(t.views[0].widths, { Name: 240 });
  assert.equal(t.views[0].frozen, 1);
  assert.deepEqual(w.applySchema(doc), [], 'an untouched document is a no-op');
  t.views[0].widths = { Due: 120 };
  t.views[0].frozen = 2;
  w.applySchema(doc);
  const v = w.tableView('Task/Standard');
  assert.deepEqual(v.widths, { Due: 120 }, 'the document is the set: Name is no longer sized');
  assert.equal(v.frozen, 2);
  const copy = w.duplicateTable('Task');
  const cv = w.tableView(copy.id).views[0];
  assert.deepEqual(cv.widths, { Due: 120 });
  assert.equal(cv.frozen, 2);
  const w2 = new Weave();
  w2.importJSON(w.exportJSON());
  assert.deepEqual(w2.tableView('Task/Standard').widths, { Due: 120 }, 'export/import carries them');
});

test('Views rows carry Frozen and Widths, and editing them writes through the verb', () => {
  const w = fresh();
  w.tableView('Task/Standard', { widths: { Name: 240, Due: 120 }, frozen: 1 });
  const t = w.getTable('Views');
  const row = w.listEntities(t.id).map((e) => w.readEntity(e.id)).find((r) => r.name === 'Standard' && (r.fields.Table?.[0]?.name ?? r.fields.Table?.name) === 'Task');
  assert.equal(Number(row.fields.Frozen), 1);
  assert.equal(row.fields.Widths, 'Name 240, Due 120');
  w.updateEntity(row.id, { Frozen: 2, Widths: 'Due 130, Points 90' });
  const v = w.tableView('Task/Standard');
  assert.equal(v.frozen, 2);
  assert.deepEqual(v.widths, { Due: 130, Points: 90 }, 'the row is the whole set');
  assert.throws(() => w.updateEntity(row.id, { Widths: 'Due wide' }), /width/i);
});

const call = (w, name, args) => dispatchTool(w, name, args ?? {});

test('MCP: weave_table_view takes widths and frozen, and the tool list does not grow', () => {
  const w = fresh();
  const before = TOOLS.length;
  const v = call(w, 'weave_table_view', { view: 'Task/Standard', widths: { Name: 250 }, frozen: 1 });
  assert.deepEqual(v.widths, { Name: 250 });
  assert.equal(v.frozen, 1);
  const tool = TOOLS.find((t) => t.name === 'weave_table_view');
  assert.ok(tool.inputSchema.properties.widths && tool.inputSchema.properties.frozen, 'both keys are in the schema');
  assert.match(tool.description, /frozen/);
  assert.equal(TOOLS.length, before);
});

test('REST and CLI speak the same keys', async () => {
  const w = fresh();
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/tables/Task/views/Standard`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ widths: { Due: 140 }, frozen: 1 }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(body.widths, { Due: 140 });
    assert.equal(body.frozen, 1);
  } finally { server.close(); }
  const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
  const dir = mkdtempSync(join(tmpdir(), 'weave-view-layout-'));
  const data = join(dir, 'ws.db');
  const cli = (...args) => JSON.parse(execFileSync('node', [BIN, ...args, '--data', data], { encoding: 'utf8' }));
  try {
    cli('space', 'create', 'Dev');
    cli('table', 'create', 'Dev', 'Task');
    const v = cli('table', 'view', 'Task/Standard', '--frozen', '1', '--widths', '{"Name":230}');
    assert.equal(v.frozen, 1);
    assert.deepEqual(v.widths, { Name: 230 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* Issue #418 (Kyle, 2026-09-26: "system fields should be reorderable as
   well"). The system columns a view shows are names in its one ordered
   field list, beside the fields: they move, freeze, size, hide and come back
   through the same verb. Only # stays out of the list, locked first. */
test('system columns live in the view\'s one ordered list: shown, moved, frozen, sized by name', () => {
  const w = fresh();
  w.updateTable('Task', { systemFields: ['Created At', 'Modified By'] });
  const v0 = w.tableView('Task/Standard');
  assert.deepEqual(v0.fields, ['Name', 'Description', 'State', 'Due', 'Points', 'Created At', 'Modified By'],
    'the table\'s shown system columns close the default view');
  const moved = w.tableView('Task/Standard', { move: { field: 'Created At', before: 'Name' }, frozen: 1, widths: { 'Created At': 160 } });
  assert.deepEqual(moved.fields.slice(0, 2), ['Created At', 'Name']);
  assert.equal(moved.frozen, 1);
  assert.deepEqual(moved.widths, { 'Created At': 160 });
  const hidden = w.tableView('Task/Standard', { hide: ['Created At'] });
  assert.ok(!hidden.fields.includes('Created At'));
  assert.equal(hidden.widths['Created At'], 160, 'a hidden system column keeps its width');
  const back = w.tableView('Task/Standard', { show: ['created at'] });
  assert.deepEqual(back.fields.slice(0, 2), ['Created At', 'Name'], 'and its place, and its freeze');
  assert.equal(back.frozen, 1);
  // Shown in another view by name, from the verb alone.
  assert.deepEqual(w.tableView('Task/Stamps', { fields: ['Modified By', 'Name'] }).fields, ['Modified By', 'Name']);
  assert.deepEqual(w.tableView('Task/Stamps', { show: ['Created By'] }).fields, ['Modified By', 'Name', 'Created By'],
    'a system column shown for the first time closes the list');
  assert.throws(() => w.tableView('Task/Stamps', { fields: ['Activity'] }), /Activity/, 'Activity is the entity page\'s panel, not a column');
  assert.deepEqual(w.tableView('Task/blank').fields, ['Name', 'Description', 'State', 'Due', 'Points'], 'Blank stays the raw fields');
});

test('a new field lands before the trailing system columns; the Views row and the schema document carry them', () => {
  const w = fresh();
  w.updateTable('Task', { systemFields: ['Created At'] });
  w.addField('Task', { name: 'Owner', type: 'text' });
  assert.deepEqual(w.tableView('Task/Standard').fields.slice(-2), ['Owner', 'Created At']);
  const row = w.listEntities(w.getTable('Views').id).map((e) => w.readEntity(e.id))
    .find((r) => r.name === 'Standard' && (r.fields.Table?.[0]?.name ?? r.fields.Table?.name) === 'Task');
  assert.match(row.fields.Fields, /Owner, Created At$/);
  w.updateEntity(row.id, { Fields: 'Created At, Name' });
  assert.deepEqual(w.tableView('Task/Standard').fields, ['Created At', 'Name'], 'the row writes through the verb');
  const doc = w.describeSchema();
  assert.deepEqual(w.applySchema(doc), [], 'an untouched document is a no-op');
  const t = doc.flatMap((s) => s.tables).find((x) => x.name === 'Task');
  t.views[0].fields = ['Name', 'Modified At'];
  w.applySchema(doc);
  assert.deepEqual(w.tableView('Task/Standard').fields, ['Name', 'Modified At']);
});

test('a workspace from before this change: each table\'s shown system columns join every view once', () => {
  const w = fresh();
  w.tableView('Task/Other', { fields: ['Name'] });
  const dump = w.exportJSON();
  const task = Object.values(dump.tables).find((x) => x.name === 'Task');
  task.systemFields = ['Created At', 'Activity'];
  delete task.systemColumnsInViews;
  const w2 = new Weave();
  w2.importJSON(dump);
  assert.deepEqual(w2.tableView('Task/Standard').fields.at(-1), 'Created At');
  assert.deepEqual(w2.tableView('Task/Other').fields, ['Name', 'Created At'], 'what every view showed before, it shows now');
  w2.tableView('Task/Other', { hide: ['Created At'] });
  const w3 = new Weave();
  w3.importJSON(w2.exportJSON());
  assert.deepEqual(w3.tableView('Task/Other').fields, ['Name'], 'once: a hidden system column stays hidden after the move');
});
