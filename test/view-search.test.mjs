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

const seeded = () => {
  const w = fresh();
  for (const name of ['Alpha launch', 'Beta launch', 'Gamma cleanup']) w.createEntity('Task', { name });
  return w;
};

test('search is a view setting: absent by default, stored trimmed, copied by from, cleared by empty or null (Feature #307)', () => {
  const w = seeded();
  assert.equal(w.tableView('Task/Standard').search, undefined, 'a view nobody searched carries no search');
  assert.equal(w.tableView('Task/Standard', { search: '  launch ' }).search, 'launch');
  assert.equal(w.tableView('Task/Copy', { from: 'Standard' }).search, 'launch', 'a duplicate takes its source\'s search');
  assert.equal(w.tableView('Task/Fresh', { from: 'blank' }).search, undefined, 'a view from Blank starts with none');
  assert.equal(w.tableView('Task/Standard', { search: '' }).search, undefined, 'an empty string clears it');
  assert.equal(w.tableView('Task/Copy', { search: null }).search, undefined, 'null clears it');
  assert.equal(w.tableView('Task/blank').search, undefined, 'Blank never has one');
});

test('a search that is not a string is refused, and the view is left as it was', () => {
  const w = seeded();
  w.tableView('Task/Standard', { search: 'launch' });
  assert.throws(() => w.tableView('Task/Standard', { search: 42 }), /search is the text/);
  assert.throws(() => w.tableView('Task/Standard', { search: ['launch'] }), /search is the text/);
  assert.equal(w.tableView('Task/Standard').search, 'launch');
});

test('the saved search, sent as the query\'s search, returns the rows the grid shows', () => {
  const w = seeded();
  const { search } = w.tableView('Task/Standard', { search: 'launch' });
  assert.deepEqual(w.query('Task', { search }).items.map((e) => e.name).sort(), ['Alpha launch', 'Beta launch']);
});

test('the schema document carries it, applySchema round-trips it, and export keeps it', () => {
  const w = seeded();
  w.tableView('Task/Standard', { search: 'launch' });
  const doc = w.describeSchema();
  const v = doc.flatMap((s) => s.tables).find((t) => t.name === 'Task').views[0];
  assert.equal(v.search, 'launch');
  assert.deepEqual(w.applySchema(doc), [], 'an untouched document is a no-op');
  v.search = 'cleanup';
  w.applySchema(doc);
  assert.equal(w.tableView('Task/Standard').search, 'cleanup');
  delete v.search;
  w.applySchema(doc);
  assert.equal(w.tableView('Task/Standard').search, undefined, 'a document without search clears it');
  w.tableView('Task/Standard', { search: 'beta' });
  const w2 = new Weave();
  w2.importJSON(w.exportJSON());
  assert.equal(w2.tableView('Task/Standard').search, 'beta');
});

test('the System/Views row shows and writes it', () => {
  const w = seeded();
  const t = w.getTable('Views');
  const row = () => w.listEntities(t.id).map((e) => w.readEntity(e.id)).find((r) => r.name === 'Standard' && (r.fields.Table?.[0]?.name ?? r.fields.Table?.name) === 'Task');
  assert.equal(row().fields.Search ?? '', '');
  w.tableView('Task/Standard', { search: 'launch' });
  assert.equal(row().fields.Search, 'launch');
  w.updateEntity(row().id, { Search: 'gamma' });
  assert.equal(w.tableView('Task/Standard').search, 'gamma');
  w.updateEntity(row().id, { Search: '' });
  assert.equal(w.tableView('Task/Standard').search, undefined);
});

test('weave_table_view, the CLI and REST read and write it, and the REST query honours it', async () => {
  const w = seeded();
  const tool = TOOLS.find((t) => t.name === 'weave_table_view');
  assert.ok(tool.inputSchema.properties.search, 'the tool takes search');
  assert.match(tool.description, /search/);
  assert.equal((await dispatchTool(w, 'weave_table_view', { view: 'Task/Standard', search: 'launch' })).search, 'launch');
  const rows = await dispatchTool(w, 'weave_query', { db: 'Task', search: w.tableView('Task/Standard').search });
  assert.equal(rows.total, 2);

  const dir = mkdtempSync(join(tmpdir(), 'weave-search-'));
  try {
    const db = join(dir, 'w.db');
    const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
    const run = (...args) => execFileSync(process.execPath, [cli, '--data', db, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    run('space', 'create', 'Dev');
    run('table', 'create', 'Dev', 'Task');
    assert.equal(JSON.parse(run('table', 'view', 'Task/Standard', '--search', 'launch')).search, 'launch');
    assert.equal(JSON.parse(run('table', 'view', 'Task/Standard', '--search', '')).search, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }

  const { server } = await startServer(w, { port: 0 });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const t = w.getTable('Task');
    const json = { 'Content-Type': 'application/json' };
    const set = await fetch(`${base}/api/tables/${t.id}/views/Standard`, { method: 'PATCH', headers: json, body: JSON.stringify({ search: 'cleanup' }) });
    assert.equal(set.status, 200);
    assert.equal((await set.json()).search, 'cleanup');
    const view = await (await fetch(`${base}/api/tables/${t.id}/views/Standard`)).json();
    assert.equal(view.search, 'cleanup', 'a GET of the view returns it');
    const q = await (await fetch(`${base}/api/tables/${t.id}/query`, { method: 'POST', headers: json, body: JSON.stringify({ search: view.search }) })).json();
    assert.deepEqual(q.items.map((e) => e.name), ['Gamma cleanup']);
    const cleared = await fetch(`${base}/api/tables/${t.id}/views/Standard`, { method: 'PATCH', headers: json, body: JSON.stringify({ search: '' }) });
    assert.equal((await cleared.json()).search, undefined);
  } finally { server.close(); }
});
