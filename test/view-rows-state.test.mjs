/* Deleted rows and the Σ rollup row are saved per view (Issue #442; Kyle,
   2026-09-27: "A view carries filters, fields, sort, density, deleted rows
   and the Σ row"). Two view keys on the one verb, beside density:
   `deleted` (true shows the trashed rows in place) and `rollups` (true
   draws the Σ row, false hides it). A view that never set `rollups`
   follows the table's older `hideRollups` opt-in, so no grid changes on
   the upgrade. Both ride every surface the verb has: engine, MCP, CLI,
   REST, the schema document and the Workspace/Views row. */
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
import { fresh } from './lib/fixtures.mjs';

test('deleted and rollups are view settings: absent by default, stored when set, copied with the view', () => {
  const w = fresh();
  const std = w.tableView('Task/Standard');
  assert.equal(std.deleted, undefined, 'a view nobody set hides the trash');
  assert.equal(std.rollups, undefined, 'and follows the table for the Σ row');
  assert.equal(w.tableView('Task/Standard', { deleted: true }).deleted, true);
  assert.equal(w.tableView('Task/Standard', { rollups: true }).rollups, true);
  assert.equal(w.tableView('Task/Copy', { from: 'Standard' }).deleted, true, 'a copy takes its source\'s');
  assert.equal(w.tableView('Task/Copy').rollups, true);
  assert.equal(w.tableView('Task/Fresh', { from: 'blank' }).deleted, undefined, 'a new view starts without them');
  assert.equal(w.tableView('Task/Standard', { deleted: false }).deleted, undefined, 'false clears deleted: it is the default');
  assert.equal(w.tableView('Task/Standard', { rollups: false }).rollups, false, 'false is kept for rollups: it overrides a table that opted in');
  assert.equal(w.tableView('Task/Standard', { rollups: null }).rollups, undefined, 'null hands the Σ row back to the table');
  assert.equal(w.tableView('Task/Copy').deleted, true, 'each view keeps its own');
});

test('a deleted or rollups that is not true or false is refused, and the view is left as it was', () => {
  const w = fresh();
  assert.throws(() => w.tableView('Task/Standard', { deleted: 'yes' }), /deleted is true or false/);
  assert.throws(() => w.tableView('Task/Standard', { rollups: 1 }), /rollups is true, false or null/);
  assert.equal(w.tableView('Task/Standard').deleted, undefined);
});

test('the schema document carries them and applySchema round-trips them', () => {
  const w = fresh();
  w.tableView('Task/Standard', { deleted: true, rollups: false });
  const doc = w.describeSchema();
  const v = doc.flatMap((s) => s.tables).find((t) => t.name === 'Task').views[0];
  assert.equal(v.deleted, true);
  assert.equal(v.rollups, false);
  assert.deepEqual(w.applySchema(doc), [], 'an untouched document is a no-op');
  v.rollups = true;
  delete v.deleted;
  w.applySchema(doc);
  assert.equal(w.tableView('Task/Standard').deleted, undefined, 'a document without deleted hides the trash');
  assert.equal(w.tableView('Task/Standard').rollups, true);
  delete v.rollups;
  w.applySchema(doc);
  assert.equal(w.tableView('Task/Standard').rollups, undefined, 'a document without rollups follows the table');
  w.tableView('Task/Standard', { deleted: true });
  const w2 = new Weave();
  w2.importJSON(w.exportJSON());
  assert.equal(w2.tableView('Task/Standard').deleted, true, 'export and import keep it');
});

test('the Workspace/Views row shows and writes them', () => {
  const w = fresh();
  const t = w.getTable('Views');
  const row = () => w.listEntities(t.id).map((e) => w.readEntity(e.id)).find((r) => r.name === 'Standard' && (r.fields.Table?.[0]?.name ?? r.fields.Table?.name) === 'Task');
  assert.equal(row().fields['Show Deleted'], false);
  assert.equal(row().fields['Rollup Row'], false, 'a table nobody opted in draws no Σ row');
  w.tableView('Task/Standard', { deleted: true, rollups: true });
  assert.equal(row().fields['Show Deleted'], true);
  assert.equal(row().fields['Rollup Row'], true);
  w.updateEntity(row().id, { 'Show Deleted': false, 'Rollup Row': false });
  assert.equal(w.tableView('Task/Standard').deleted, undefined);
  assert.equal(w.tableView('Task/Standard').rollups, false);
});

test('weave_table_view, the CLI and REST take them', async () => {
  const w = fresh();
  const tool = TOOLS.find((t) => t.name === 'weave_table_view');
  assert.equal(tool.inputSchema.properties.deleted.type, 'boolean');
  assert.deepEqual(tool.inputSchema.properties.rollups.type, ['boolean', 'null']);
  assert.match(tool.description, /deleted/);
  assert.match(tool.description, /rollups/);
  const view = await dispatchTool(w, 'weave_table_view', { view: 'Task/Standard', deleted: true, rollups: true });
  assert.equal(view.deleted, true);
  assert.equal(view.rollups, true);

  const dir = mkdtempSync(join(tmpdir(), 'weave-rows-'));
  try {
    const db = join(dir, 'w.db');
    const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
    const run = (...args) => execFileSync(process.execPath, [cli, '--data', db, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    run('space', 'create', 'Dev');
    run('table', 'create', 'Dev', 'Task');
    const set = JSON.parse(run('table', 'view', 'Task/Standard', '--deleted', 'on', '--rollups', 'off'));
    assert.equal(set.deleted, true);
    assert.equal(set.rollups, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }

  const { server } = await startServer(w, { port: 0 });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const t = w.getTable('Task');
    const res = await fetch(`${base}/api/tables/${t.id}/views/Standard`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deleted: false, rollups: null }) });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.deleted, undefined);
    assert.equal(body.rollups, undefined);
  } finally { server.close(); }
});
