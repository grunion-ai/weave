import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../../src/engine.js';
import { startServer } from '../../src/server.js';
import { ownsEntity } from '../../src/routes.js';

test('an entity id only counts when the workspace holds it as an own key, never through the prototype', () => {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Ticket' });
  const row = w.createEntity('Ops/Ticket', { Name: 'real' });
  assert.equal(ownsEntity(w, row.id), true);
  for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    assert.equal(ownsEntity(w, key), false, key);
  }
});

test('a member route sends a prototype key to its own 404 and still reaches a root entity it does not hold', async () => {
  const root = new Weave();
  root.updateWorkspace({ name: 'root' });
  root.createSpace({ name: 'Ops' });
  root.createTable({ space: 'Ops', name: 'Ticket' });
  const ticket = root.createEntity('Ops/Ticket', { Name: 'shared' });
  const a = new Weave();
  a.updateWorkspace({ name: 'alpha' });
  a.createSpace({ name: 'Work' });
  a.createTable({ space: 'Work', name: 'Lead' });
  const { server } = await startServer(root, { port: 0, workspaces: { alpha: a } });
  const base = `http://127.0.0.1:${server.address().port}/w/alpha`;
  try {
    for (const key of ['__proto__', 'constructor', 'toString']) {
      const res = await fetch(`${base}/api/entities/${key}`);
      assert.equal(res.status, 404, key);
      assert.equal((await res.json()).code, 'not-found', key);
    }
    const shared = await fetch(`${base}/api/entities/${ticket.id}`);
    assert.equal(shared.status, 200);
    assert.equal((await shared.json()).id, ticket.id);
  } finally {
    server.close();
  }
});
