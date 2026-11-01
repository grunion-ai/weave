import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const rule = { trigger: { type: 'entity-created' }, actions: [{ type: 'add-comment', text: 'seen' }] };
const json = async (r) => r.json();
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function member(name, table) {
  const w = new Weave();
  w.updateWorkspace({ name });
  w.createSpace({ name: 'Work' });
  w.createTable({ space: 'Work', name: table });
  return w;
}

function hub() {
  const root = new Weave();
  root.updateWorkspace({ name: 'root' });
  root.createSpace({ name: 'Ops' });
  root.createTable({ space: 'Ops', name: 'Ticket' });
  const a = member('alpha', 'Lead');
  const b = member('beta', 'Bug');
  a.joinRegistry(root);
  b.joinRegistry(root);
  root.createAutomation('Ops/Ticket', { name: 'root rule', ...rule });
  a.createAutomation('Work/Lead', { name: 'alpha rule', ...rule });
  b.createAutomation('Work/Bug', { name: 'beta rule', ...rule });
  return { root, a, b, wf: root.getTable('System/Workflows') };
}

const names = (res) => res.items.map((i) => i.name).sort();

test('each workspace of one hub lists only its own workflows (Issue #875)', () => {
  const { root, a, b, wf } = hub();
  assert.deepEqual(names(root.query(wf.id, { workspace: a.state.meta.id })), ['alpha rule']);
  assert.deepEqual(names(root.query(wf.id, { workspace: b.state.meta.id })), ['beta rule']);
  assert.deepEqual(names(root.query(wf.id)), ['root rule'], 'the root, as the hub registry host, lists its own workflows only');
  const counted = root.query(wf.id, { workspace: a.state.meta.id, countAll: true, trashCount: true });
  assert.equal(counted.all, 1);
  assert.equal(counted.trashCount, 0);
  assert.deepEqual(root.listTrash(wf.id, { workspace: a.state.meta.id }), []);
});

test('a workflow belongs to the workspace its rule runs in, and old rows without a key get one (Issue #875)', () => {
  const { root, a, b, wf } = hub();
  const stray = root.createEntity(wf.id, { values: { Name: 'old alpha rule' }, docs: { Script: JSON.stringify({ table: 'Work/Lead', ...rule }) } });
  root.save();
  assert.equal(root.workflowWorkspace(stray.id), a.state.meta.id, 'a row naming a member table belongs to that member');
  assert.deepEqual(names(root.query(wf.id, { workspace: a.state.meta.id })), ['alpha rule', 'old alpha rule']);
  const blank = root.createEntity(wf.id, { Name: 'draft' });
  root.save();
  assert.equal(root.workflowWorkspace(blank.id), root.state.meta.id, 'a row with no rule and no key stays with the root');
  assert.ok(!names(root.query(wf.id, { workspace: b.state.meta.id })).includes('draft'));
  assert.equal(root.workflowWorkspace(root.getTable('System/Tables').id), undefined, 'only workflow rows answer');
});

test('a member route lists, creates and reads only its own workflows (Issue #875)', async () => {
  const root = new Weave();
  root.updateWorkspace({ name: 'root' });
  root.createSpace({ name: 'Ops' });
  root.createTable({ space: 'Ops', name: 'Ticket' });
  const a = member('alpha', 'Lead');
  const b = member('beta', 'Bug');
  const { server } = await startServer(root, { port: 0, workspaces: { alpha: a, beta: b } });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const wf = root.getTable('System/Workflows');
    root.createAutomation('Ops/Ticket', { name: 'root rule', ...rule });
    a.createAutomation('Work/Lead', { name: 'alpha rule', ...rule });
    const betaRule = b.createAutomation('Work/Bug', { name: 'beta rule', ...rule });
    const alphaList = await json(await post(`${base}/w/alpha/api/tables/${wf.id}/query`, { workspace: b.state.meta.id }));
    assert.deepEqual(names(alphaList), ['alpha rule'], 'a workspace key in the body cannot widen the list');
    const byName = await json(await post(`${base}/w/beta/api/tables/Workflows/query`, {}));
    assert.deepEqual(names(byName), ['beta rule']);
    const listed = await json(await fetch(`${base}/w/alpha/api/tables/${wf.id}/entities`));
    assert.deepEqual(names(listed), ['alpha rule']);
    const rootList = await json(await post(`${base}/api/tables/${wf.id}/query`, {}));
    assert.deepEqual(names(rootList), ['root rule'], 'the root table by hand-typed URL shows no member rows');
    assert.equal((await fetch(`${base}/w/alpha/api/entities/${betaRule.id}`)).status, 404, 'another workspace\'s workflow is not reachable by id');
    assert.equal((await fetch(`${base}/w/beta/api/entities/${betaRule.id}`)).status, 200);
    const made = await json(await post(`${base}/w/alpha/api/tables/${wf.id}/entities`, { name: 'new alpha rule' }));
    assert.equal(root.workflowWorkspace(made.id), a.state.meta.id, 'a row made in a member belongs to it');
    assert.deepEqual(names(await json(await post(`${base}/w/alpha/api/tables/${wf.id}/query`, {}))), ['alpha rule', 'new alpha rule']);
    assert.deepEqual(names(await json(await post(`${base}/w/beta/api/tables/${wf.id}/query`, {}))), ['beta rule']);
    const trash = await json(await fetch(`${base}/w/alpha/api/tables/${wf.id}/trash`));
    assert.equal(trash.total, 0);
  } finally {
    server.close();
  }
});
