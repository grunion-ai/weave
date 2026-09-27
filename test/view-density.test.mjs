/* Row density is view configuration (Feature #239). It rides the one view
   verb (`tableView` / `weave_table_view` / `weave table view` /
   `/api/tables/:t/views/:v`) beside filter, sort and field order, by name,
   so an agent reads and sets it the way it sets every other view setting.
   Comfortable is the default and reads as absent, so a view nobody has
   set reads exactly as before. */
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
  return w;
}

test('density is a view setting: compact and spacious are stored, comfortable is the default and reads as absent', () => {
  const w = fresh();
  assert.equal(w.tableView('Task/Standard').density, undefined, 'a view nobody set is comfortable, and says nothing');
  assert.equal(w.tableView('Task/Standard', { density: 'spacious' }).density, 'spacious');
  assert.equal(w.tableView('Task/Standard').density, 'spacious', 'and it stays');
  assert.equal(w.tableView('Task/Standard', { density: 'Compact' }).density, 'compact', 'any case');
  assert.equal(w.tableView('Task/Standard', { density: 'comfortable' }).density, undefined, 'comfortable clears it');
  // A second view keeps its own; a copy takes its source's.
  w.tableView('Task/Standard', { density: 'compact' });
  assert.equal(w.tableView('Task/Wide', { fields: ['Name'] }).density, undefined, 'a new view starts at Comfortable');
  assert.equal(w.tableView('Task/Copy', { from: 'Standard' }).density, 'compact');
  assert.equal(w.tableView('Task/Standard').density, 'compact');
});

test('a density that is not one of the three is refused, and the view is left as it was', () => {
  const w = fresh();
  w.tableView('Task/Standard', { density: 'compact' });
  assert.throws(() => w.tableView('Task/Standard', { density: 'tall' }), /compact, comfortable or spacious/);
  assert.throws(() => w.tableView('Task/Standard', { density: 3 }), /compact, comfortable or spacious/);
  assert.equal(w.tableView('Task/Standard').density, 'compact');
});

test('describeSchema carries density, applySchema round-trips it, export/import keeps it', () => {
  const w = fresh();
  w.tableView('Task/Standard', { density: 'spacious' });
  const doc = w.describeSchema();
  const t = doc.flatMap((s) => s.tables).find((x) => x.name === 'Task');
  assert.equal(t.views[0].density, 'spacious');
  assert.deepEqual(w.applySchema(doc), [], 'an untouched document is a no-op');
  t.views[0].density = 'compact';
  w.applySchema(doc);
  assert.equal(w.tableView('Task/Standard').density, 'compact');
  delete t.views[0].density;
  w.applySchema(doc);
  assert.equal(w.tableView('Task/Standard').density, undefined, 'a document without it is the default');
  w.tableView('Task/Standard', { density: 'compact' });
  const w2 = new Weave();
  w2.importJSON(w.exportJSON());
  assert.equal(w2.tableView('Task/Standard').density, 'compact');
});

test('the Views row carries Density and editing it writes through the verb', () => {
  const w = fresh();
  w.tableView('Task/Standard', { density: 'compact' });
  const t = w.getTable('Views');
  const row = w.listEntities(t.id).map((e) => w.readEntity(e.id)).find((r) => r.name === 'Standard' && (r.fields.Table?.[0]?.name ?? r.fields.Table?.name) === 'Task');
  assert.equal(row.fields.Density, 'compact');
  w.updateEntity(row.id, { Density: 'spacious' });
  assert.equal(w.tableView('Task/Standard').density, 'spacious');
  w.updateEntity(row.id, { Density: '' });
  assert.equal(w.tableView('Task/Standard').density, undefined, 'an empty cell is the default');
});

test('MCP, REST and CLI speak density by name', async () => {
  const w = fresh();
  const before = TOOLS.length;
  assert.equal(dispatchTool(w, 'weave_table_view', { view: 'Task/Standard', density: 'spacious' }).density, 'spacious');
  const tool = TOOLS.find((x) => x.name === 'weave_table_view');
  assert.ok(tool.inputSchema.properties.density, 'the key is in the schema');
  assert.match(tool.description, /density/);
  assert.equal(TOOLS.length, before);
  const { server } = await startServer(w, { port: 0 });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/tables/Task/views/Standard`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ density: 'compact' }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).density, 'compact');
  } finally { server.close(); }
  const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
  const dir = mkdtempSync(join(tmpdir(), 'weave-view-density-'));
  const data = join(dir, 'ws.db');
  const cli = (...args) => JSON.parse(execFileSync('node', [BIN, ...args, '--data', data], { encoding: 'utf8' }));
  try {
    cli('space', 'create', 'Dev');
    cli('table', 'create', 'Dev', 'Task');
    assert.equal(cli('table', 'view', 'Task/Standard', '--density', 'spacious').density, 'spacious');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
