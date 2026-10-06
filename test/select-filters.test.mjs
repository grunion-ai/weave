import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { TOOLS, dispatchTool } from '../src/mcp.js';
import { startServer } from '../src/server.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function bugs() {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  const t = w.createTable({ space: 'Dev', name: 'Bug' });
  w.addField(t, { name: 'Status', type: 'workflow', config: { states: [{ name: 'Open', category: 'not-started' }, { name: 'Fixed', category: 'done' }] } });
  w.addField(t, { name: 'Severity', type: 'select', config: { options: [{ name: 'Low' }, { name: 'Medium' }, { name: 'High' }] } });
  w.addField(t, { name: 'Symptom', type: 'multiselect', config: { options: [{ name: 'Slow' }, { name: 'Error' }, { name: 'Wrong data' }] } });
  const rows = [
    ['a', 'Open', 'High', ['Slow', 'Error']],
    ['b', 'Open', 'Low', ['Wrong data']],
    ['c', 'Fixed', 'High', ['Error']],
    ['d', 'Open', 'Medium', []],
    ['e', 'Open', null, ['Slow']],
  ];
  for (const [name, Status, Severity, Symptom] of rows) w.createEntity(t, { name, values: { Status, ...(Severity ? { Severity } : {}), Symptom } });
  const gone = w.createEntity(t, { name: 'gone', values: { Status: 'Open', Severity: 'High' } });
  w.deleteEntity(gone.id);
  return { w, t };
}
const names = (res) => res.items.map((e) => e.name).sort();

test('a view filters on single-select and multi-select options, by name, validated like states', () => {
  const { w } = bugs();
  const v = w.tableView('Bug/Standard', { filters: { Severity: ['High', 'Medium'], Symptom: ['Error'] } });
  assert.deepEqual(v.filters, { Severity: ['High', 'Medium'], Symptom: ['Error'] });
  assert.throws(() => w.tableView('Bug/Standard', { filters: { Severity: ['Urgent'] } }), /'Urgent' is not an option of Bug\.Severity/);
  assert.deepEqual(w.tableView('Bug/Standard').filters, { Severity: ['High', 'Medium'], Symptom: ['Error'] }, 'a refused write leaves the view');
  w.addField('Bug', { name: 'Notes', type: 'text' });
  assert.throws(() => w.tableView('Bug/Standard', { filters: { Notes: ['x'] } }), /not a workflow, toggle, single-select or multi-select field/);
});

test('options in one field widen the match, fields narrow it, and a multi-select row matches on any chosen option', () => {
  const { w, t } = bugs();
  assert.deepEqual(names(w.query(t.id, { where: [['Severity', 'in', ['High']]] })), ['a', 'c']);
  assert.deepEqual(names(w.query(t.id, { where: [['Severity', 'in', ['High', 'Low']]] })), ['a', 'b', 'c'], 'OR within a field');
  assert.deepEqual(names(w.query(t.id, { where: [['Symptom', 'in', ['Error', 'Wrong data']]] })), ['a', 'b', 'c'], 'any chosen option');
  assert.deepEqual(names(w.query(t.id, { where: [['Severity', 'in', ['High']], ['Symptom', 'in', ['Slow']], ['Status', 'in', ['Open']]] })), ['a'], 'AND across fields');
  assert.deepEqual(names(w.query(t.id, { where: [['Symptom', 'in', ['Slow']]] })), ['a', 'e']);
});

test('countAll answers the undeleted table, before where and search', async () => {
  const { w, t } = bugs();
  const res = w.query(t.id, { where: [['Severity', 'in', ['High']]], search: 'a', countAll: true });
  assert.equal(res.total, 1, 'the filtered, searched count');
  assert.equal(res.all, 5, 'N: every undeleted row');
  assert.equal(w.query(t.id, {}).all, undefined, 'only when asked');
  const tool = TOOLS.find((x) => x.name === 'weave_query');
  assert.equal(tool.inputSchema.properties.countAll.type, 'boolean');
  assert.equal(dispatchTool(w, 'weave_query', { db: 'Bug', where: [['Status', 'in', ['Fixed']]], countAll: true }).all, 5);
  const { server } = await startServer(w, { port: 0 });
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/tables/${t.id}/query`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ where: [['Symptom', 'in', ['Slow']]], countAll: true, limit: 1 }),
    });
    const body = await r.json();
    assert.equal(body.total, 2);
    assert.equal(body.all, 5);
  } finally { server.close(); }
  const dir = mkdtempSync(join(tmpdir(), 'weave-count-all-'));
  try {
    const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
    const run = (...args) => JSON.parse(execFileSync(process.execPath, [cli, '--data', join(dir, 'w.db'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    run('space', 'create', 'Dev');
    run('table', 'create', 'Dev', 'Bug');
    run('create', 'Bug', 'one');
    run('create', 'Bug', 'two');
    assert.equal(run('query', 'Bug', '--search', 'one', '--count-all').all, 2, 'the CLI asks with --count-all');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the Workspace/Views row speaks select filters in its Filter text', () => {
  const { w } = bugs();
  w.tableView('Bug/Standard', { filters: { Severity: ['High'], Symptom: ['Slow', 'Error'] } });
  const t = w.getTable('Views');
  const row = w.listEntities(t.id).map((e) => w.readEntity(e.id)).find((r) => r.name === 'Standard' && (r.fields.Table?.[0]?.name ?? r.fields.Table?.name) === 'Bug');
  assert.match(row.fields.Filter, /Severity/);
  w.updateEntity(row.id, { Filter: 'Symptom: Wrong data' });
  assert.deepEqual(w.tableView('Bug/Standard').filters, { Symptom: ['Wrong data'] });
});
