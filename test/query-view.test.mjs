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
import { tempDir } from './lib/temp.mjs';

const ROWS = [
  ['Alpha launch', 'Open', ['Web'], true, 3],
  ['Beta launch', 'Open', ['App'], false, 1],
  ['Gamma launch', 'Done', ['Web'], false, 2],
  ['Delta cleanup', 'Open', ['Web'], false, 5],
  ['Epsilon launch', 'Hold', ['Web'], false, 4],
];

function seed(w) {
  w.createSpace({ name: 'Dev' });
  const t = w.createTable({ space: 'Dev', name: 'Task' });
  w.addField(t.id, { name: 'Stage', type: 'select', config: { options: ['Open', 'Done', 'Hold'] } });
  w.addField(t.id, { name: 'Tags', type: 'multiselect', config: { options: ['Web', 'App'] } });
  w.addField(t.id, { name: 'Shipped', type: 'toggle', config: { on: 'Shipped', off: 'Pending' } });
  w.addField(t.id, { name: 'Points', type: 'number' });
  for (const [name, Stage, Tags, Shipped, Points] of ROWS) w.createEntity(t.id, { name, values: { Stage, Tags, Shipped, Points } });
  const v = w.tableView('Task/Triage', {
    from: 'Standard',
    filters: { Stage: ['Open', 'Hold'], Tags: ['Web'], Shipped: ['Pending'] },
    sort: [{ field: 'Points', dir: 'desc' }],
    search: 'launch',
  });
  return { w, t, v };
}

const VIEW_ROWS = ['Epsilon launch'];
const names = (r) => r.items.map((e) => e.name);

test('a view translates to where, sort and search the way the grid applies them', () => {
  const { w, v } = seed(new Weave());
  assert.deepEqual(w.viewQuery('Task', 'Triage'), {
    where: [['Stage', 'in', ['Open', 'Hold']], ['Tags', 'in', ['Web']], ['Shipped', 'in', [false]]],
    sort: [{ field: 'Points', dir: 'desc' }],
    search: 'launch',
  });
  assert.deepEqual(w.viewQuery('Task', v.id), w.viewQuery('Task', 'triage'), 'a view is named by id or by name, any case');
  assert.deepEqual(w.viewQuery('Task', 'Standard'), { where: [], sort: [], search: '' }, 'a view with nothing saved adds nothing');
  assert.throws(() => w.viewQuery('Task', 'Nope'), /View 'Nope' not found/);
});

test('query takes a view: its filters AND the caller where, the caller sort and search win', () => {
  const { w } = seed(new Weave());
  w.tableView('Task/Triage', { filters: { Stage: ['Open', 'Hold'] }, search: null });
  assert.deepEqual(names(w.query('Task', { view: 'Triage' })), ['Delta cleanup', 'Epsilon launch', 'Alpha launch', 'Beta launch'], 'filter and saved sort');
  assert.deepEqual(names(w.query('Task', { view: 'Triage', where: [['Points', '<', 4]] })), ['Alpha launch', 'Beta launch'], 'the caller where narrows the view');
  assert.deepEqual(names(w.query('Task', { view: 'Triage', sort: [{ field: 'Points', dir: 'asc' }] })), ['Beta launch', 'Alpha launch', 'Epsilon launch', 'Delta cleanup'], 'the caller sort replaces the view sort');
  w.tableView('Task/Triage', { search: 'cleanup' });
  assert.deepEqual(names(w.query('Task', { view: 'Triage' })), ['Delta cleanup'], 'the saved search applies');
  assert.deepEqual(names(w.query('Task', { view: 'Triage', search: 'alpha' })), ['Alpha launch'], 'the caller search replaces it');
  assert.throws(() => w.query('Task', { view: 'Nope' }), /View 'Nope' not found/);
});

test('weave_query takes a view and says so', async () => {
  const { w } = seed(new Weave());
  const tool = TOOLS.find((t) => t.name === 'weave_query');
  assert.ok(tool.inputSchema.properties.view, 'the tool takes view');
  assert.match(tool.inputSchema.properties.view.description, /id or name/);
  assert.deepEqual(names(await dispatchTool(w, 'weave_query', { db: 'Task', view: 'Triage' })), VIEW_ROWS);
});

test('the CLI query takes --view', () => {
  const dir = tempDir('weave-query-view-');
  try {
    const path = join(dir, 'w.db');
    const w = new Weave({ path });
    seed(w);
    w.close?.();
    const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
    const out = execFileSync(process.execPath, [cli, '--data', path, 'query', 'Task', '--view', 'Triage'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.deepEqual(names(JSON.parse(out)), VIEW_ROWS);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('POST /tables/:id/query takes a view', async () => {
  const { w, t, v } = seed(new Weave());
  const { server } = await startServer(w, { port: 0 });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (body) => fetch(`${base}/api/tables/${t.id}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.deepEqual(names(await (await post({ view: 'Triage' })).json()), VIEW_ROWS);
    assert.deepEqual(names(await (await post({ view: v.id })).json()), VIEW_ROWS);
    assert.equal((await post({ view: 'Nope' })).status, 404);
  } finally { server.close(); }
});
