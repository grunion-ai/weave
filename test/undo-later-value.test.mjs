import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { dispatchTool } from '../src/mcp.js';

function seed() {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  const t = w.createTable({ space: 'S', name: 'Task' });
  w.addField(t.id, { name: 'Estimate', type: 'number' });
  const row = w.createEntity(t.id, { Name: 'launch', Estimate: 3 });
  w.setDoc(row.id, 'Plan v0');
  return { w, t, row };
}

const value = (w, id, name) => w.readEntity(id).fields[name];

test('undo leaves a field another actor wrote after it, and names who kept it', () => {
  const { w, row } = seed();
  w.actor = 'ann';
  w.updateEntity(row.id, { Estimate: 5 });
  w.actor = 'bob';
  w.updateEntity(row.id, { Estimate: 8 });
  w.actor = 'ann';
  const { undone } = w.undo({ steps: 1 });
  assert.equal(value(w, row.id, 'Estimate'), 8, "bob's newer value stands");
  assert.equal(undone.length, 1);
  assert.equal(undone[0].skipped, 'changed since');
  assert.deepEqual(undone[0].kept, [{ field: 'Estimate', by: 'bob' }]);
});

test('undo still restores a field nobody touched since', () => {
  const { w, row } = seed();
  w.actor = 'ann';
  w.updateEntity(row.id, { Estimate: 5 });
  const { undone } = w.undo({ steps: 1 });
  assert.equal(value(w, row.id, 'Estimate'), 3);
  assert.equal(undone[0].skipped, undefined);
  assert.equal(undone[0].kept, undefined);
});

test('a document another actor appended to survives the undo', () => {
  const { w, row } = seed();
  w.actor = 'ann';
  w.setDoc(row.id, 'Plan v1 by ann');
  w.actor = 'bob';
  w.appendDoc(row.id, 'Risk section by bob');
  w.actor = 'ann';
  const { undone } = w.undo({ steps: 1 });
  const doc = w.getDoc(row.id);
  assert.match(doc, /Risk section by bob/);
  assert.equal(undone[0].skipped, 'changed since');
  assert.deepEqual(undone[0].kept?.map((k) => k.field), ['Description']);
});

test('a step with one kept field and one free field restores only the free one', () => {
  const { w, t, row } = seed();
  w.addField(t.id, { name: 'Owner', type: 'text' });
  w.actor = 'ann';
  w.updateEntity(row.id, { Estimate: 5, Owner: 'ann' });
  w.actor = 'bob';
  w.updateEntity(row.id, { Estimate: 8 });
  w.actor = 'ann';
  const { undone } = w.undo({ steps: 1 });
  assert.equal(value(w, row.id, 'Estimate'), 8, 'kept');
  assert.equal(value(w, row.id, 'Owner') ?? null, null, 'restored');
  assert.equal(undone[0].skipped, undefined, 'the step did something, so it is not skipped');
  assert.deepEqual(undone[0].kept, [{ field: 'Estimate', by: 'bob' }]);
});

test('an undo entry recorded before this change, with no after-image, restores as it always did', () => {
  const { w, row } = seed();
  w.actor = 'ann';
  w.updateEntity(row.id, { Estimate: 5 });
  w.actor = 'bob';
  w.updateEntity(row.id, { Estimate: 8 });
  const legacy = w.store.listUndo({ limit: 10, actor: 'ann' })[0];
  assert.ok(legacy, 'ann has an entry');
  assert.ok(legacy.data.after, 'the entry carries an after-image');
  delete legacy.data.after;
  w.actor = 'ann';
  w.undo({ steps: 1 });
  assert.equal(value(w, row.id, 'Estimate'), 3, 'an entry with no after-image keeps the old behaviour');
});

test('a relation relinked by another actor is kept', () => {
  const { w, t, row } = seed();
  w.createTable({ space: 'S', name: 'Person' });
  w.createEntity('Person', { Name: 'pat' });
  w.createEntity('Person', { Name: 'sam' });
  w.addRelation(t.id, { name: 'Owner', targetDb: 'Person' });
  w.actor = 'ann';
  w.updateEntity(row.id, { Owner: 'pat' });
  w.actor = 'bob';
  w.updateEntity(row.id, { Owner: 'sam' });
  w.actor = 'ann';
  const { undone } = w.undo({ steps: 1 });
  assert.equal(w.query(t.id, { select: ['Owner'] }).items.find((i) => i.id === row.id).Owner, 'sam');
  assert.deepEqual(undone[0].kept, [{ field: 'Owner', by: 'bob' }]);
});

test('the MCP tool carries kept and skipped', () => {
  const { w, row } = seed();
  w.actor = 'ann';
  w.updateEntity(row.id, { Estimate: 5 });
  w.actor = 'bob';
  w.updateEntity(row.id, { Estimate: 8 });
  w.actor = 'ann';
  const r = dispatchTool(w, 'weave_undo', { steps: 1 });
  assert.deepEqual(r.undone[0].kept, [{ field: 'Estimate', by: 'bob' }]);
  assert.equal(r.undone[0].skipped, 'changed since');
  assert.equal(value(w, row.id, 'Estimate'), 8);
});

