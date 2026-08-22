import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

function buildWorkspace() {
  const w = new Weave();
  w.createSpace({ name: 'Product' });
  const projects = w.createTable({ space: 'Product', name: 'Project' });
  const tasks = w.createTable({ space: 'Product', name: 'Task' });
  w.addField(tasks, { name: 'Estimate', type: 'number' });
  w.addField(tasks, {
    name: 'State', type: 'workflow', config: {
      states: [
        { name: 'Open', category: 'not-started', default: true },
        { name: 'Done', category: 'done' },
      ],
    },
  });
  w.addRelation(tasks, { name: 'Project', targetDb: projects, cardinality: 'many-to-one', inverseName: 'Tasks' });
  return { w, projects, tasks };
}

test('undo restores a field update', () => {
  const { w } = buildWorkspace();
  const e = w.createEntity('Task', { name: 'A', values: { Estimate: 3 } });
  w.updateEntity(e.id, { Estimate: 8 });
  const { undone } = w.undo();
  assert.equal(undone.length, 1);
  assert.equal(undone[0].kind, 'update');
  assert.equal(w.readEntity(e.id).fields.Estimate, 3);
  // the reversal is itself on the record
  const kinds = w.getEntity(e.id).activity.map((a) => a.kind);
  assert.ok(kinds.includes('undo'));
});

test('undo restores a workflow state change', () => {
  const { w } = buildWorkspace();
  const e = w.createEntity('Task', { name: 'A' });
  w.setState(e.id, 'State', 'Done');
  w.undo();
  assert.equal(w.readEntity(e.id).fields.State, 'Open');
});

test('undo restores a document edit, both setDoc and appendDoc', () => {
  const { w } = buildWorkspace();
  const e = w.createEntity('Task', { name: 'A', doc: 'first' });
  w.setDoc(e.id, 'second');
  w.undo();
  assert.equal(w.getDoc(e.id), 'first');
  w.appendDoc(e.id, 'more');
  assert.match(w.getDoc(e.id), /more/);
  w.undo();
  assert.equal(w.getDoc(e.id), 'first');
});

test('undo of a link keeps both relation sides consistent', () => {
  const { w } = buildWorkspace();
  const p = w.createEntity('Project', { name: 'P' });
  const e = w.createEntity('Task', { name: 'A' });
  w.link(e.id, 'Project', p.id);
  assert.equal(w.readEntity(e.id).fields.Project.id, p.id);
  w.undo();
  assert.equal(w.readEntity(e.id).fields.Project, null);
  assert.equal(w.readEntity(p.id).fields.Tasks.length, 0);
});

test('undo of a create soft-deletes; undo of a delete restores; undo of a restore re-deletes', () => {
  const { w } = buildWorkspace();
  const e = w.createEntity('Task', { name: 'A' });
  w.undo();
  assert.ok(w.getEntity(e.id).deletedAt, 'create undone = trashed, recoverable');
  w.restoreEntity(e.id);
  w.undo();
  assert.ok(w.getEntity(e.id).deletedAt, 'restore undone = trashed again');
  w.restoreEntity(e.id);
  w.deleteEntity(e.id);
  w.undo();
  assert.equal(w.getEntity(e.id).deletedAt, null, 'delete undone = restored');
});

test('undo removes an added comment and restores a deleted one', () => {
  const { w } = buildWorkspace();
  const e = w.createEntity('Task', { name: 'A' });
  const c = w.addComment(e.id, { author: 'k', text: 'note' });
  w.undo();
  assert.equal(w.getEntity(e.id).comments.length, 0);
  const c2 = w.addComment(e.id, { author: 'k', text: 'kept' });
  w.deleteComment(e.id, c2.id);
  w.undo();
  assert.equal(w.getEntity(e.id).comments[0].text, 'kept');
});

test('multi-step undo walks back newest-first', () => {
  const { w } = buildWorkspace();
  const e = w.createEntity('Task', { name: 'A', values: { Estimate: 1 } });
  w.updateEntity(e.id, { Estimate: 2 });
  w.updateEntity(e.id, { Estimate: 3 });
  w.setState(e.id, 'State', 'Done');
  const { undone } = w.undo({ steps: 3 });
  assert.equal(undone.length, 3);
  const r = w.readEntity(e.id);
  assert.equal(r.fields.State, 'Open');
  assert.equal(r.fields.Estimate, 1);
});

