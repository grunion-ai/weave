import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tempDir } from './lib/temp.mjs';
process.env.WEAVE_KEYSTORE = join(tempDir('weave-ks-'), 'keystore.json');
const { Weave } = await import('../src/engine.js');
const { createWorkspaceHub } = await import('../src/server.js');
const { client } = await import('./lib/fixtures.mjs');

function demo() {
  const w = new Weave({ actor: 'kyle' });
  w.updateWorkspace({ name: 'ws', description: 'Everything we run' });
  const sales = w.createSpace({ name: 'Sales', icon: 'lucide:briefcase' });
  const ops = w.createSpace({ name: 'Ops' });
  const deal = w.createTable({ space: 'Sales', name: 'Deal', icon: 'lucide:users' });
  const contact = w.createTable({ space: 'Sales', name: 'Contact' });
  const task = w.createTable({ space: 'Ops', name: 'Task' });
  w.addField(task.id, { name: 'Note', type: 'text' });
  return { w, sales, ops, deal, contact, task };
}

test('the workspace home lists every user space with its tables and live counts, never the system space', () => {
  const { w, sales, ops, deal, contact, task } = demo();
  w.createEntity(deal.id, { Name: 'One' });
  const gone = w.createEntity(deal.id, { Name: 'Two' });
  w.deleteEntity(gone.id);
  w.createEntity(task.id, { Name: 'Task one' });
  const home = w.workspaceHome();
  assert.deepEqual(home.workspace, { name: 'ws', description: 'Everything we run' });
  assert.deepEqual(home.spaces.map((sp) => [sp.id, sp.name, sp.icon]), [[sales.id, 'Sales', 'lucide:briefcase'], [ops.id, 'Ops', null]]);
  assert.deepEqual(home.spaces[0].tables.map((t) => [t.id, t.name, t.rowCount]), [[deal.id, 'Deal', 1], [contact.id, 'Contact', 0]]);
  assert.deepEqual(home.spaces[1].tables.map((t) => [t.id, t.rowCount]), [[task.id, 1]]);
  assert.deepEqual(home.spaces[0].tables[0].views.map((v) => v.layout), ['table']);
});

test('the workspace home carries runs from every space, newest first', () => {
  const { w, deal, task } = demo();
  w.createAutomation(task.id, { name: 'Stamp task', trigger: { type: 'entity-created' }, actions: [{ type: 'set-field', field: 'Note', value: 'x' }] });
  w.createAutomation(deal.id, { name: 'Greet deal', trigger: { type: 'entity-created' }, actions: [{ type: 'add-comment', text: 'Hi' }] });
  w.createEntity(task.id, { Name: 'T' });
  w.createEntity(deal.id, { Name: 'D' });
  const { runs } = w.workspaceHome();
  assert.deepEqual(runs.map((r) => [r.name, r.originSpace]), [['Greet deal', 'Sales'], ['Stamp task', 'Ops']]);
  assert.deepEqual(runs[1].changedTables, [{ table: 'Task', count: 1 }]);
});

function guarded() {
  const d = demo();
  const { w, task } = d;
  w.createAutomation(task.id, { name: 'Hidden origin', trigger: { type: 'entity-created' }, actions: [{ type: 'set-field', field: 'Note', value: 'x' }] });
  w.createEntity(task.id, { Name: 'Quiet task' });
  const t = {
    arc: w.createAccount({ name: 'arc', role: 'architect' }).token,
    obs: w.createAccount({ name: 'obs', role: 'observer' }).token,
  };
  w.updateSpace('Ops', { access: 'private' });
  w.setRequireAuth(true);
  return { ...d, t, call: client(createWorkspaceHub(w)) };
}

test('GET /api/workspace/home hides a private space, its tables and its runs from a reader outside it', async () => {
  const { call, t } = guarded();
  const arc = await call('GET', '/api/workspace/home', { token: t.arc });
  assert.equal(arc.status, 200, JSON.stringify(arc.json));
  assert.deepEqual(arc.json.spaces.map((sp) => sp.name), ['Sales', 'Ops']);
  assert.deepEqual(arc.json.runs.map((r) => r.name), ['Hidden origin']);
  const obs = await call('GET', '/api/workspace/home', { token: t.obs });
  assert.equal(obs.status, 200);
  assert.deepEqual(obs.json.spaces.map((sp) => sp.name), ['Sales']);
  const text = JSON.stringify(obs.json);
  assert.ok(!text.includes('Hidden origin') && !text.includes('Ops') && !text.includes('Quiet task'), text);
});

test('a share link reaches no workspace home, and the route only reads', async () => {
  const { w, call, sales, t } = guarded();
  for (const scope of [{ kind: 'workspace' }, { kind: 'space', id: sales.id }]) {
    const { token } = w.mintShare({ scope, mode: 'read' });
    const res = await call('GET', '/api/workspace/home', { token });
    assert.equal(res.status, 403, `${scope.kind} share`);
  }
  assert.notEqual((await call('POST', '/api/workspace/home', { token: t.arc, body: {} })).status, 200);
});