test("POST /api/undo keeps the other editor's value, the shape the Issue's probe took", async () => {
  const { w, row } = seed();
  const ann = w.createAccount({ name: 'ann', role: 'editor' }).token;
  const bob = w.createAccount({ name: 'bob', role: 'editor' }).token;
  w.setRequireAuth(true);
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, token, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  };
  try {
    assert.equal((await call('PATCH', `/api/entities/${row.id}`, ann, { values: { Estimate: 5 } })).status, 200);
    assert.equal((await call('PATCH', `/api/entities/${row.id}`, bob, { values: { Estimate: 8 } })).status, 200);
    const undone = (await call('POST', '/api/undo', ann, { steps: 1 })).json.undone;
    assert.deepEqual(undone[0].kept, [{ field: 'Estimate', by: 'bob' }]);
    assert.equal(undone[0].skipped, 'changed since');
    const now = (await call('GET', `/api/entities/${row.id}`, bob)).json;
    assert.equal(now.fields.Estimate, 8, "bob's 8 is still there, where it used to read 3");
  } finally {
    server.close();
  }
});

const trashed = (w, id) => w.state.entities[id].deletedAt != null;

test('undoing a create leaves the row out of Trash when another actor edited it since, and names the field', () => {
  const { w, t } = seed();
  w.actor = 'ann';
  const draft = w.createEntity(t.id, { Name: 'draft', Estimate: 1 });
  w.actor = 'bob';
  w.updateEntity(draft.id, { Estimate: 9 });
  w.actor = 'ann';
  const { undone } = w.undo({ steps: 1 });
  assert.equal(trashed(w, draft.id), false, "bob's edit keeps the row live");
  assert.equal(value(w, draft.id, 'Estimate'), 9);
  assert.equal(undone[0].kind, 'create');
  assert.equal(undone[0].skipped, 'changed since');
  assert.deepEqual(undone[0].kept, [{ field: 'Estimate', by: 'bob' }]);
});

test("undoing a create still trashes the row when the only later writes are its own rule run's", () => {
  const { w, t } = seed();
  w.addField(t.id, { name: 'Stamp', type: 'text' });
  w.createAutomation(t.id, { name: 'Stamp it', trigger: { type: 'entity-created' }, actions: [{ type: 'set-field', field: 'Stamp', value: 'stamped' }] });
  w.actor = 'ann';
  const draft = w.createEntity(t.id, { Name: 'draft', Estimate: 1 });
  assert.equal(value(w, draft.id, 'Stamp'), 'stamped', 'the rule stamped the row as the workflow actor');
  const { undone } = w.undo({ steps: 2 });
  assert.deepEqual(undone.map((u) => u.kind), ['update', 'create']);
  assert.equal(undone[1].skipped, undefined);
  assert.equal(undone[1].kept, undefined);
  assert.equal(trashed(w, draft.id), true, "ann's create and its rule run are one actor set");
});

test("undoing a create trashes the row when ann's own later edit is the only one", () => {
  const { w, t } = seed();
  w.actor = 'ann';
  const draft = w.createEntity(t.id, { Name: 'draft', Estimate: 1 });
  w.updateEntity(draft.id, { Estimate: 2 });
  const { undone } = w.undo({ steps: 2 });
  assert.deepEqual(undone.map((u) => u.skipped), [undefined, undefined]);
  assert.equal(trashed(w, draft.id), true);
});

test('undoing a restore leaves the row live when another actor edited it since', () => {
  const { w, row } = seed();
  w.actor = 'ann';
  w.deleteEntity(row.id);
  w.restoreEntity(row.id);
  w.actor = 'bob';
  w.updateEntity(row.id, { Estimate: 9 });
  w.actor = 'ann';
  const { undone } = w.undo({ steps: 1 });
  assert.equal(undone[0].kind, 'restore');
  assert.equal(undone[0].skipped, 'changed since');
  assert.deepEqual(undone[0].kept, [{ field: 'Estimate', by: 'bob' }]);
  assert.equal(trashed(w, row.id), false);
  assert.equal(value(w, row.id, 'Estimate'), 9);
});

test("undoing a restore still trashes the row when the edits by others came before the restore", () => {
  const { w, row } = seed();
  w.actor = 'bob';
  w.updateEntity(row.id, { Estimate: 9 });
  w.actor = 'ann';
  w.deleteEntity(row.id);
  w.restoreEntity(row.id);
  const { undone } = w.undo({ steps: 1 });
  assert.equal(undone[0].kind, 'restore');
  assert.equal(undone[0].skipped, undefined);
  assert.equal(trashed(w, row.id), true);
});

test('a create entry recorded before this change, with no actor set, trashes as it always did', () => {
  const { w, t } = seed();
  w.actor = 'ann';
  const draft = w.createEntity(t.id, { Name: 'draft', Estimate: 1 });
  w.actor = 'bob';
  w.updateEntity(draft.id, { Estimate: 9 });
  const legacy = w.store.listUndo({ limit: 10, actor: 'ann' })[0];
  assert.equal(legacy.kind, 'create');
  legacy.data = {};
  w.actor = 'ann';
  w.undo({ steps: 1 });
  assert.equal(trashed(w, draft.id), true);
});
