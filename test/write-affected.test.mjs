import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

let base, server, weave;
let tasks, people, alice, bob, taskA, taskB, loose;

async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

test.before(async () => {
  weave = new Weave();
  weave.createSpace({ name: 'Work' });
  people = weave.createTable({ space: 'Work', name: 'Person' });
  tasks = weave.createTable({ space: 'Work', name: 'Task' });
  weave.addField(tasks, { name: 'Note', type: 'text' });
  weave.addField(tasks, {
    name: 'Stage',
    type: 'workflow',
    config: { states: [{ name: 'Open', category: 'not-started', default: true }, { name: 'Done', category: 'done' }] },
  });
  weave.addRelation(tasks, { name: 'Owner', targetDb: people, cardinality: 'many-to-one', inverseName: 'Tasks' });
  alice = weave.createEntity(people, { name: 'Alice' });
  bob = weave.createEntity(people, { name: 'Bob' });
  taskA = weave.createEntity(tasks, { name: 'task a', values: { Owner: alice.id } });
  taskB = weave.createEntity(tasks, { name: 'task b', values: { Owner: alice.id } });
  loose = weave.createEntity(tasks, { name: 'task c' });
  ({ server } = await startServer(weave, { port: 0 }));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

test('a workflow state move names the rows it changed', async () => {
  const res = await api('POST', `/api/entities/${taskA.id}/state`, { field: 'Stage', state: 'Done' });
  assert.equal(res.status, 200);
  assert.equal(res.data.fields.Stage, 'Done', 'the move still answers with the fresh row');
  const got = new Set(res.data.affected);
  assert.ok(got.has(taskA.id), `the row moved: ${JSON.stringify(res.data.affected)}`);
  assert.ok(got.has(alice.id), 'and the Person it hangs from, whose rollups read it');
  assert.ok(!got.has(taskB.id), 'and no row it cannot reach');
});

test('a link names both sides', async () => {
  const res = await api('POST', `/api/entities/${loose.id}/link`, { field: 'Owner', targets: [bob.id] });
  assert.equal(res.status, 200);
  const got = new Set(res.data.affected);
  assert.ok(got.has(loose.id), `the row written: ${JSON.stringify(res.data.affected)}`);
  assert.ok(got.has(bob.id), 'and the row it was linked to');
});

test('an unlink names both sides', async () => {
  const res = await api('POST', `/api/entities/${loose.id}/unlink`, { field: 'Owner', targets: [bob.id] });
  assert.equal(res.status, 200);
  const got = new Set(res.data.affected);
  assert.ok(got.has(loose.id), `the row written: ${JSON.stringify(res.data.affected)}`);
  assert.ok(got.has(bob.id), 'and the row it was cut from');
});

test('a bulk set names every row it wrote', async () => {
  const res = await api('POST', '/api/bulk', { ids: [taskA.id, taskB.id], op: 'set', values: { Note: 'swept' } });
  assert.equal(res.status, 200);
  assert.equal(res.data.done.length, 2, 'the bulk still answers with its own done list');
  const got = new Set(res.data.affected);
  assert.ok(got.has(taskA.id) && got.has(taskB.id), `both rows: ${JSON.stringify(res.data.affected)}`);
  assert.ok(got.has(alice.id), 'and the Person both hang from');
  assert.ok(!got.has(bob.id), 'and no row the write cannot reach');
});

test('an undo names the rows the pop changed', async () => {
  const before = await api('PATCH', `/api/entities/${loose.id}`, { values: { Note: 'typo' } });
  assert.equal(before.status, 200);
  const res = await api('POST', '/api/undo', { steps: 1 });
  assert.equal(res.status, 200);
  assert.equal(res.data.undone.length, 1, 'the undo still answers with its own undone list');
  assert.deepEqual(res.data.affected, [loose.id], `the row put back: ${JSON.stringify(res.data.affected)}`);
  const row = await api('GET', `/api/entities/${loose.id}`);
  assert.equal(row.data.fields.Note ?? null, null, 'and the value really went back');
});

test('an undo with nothing left to pop names no row', async () => {
  let res;
  for (let i = 0; i < 20; i++) {
    res = await api('POST', '/api/undo', { steps: 1 });
    assert.equal(res.status, 200);
    if (!res.data.undone.length) break;
  }
  assert.equal(res.data.undone.length, 0, 'the stack drained inside twenty pops');
  assert.deepEqual(res.data.affected, [], `nothing popped, nothing named: ${JSON.stringify(res.data.affected)}`);
});