test('undo steps back automation effects and fires no automations itself', () => {
  const { w } = buildWorkspace();
  w.createAutomation('Task', {
    name: 'escalate',
    trigger: { type: 'field-updated', field: 'Estimate' },
    actions: [{ type: 'set-field', field: 'State', value: 'Done' }],
  });
  const e = w.createEntity('Task', { name: 'A' });
  w.updateEntity(e.id, { Estimate: 9 });
  assert.equal(w.readEntity(e.id).fields.State, 'Done', 'automation fired on the forward edit');
  const { undone } = w.undo({ steps: 2 }); // the user's edit, then the automation's effect
  assert.equal(undone.length, 2);
  const r = w.readEntity(e.id);
  assert.equal(r.fields.Estimate, null);
  assert.equal(r.fields.State, 'Open', 'state restored — and restoring Estimate did not re-trigger the automation');
});

test('no-op mutations record nothing', () => {
  const { w } = buildWorkspace();
  const e = w.createEntity('Task', { name: 'A', values: { Estimate: 5 } });
  w.updateEntity(e.id, { Estimate: 5 });
  w.setDoc(e.id, '');
  const { undone } = w.undo();
  assert.equal(undone[0].kind, 'create', 'the create is the newest real entry');
});

test('structural operations are not undoable and do not pollute the stack', () => {
  const { w } = buildWorkspace();
  const e = w.createEntity('Task', { name: 'A' });
  w.createSpace({ name: 'Annex' });
  w.createTable({ space: 'Annex', name: 'Note' });
  const { undone } = w.undo();
  assert.equal(undone[0].kind, 'create');
  assert.equal(undone[0].entity.split('#')[0], 'Product/Task', 'undo skipped the structural ops, popped the entity create');
  assert.ok(w.findSpace('Annex'), 'space untouched');
});

test('hard delete is not undoable; dangling entries are skipped, not fatal', () => {
  const { w } = buildWorkspace();
  const e = w.createEntity('Task', { name: 'A' });
  w.updateEntity(e.id, { Estimate: 4 });
  w.deleteEntity(e.id, { hard: true });
  const { undone } = w.undo({ steps: 2 });
  assert.ok(undone.every((u) => u.skipped), 'entries for a purged entity report skipped');
});

test('undo on an empty log returns cleanly', () => {
  const w = new Weave();
  const { undone } = w.undo();
  assert.deepEqual(undone, []);
});

test('listUndo shows history newest-first without payloads', () => {
  const { w } = buildWorkspace();
  const e = w.createEntity('Task', { name: 'A' });
  w.updateEntity(e.id, { Estimate: 2 });
  const list = w.listUndo();
  assert.equal(list[0].kind, 'update');
  assert.equal(list[1].kind, 'create');
  assert.equal(list[0].data, undefined, 'history is a summary, not a payload dump');
});

test('the stack is bounded', () => {
  const { w } = buildWorkspace();
  const e = w.createEntity('Task', { name: 'A' });
  for (let i = 0; i < 230; i++) w.updateEntity(e.id, { Estimate: i });
  assert.ok(w.listUndo({ limit: 1000 }).length <= 200);
});

test('undo history survives a reopen (sqlite)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-undo-'));
  const path = join(dir, 'w.db');
  try {
    const w1 = new Weave({ path });
    w1.createSpace({ name: 'S' });
    w1.createTable({ space: 'S', name: 'T' });
    w1.addField('T', { name: 'N', type: 'number' });
    const e = w1.createEntity('T', { name: 'row', values: { N: 1 } });
    w1.updateEntity(e.id, { N: 2 });
    w1.store.close();
    const w2 = new Weave({ path });
    w2.undo();
    assert.equal(w2.readEntity(e.id).fields.N, 1);
    w2.store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('REST: POST /api/undo reverts, GET /api/undo lists, reader tokens are refused', async () => {
  const weave = new Weave();
  weave.createSpace({ name: 'S' });
  weave.createTable({ space: 'S', name: 'T' });
  weave.addField('T', { name: 'N', type: 'number' });
  const { server } = await startServer(weave, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, path, body, token) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  try {
    const made = await api('POST', '/api/tables/T/entities', { name: 'row', values: { N: 1 } });
    assert.equal(made.status, 201);
    await api('PATCH', `/api/entities/${made.data.id}`, { values: { N: 9 } });
    const hist = await api('GET', '/api/undo');
    assert.equal(hist.status, 200);
    assert.equal(hist.data[0].kind, 'update');
    const { token: admin } = (await api('POST', '/api/accounts', { name: 'boss', role: 'admin' })).data;
    const { token: reader } = (await api('POST', '/api/accounts', { name: 'ro', role: 'reader' }, admin)).data;
    const denied = await api('POST', '/api/undo', { steps: 1 }, reader);
    assert.equal(denied.status, 403, 'undo is a write');
    const ok = await api('POST', '/api/undo', { steps: 1 }, admin);
    assert.equal(ok.status, 200);
    assert.equal(ok.data.undone.length, 1);
    const read = await api('GET', `/api/entities/${made.data.id}`);
    assert.equal(read.data.fields.N, 1);
  } finally {
    server.close();
  }
});
