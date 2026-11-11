import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Weave } from '../src/engine.js';
import { createWorkspaceHub } from '../src/server.js';
import { client } from './lib/fixtures.mjs';
import { onDisk, reopen } from './lib/reopen.mjs';
import { tempDir } from './lib/temp.mjs';

const FIXTURE = new URL('./fixtures/weave-v0.4.100.db', import.meta.url);

const stores = [['in memory', () => new Weave()], ['on disk', () => onDisk('wv-undo-actor-')]];

function twoWriters(w) {
  w.createSpace({ name: 'S' });
  w.createTable({ space: 'S', name: 'T' });
  w.addField('T', { name: 'N', type: 'number' });
  w.addField('T', { name: 'M', type: 'number' });
  const a = w.createEntity('T', { name: 'a', values: { N: 0, M: 0 } });
  const b = w.createEntity('T', { name: 'b', values: { N: 0 } });
  w.actor = 'A';
  w.updateEntity(a.id, { N: 1 });
  w.actor = 'B';
  w.updateEntity(b.id, { N: 2 });
  w.updateEntity(a.id, { M: 2 });
  return { a, b };
}

for (const [label, make] of stores) {
  test(`${label}: an actor's undo reverts its own newest write and leaves the other actor's`, () => {
    const w = make();
    const { a, b } = twoWriters(w);
    w.actor = 'A';
    const { undone } = w.undo();
    assert.deepEqual(undone.map((u) => [u.kind, u.name]), [['update', 'a']]);
    assert.equal(w.readEntity(a.id).fields.N, 0, "A's write is reverted");
    assert.equal(w.readEntity(a.id).fields.M, 2, "B's later write to the same row stays");
    assert.equal(w.readEntity(b.id).fields.N, 2, "B's write stays");
    assert.deepEqual(w.undo().undone, [], 'A has nothing left to undo, though B and the seed wrote');
    w.actor = 'B';
    assert.deepEqual(w.undo({ steps: 5 }).undone.map((u) => u.name), ['a', 'b'], "B's undo walks back B's writes only");
    assert.equal(w.readEntity(a.id).fields.M, 0);
    assert.equal(w.readEntity(b.id).fields.N, 0);
    assert.ok(!w.getEntity(a.id).deletedAt && !w.getEntity(b.id).deletedAt, "the seed's creates are not B's to undo");
  });

  test(`${label}: listUndo previews the caller's own stack`, () => {
    const w = make();
    twoWriters(w);
    w.actor = 'A';
    assert.deepEqual(w.listUndo().map((u) => u.name), ['a']);
    w.actor = 'B';
    assert.deepEqual(w.listUndo().map((u) => u.name), ['a', 'b']);
    w.actor = 'C';
    assert.deepEqual(w.listUndo(), []);
  });

  test(`${label}: the stack is bounded per actor, so one actor's flood keeps another's history`, () => {
    const w = make();
    const { a, b } = twoWriters(w);
    for (let i = 0; i < 230; i++) w.updateEntity(b.id, { N: 100 + i });
    assert.equal(w.listUndo({ limit: 1000 }).length, 200, "B's stack holds its newest 200");
    w.actor = 'A';
    assert.deepEqual(w.listUndo({ limit: 1000 }).map((u) => u.name), ['a'], "A's entry outlived B's 230 writes");
    w.undo();
    assert.equal(w.readEntity(a.id).fields.N, 0);
  });

  test(`${label}: expect pops only while the caller's own newest entries still read as it named them (Issue #1727)`, () => {
    const w = make();
    const { a, b } = twoWriters(w);
    w.actor = 'A';
    const key = (u) => `${u.kind}|${u.entityId}|${u.ts}`;
    const mine = key(w.listUndo({ limit: 1 })[0]);
    w.updateEntity(b.id, { N: 7 });
    assert.throws(() => w.undo({ steps: 1, expect: [mine] }), { code: 'conflict' }, "A's own later write sits on top of the entry it named");
    assert.equal(w.readEntity(a.id).fields.N, 1, 'nothing was reverted');
    assert.equal(w.readEntity(b.id).fields.N, 7);
    assert.deepEqual(w.listUndo({ limit: 2 }).map((u) => u.name), ['b', 'a'], 'both entries stay on the stack');
    const run = w.listUndo({ limit: 2 }).map(key);
    assert.deepEqual(w.undo({ steps: 2, expect: run }).undone.map((u) => u.name), ['b', 'a'], 'naming both pops both');
    assert.equal(w.readEntity(a.id).fields.N, 0);
    assert.equal(w.readEntity(b.id).fields.N, 2, "B's own write is not A's to revert");
  });
}

