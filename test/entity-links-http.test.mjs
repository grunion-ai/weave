import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

async function serve() {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Project' });
  w.createTable({ space: 'Ops', name: 'Task' });
  w.addRelation('Task', { name: 'Project', targetDb: 'Project', cardinality: 'many-to-one', inverseName: 'Tasks' });
  const apollo = w.createEntity('Project', { Name: 'Apollo' });
  const task = w.createEntity('Task', { Name: 'Wire the board' });
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, json: await res.json() };
  };
  return { w, apollo, task, call, stop: () => server.close() };
}

test('POST /api/entities/:id/link sets the relation and answers the entity; an unknown field is a 404', async () => {
  const { w, apollo, task, call, stop } = await serve();
  try {
    const ok = await call('POST', `/api/entities/${task.id}/link`, { field: 'Project', targets: ['Apollo'] });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.id, task.id);
    assert.equal(ok.json.fields.Project.id, apollo.id);
    assert.deepEqual(w.readEntity(apollo.id).fields.Tasks.map((t) => t.id), [task.id], 'the inverse side sees the link');

    const bad = await call('POST', `/api/entities/${task.id}/link`, { field: 'Nope', targets: ['Apollo'] });
    assert.equal(bad.status, 404);
    assert.equal(bad.json.code, 'not-found');
    const ghost = await call('POST', `/api/entities/${task.id}/link`, { field: 'Project', targets: ['Ghost'] });
    assert.equal(ghost.status, 404, 'a target that does not exist is refused, not created');
    assert.equal(w.readEntity(task.id).fields.Project.id, apollo.id, 'a refused link leaves the relation as it was');
  } finally {
    stop();
  }
});

test('POST /api/entities/:id/unlink clears the relation; an unknown field is a 404', async () => {
  const { w, apollo, task, call, stop } = await serve();
  try {
    w.link(task.id, 'Project', ['Apollo']);
    const ok = await call('POST', `/api/entities/${task.id}/unlink`, { field: 'Project', targets: ['Apollo'] });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.fields.Project, null);
    assert.deepEqual(w.readEntity(apollo.id).fields.Tasks, []);

    const bad = await call('POST', `/api/entities/${task.id}/unlink`, { field: 'Nope', targets: ['Apollo'] });
    assert.equal(bad.status, 404);
    assert.match(bad.json.error, /Field 'Nope' not found/);
  } finally {
    stop();
  }
});
