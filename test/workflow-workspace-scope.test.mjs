import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer, createWorkspaceHub } from '../src/server.js';

const rule = { trigger: { type: 'entity-created' }, actions: [{ type: 'add-comment', text: 'seen' }] };
const json = async (r) => r.json();
const post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

function member(name, table) {
  const w = new Weave({ name });
  w.createSpace({ name: 'Work' });
  w.createTable({ space: 'Work', name: table });
  return w;
}

function hub() {
  const root = new Weave({ name: 'root' });
  root.createSpace({ name: 'Ops' });
  root.createTable({ space: 'Ops', name: 'Ticket' });
  const a = member('alpha', 'Lead');
  const b = member('beta', 'Bug');
  createWorkspaceHub(root, { workspaces: { alpha: a, beta: b } });
  root.createAutomation('Ops/Ticket', { name: 'root rule', ...rule });
  a.createAutomation('Work/Lead', { name: 'alpha rule', ...rule });
  b.createAutomation('Work/Bug', { name: 'beta rule', ...rule });
  return { root, a, b };
}

const names = (res) => res.items.map((i) => i.name).sort();

test('each workspace lists and counts only its local workflows', () => {
  const { root, a, b } = hub();
  const workflowTable = w => w.getTable('System/Workflows').id;
  assert.deepEqual(names(a.query(workflowTable(a))), ['alpha rule']);
  assert.deepEqual(names(b.query(workflowTable(b))), ['beta rule']);
  assert.deepEqual(names(root.query(workflowTable(root))), ['root rule']);
  assert.deepEqual(names(a.query(workflowTable(a), { workspace: b.state.meta.id })), []);
  const counted = a.query(workflowTable(a), { countAll: true, trashCount: true });
  assert.equal(counted.all, 1);
  assert.equal(counted.trashCount, 0);
  assert.deepEqual(a.listTrash(workflowTable(a)), []);
});

test('a local workflow without an explicit workspace belongs to the workspace running its rule', () => {
  const { root, a, b } = hub();
  const wf = a.getTable('System/Workflows');
  const stray = a.createEntity(wf.id, { values: { Name: 'old alpha rule' }, docs: { Script: JSON.stringify({ table: 'Work/Lead', ...rule }) } });
  a.save();
  assert.equal(a.workflowWorkspace(stray.id), a.state.meta.id);
  assert.equal(root.workflowWorkspace(stray.id), undefined);
  assert.deepEqual(names(a.query(wf.id)), ['alpha rule', 'old alpha rule']);
  const blank = root.createEntity(root.getTable('System/Workflows').id, { Name: 'draft' });
  root.save();
  assert.equal(root.workflowWorkspace(blank.id), root.state.meta.id);
  assert.deepEqual(names(b.query(b.getTable('System/Workflows').id)), ['beta rule']);
  assert.equal(root.workflowWorkspace(root.getTable('System/Tables').id), undefined);
});

test('member routes use local workflow tables and reject foreign tokens and workflow IDs', async () => {
  const { root, a, b } = hub();
  const headers = new Map([root, a, b].map(w => {
    const { token } = w.createAccount({ name: `${w.state.meta.name}-owner`, role: 'architect' });
    w.setRequireAuth(true);
    return [w, { Authorization: `Bearer ${token}` }];
  }));
  const { server } = await startServer(root, { port: 0, workspaces: { alpha: a, beta: b } });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const wf = a.getTable('System/Workflows');
    const rootWf = root.getTable('System/Workflows');
    const betaWf = b.getTable('System/Workflows');
    const betaRule = b.listEntities(betaWf.id).find(e => b.entityName(e) === 'beta rule');
    const alphaList = await json(await post(`${base}/w/alpha/api/tables/${wf.id}/query`, { workspace: b.state.meta.id }, headers.get(a)));
    assert.deepEqual(names(alphaList), ['alpha rule'], 'a body workspace key cannot widen the list');
    const byName = await json(await post(`${base}/w/beta/api/tables/Workflows/query`, {}, headers.get(b)));
    assert.deepEqual(names(byName), ['beta rule']);
    const listed = await json(await fetch(`${base}/w/alpha/api/tables/${wf.id}/entities`, { headers: headers.get(a) }));
    assert.deepEqual(names(listed), ['alpha rule']);
    const rootList = await json(await post(`${base}/api/tables/${rootWf.id}/query`, {}, headers.get(root)));
    assert.deepEqual(names(rootList), ['root rule']);
    assert.equal((await post(`${base}/w/alpha/api/tables/${rootWf.id}/query`, {}, headers.get(a))).status, 404);
    assert.equal((await post(`${base}/w/alpha/api/tables/${wf.id}/query`, {}, headers.get(root))).status, 401);
    assert.equal((await fetch(`${base}/w/alpha/api/entities/${betaRule.id}`, { headers: headers.get(a) })).status, 404);
    assert.equal((await fetch(`${base}/w/beta/api/entities/${betaRule.id}`, { headers: headers.get(b) })).status, 200);
    const made = await json(await post(`${base}/w/alpha/api/tables/${wf.id}/entities`, { name: 'new alpha rule' }, headers.get(a)));
    assert.equal(a.workflowWorkspace(made.id), a.state.meta.id);
    assert.equal(root.workflowWorkspace(made.id), undefined);
    assert.deepEqual(names(await json(await post(`${base}/w/alpha/api/tables/${wf.id}/query`, {}, headers.get(a)))), ['alpha rule', 'new alpha rule']);
    assert.deepEqual(names(await json(await post(`${base}/w/beta/api/tables/${betaWf.id}/query`, {}, headers.get(b)))), ['beta rule']);
    const trash = await json(await fetch(`${base}/w/alpha/api/tables/${wf.id}/trash`, { headers: headers.get(a) }));
    assert.equal(trash.total, 0);
  } finally {
    server.close();
  }
});
