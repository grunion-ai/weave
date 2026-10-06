import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { dispatchTool } from '../src/mcp.js';

function seeded() {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  const jobs = w.createTable({ space: 'Ops', name: 'Job' });
  w.addField(jobs, { name: 'Notes', type: 'text' });
  w.addField(jobs, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'Done', category: 'done' }] } });
  const other = w.createTable({ space: 'Ops', name: 'Vendor' });
  const rows = {};
  for (const [name, Notes, Status] of [
    ['Alpha launch', 'kickoff call', 'Open'],
    ['Beta launch', 'needs the quarterly plan', 'Done'],
    ['Gamma cleanup', '', 'Open'],
    ['Delta alpha review', 'quarterly', 'Open'],
  ]) rows[name] = w.createEntity(jobs, { name, values: { Notes, Status } });
  w.createEntity(other, { name: 'Alpha supplies' });
  return { w, jobs, other, rows };
}

const names = (res) => res.items.map((e) => e.name).sort();

test('search(text, { table }) is the palette scorer, scoped to one table', () => {
  const { w, jobs, other } = seeded();
  const everywhere = w.search('alpha').map((h) => h.name).sort();
  assert.deepEqual(everywhere, ['Alpha launch', 'Alpha supplies', 'Delta alpha review'], 'unscoped: the palette sees every table');
  const scoped = w.search('alpha', { table: jobs.id }).map((h) => h.name).sort();
  assert.deepEqual(scoped, ['Alpha launch', 'Delta alpha review'], 'scoped: only this table');
  assert.deepEqual(w.search('alpha', { table: other.name }).map((h) => h.name), ['Alpha supplies'], 'a table name scopes too');
});

test('text fields match, in the palette and in the table search alike', () => {
  const { w, jobs } = seeded();
  assert.deepEqual(w.search('quarterly').map((h) => h.name).sort(), ['Beta launch', 'Delta alpha review']);
  const hit = w.search('kickoff')[0];
  assert.equal(hit.name, 'Alpha launch');
  assert.match(hit.snippet, /kickoff call/, 'the snippet shows the matched text');
  assert.deepEqual(names(w.query(jobs, { search: 'quarterly' })), ['Beta launch', 'Delta alpha review']);
});

test('query({ search }) narrows the table, composes with where and sort, and totals the matches', () => {
  const { w, jobs } = seeded();
  const res = w.query(jobs, { search: 'launch' });
  assert.equal(res.total, 2);
  assert.deepEqual(names(res), ['Alpha launch', 'Beta launch']);
  const filtered = w.query(jobs, { search: 'launch', where: [['Status', 'in', ['Open']]] });
  assert.deepEqual(names(filtered), ['Alpha launch'], 'search narrows whatever the filter shows');
  const sorted = w.query(jobs, { search: 'a', sort: [{ field: 'Name', dir: 'desc' }], limit: 2, offset: 0 });
  assert.deepEqual(sorted.items.map((e) => e.name), ['Gamma cleanup', 'Delta alpha review'], 'the table sort still orders the matches');
  assert.equal(sorted.total, 4, 'total counts every match, not the page');
});

test('a publicId finds its row: #N and a bare N', () => {
  const { w, jobs, rows } = seeded();
  const pid = rows['Gamma cleanup'].publicId;
  assert.deepEqual(names(w.query(jobs, { search: `#${pid}` })), ['Gamma cleanup']);
  assert.ok(w.query(jobs, { search: String(pid) }).items.some((e) => e.name === 'Gamma cleanup'));
});

test('an empty search is no search, and a miss is an empty page', () => {
  const { w, jobs } = seeded();
  assert.equal(w.query(jobs, { search: '   ' }).total, 4);
  assert.equal(w.query(jobs, { search: '' }).total, 4);
  const none = w.query(jobs, { search: 'zzzz' });
  assert.equal(none.total, 0);
  assert.deepEqual(none.items, []);
});

test('the trash stays out, and the search never writes the saved filter', () => {
  const { w, jobs, rows } = seeded();
  w.deleteEntity(rows['Alpha launch'].id);
  assert.deepEqual(names(w.query(jobs, { search: 'alpha' })), ['Delta alpha review']);
  assert.deepEqual(w.getTable(jobs).filters ?? {}, {}, 'no filter was saved');
});

test('route and MCP parity: POST /tables/:id/query and weave_query take search', async () => {
  const { w, jobs } = seeded();
  const { server } = await startServer(w, { port: 0 });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${base}/api/tables/${jobs.id}/query`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ search: 'launch', limit: 200, offset: 0 }),
    }).then((r) => r.json());
    assert.equal(res.total, 2);
    assert.deepEqual(names(res), ['Alpha launch', 'Beta launch']);
  } finally { server.close(); }
  const viaMcp = dispatchTool(w, 'weave_query', { db: 'Job', search: 'cleanup' });
  assert.deepEqual(names(viaMcp), ['Gamma cleanup']);
});
