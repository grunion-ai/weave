import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

let base, server;

async function api(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

test.before(async () => {
  ({ server } = await startServer(new Weave(), { port: 0 }));
  base = `http://127.0.0.1:${server.address().port}`;
  await api('POST', '/api/spaces', { name: 'Product' });
  await api('POST', '/api/tables', { space: 'Product', name: 'Task' });
  for (const Name of ['a', 'b', 'c']) await api('POST', '/api/tables/Task/entities', { Name });
});

test.after(() => server.close());

test('an encoded qualified table name queries the same rows as the bare name', async () => {
  const bare = await api('POST', '/api/tables/Task/query', { limit: 1 });
  const qualified = await api('POST', '/api/tables/Product%2FTask/query', { limit: 1 });
  assert.equal(qualified.status, 200);
  assert.equal(qualified.data.total, bare.data.total);
  assert.equal(qualified.data.total, 3);
});

test('the lowercase escape and other table routes take the qualified name too', async () => {
  assert.equal((await api('POST', '/api/tables/Product%2ftask/query', {})).data.total, 3);
  const table = await api('GET', '/api/tables/Product%2FTask');
  assert.equal(table.status, 200);
  assert.equal(table.data.name, 'Task');
  assert.equal((await api('POST', '/api/tables/Product%2FTask/entities', { Name: 'd' })).status, 201);
});

test('a dotted or unknown key answers not-found, never No route', async () => {
  for (const key of ['Product.Task', 'Product%2FNope', 'Nope%2FTask']) {
    const res = await api('POST', `/api/tables/${key}/query`, {});
    assert.equal(res.status, 404, key);
    assert.equal(res.data.code, 'not-found', key);
    assert.doesNotMatch(res.data.error, /No route/, key);
  }
});

test('routes that decode the table segment themselves keep working', async () => {
  const views = await api('GET', '/api/tables/Product%2FTask/views');
  assert.equal(views.status, 200);
  const bare = await api('GET', '/api/tables/Task/views');
  assert.deepEqual(views.data, bare.data);
});