test('per-actor stacks survive a reopen', () => {
  const w = onDisk('wv-undo-actor-reopen-');
  const { a, b } = twoWriters(w);
  const again = reopen(w);
  again.actor = 'A';
  assert.deepEqual(again.listUndo().map((u) => u.name), ['a']);
  again.undo();
  const third = reopen(again);
  assert.equal(third.readEntity(a.id).fields.N, 0);
  assert.equal(third.readEntity(b.id).fields.N, 2);
  third.actor = 'B';
  assert.deepEqual(third.listUndo().map((u) => u.name), ['a', 'b']);
});

test("an automation's write sits on the stack of the actor whose write fired it", () => {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  w.createTable({ space: 'S', name: 'Task' });
  w.addField('Task', { name: 'Estimate', type: 'number' });
  w.addField('Task', {
    name: 'State', type: 'workflow', config: { states: [{ name: 'Open', category: 'not-started', default: true }, { name: 'Done', category: 'done' }] },
  });
  w.createAutomation('Task', {
    name: 'escalate',
    trigger: { type: 'field-updated', field: 'Estimate' },
    actions: [{ type: 'set-field', field: 'State', value: 'Done' }],
  });
  const e = w.createEntity('Task', { name: 'job' });
  w.actor = 'A';
  w.updateEntity(e.id, { Estimate: 9 });
  assert.equal(w.readEntity(e.id).fields.State, 'Done', 'the automation fired');
  w.actor = 'B';
  assert.deepEqual(w.undo().undone, [], "B's undo leaves A's write and its automation effect alone");
  assert.equal(w.readEntity(e.id).fields.State, 'Done');
  w.actor = 'A';
  assert.equal(w.undo({ steps: 2 }).undone.length, 2);
  assert.deepEqual([w.readEntity(e.id).fields.Estimate, w.readEntity(e.id).fields.State], [null, 'Open']);
});

test('an undo log written before this release keeps each entry to its actor', () => {
  const path = join(tempDir('wv-undo-actor-floor-'), 'weave.db');
  copyFileSync(FIXTURE, path);
  const w = new Weave({ path, actor: 'someone else' });
  assert.deepEqual(w.listUndo(), []);
  assert.deepEqual(w.undo().undone, [], "another actor cannot pop the fixture's history");
  w.actor = 'fixture';
  assert.equal(w.listUndo({ limit: 100 }).length, 13, "the fixture actor's 13 entries are still its own");
  const [top] = w.undo().undone;
  assert.deepEqual([top.kind, top.name], ['comment-add', 'Apollo Launch']);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const stray = db.prepare("SELECT count(*) AS n FROM undo_log WHERE actor IS NOT json_extract(json, '$.actor')").get().n;
    assert.equal(stray, 0, 'every row carries its own actor in its column');
  } finally {
    db.close();
  }
});

test("REST: an editor's POST /api/undo reverts that editor's writes, never another editor's", async () => {
  const w = new Weave();
  w.updateWorkspace({ name: 'ws' });
  w.createSpace({ name: 'S' });
  w.createTable({ space: 'S', name: 'T' });
  w.addField('T', { name: 'N', type: 'number' });
  const x = w.createEntity('T', { name: 'x', values: { N: 0 } });
  const y = w.createEntity('T', { name: 'y', values: { N: 0 } });
  const ann = w.createAccount({ name: 'ann', role: 'editor' }).token;
  const bob = w.createAccount({ name: 'bob', role: 'editor' }).token;
  w.setRequireAuth(true);
  const call = client(createWorkspaceHub(w));
  assert.equal((await call('PATCH', `/api/entities/${x.id}`, { token: ann, body: { values: { N: 1 } } })).status, 200);
  assert.equal((await call('PATCH', `/api/entities/${y.id}`, { token: bob, body: { values: { N: 2 } } })).status, 200);
  const preview = await call('GET', '/api/undo', { token: ann });
  assert.deepEqual(preview.json.map((u) => u.name), ['x'], "Ann's preview is her own stack");
  const res = await call('POST', '/api/undo', { token: ann, body: { steps: 1 } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.undone.map((u) => u.name), ['x'], "Ann's undo names her own row, not Bob's newer one");
  assert.equal(w.readEntity(x.id).fields.N, 0);
  assert.equal(w.readEntity(y.id).fields.N, 2, "Bob's write stays");
  assert.deepEqual((await call('POST', '/api/undo', { token: ann, body: { steps: 1 } })).json.undone, []);
  assert.deepEqual((await call('GET', '/api/undo', { token: bob })).json.map((u) => u.name), ['y']);
});
