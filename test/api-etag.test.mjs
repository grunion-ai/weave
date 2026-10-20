import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { Weave } from '../src/engine.js';
import { startServer, revalidateApi, gzipOutcome } from '../src/server.js';

function raw(port, path, headers = {}, method = 'GET', body) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: body ? { 'Content-Type': 'application/json', ...headers } : headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

async function withServer(fn, { requireAuth = false } = {}) {
  const weave = new Weave();
  weave.createSpace({ name: 'Sales' });
  weave.createTable({ space: 'Sales', name: 'Deals' });
  for (let i = 0; i < 20; i++) weave.addField('Sales/Deals', { name: `Field ${i}`, type: 'text' });
  for (let i = 0; i < 30; i++) weave.createEntity('Sales/Deals', { Name: `Deal ${i}` });
  const admin = requireAuth ? weave.createAccount({ name: 'root', role: 'admin' }).token : null;
  if (requireAuth) weave.setRequireAuth(true);
  const { server, port } = await startServer(weave, { port: 0 });
  try { await fn(port, { weave, admin }); } finally { server.close(); }
}

test('a second GET of /api/schema with its ETag answers 304 with no body', async () => {
  await withServer(async (port) => {
    const first = await raw(port, '/api/schema', { 'Accept-Encoding': 'gzip' });
    assert.equal(first.status, 200);
    const etag = first.headers.etag;
    assert.match(etag ?? '', /^W\/"[^"]+"$/, 'a weak validator, one for every encoding');
    assert.match(first.headers['cache-control'] ?? '', /\bno-cache\b/, 'the browser revalidates before it reuses');
    assert.match(first.headers['cache-control'] ?? '', /\bprivate\b/, 'a shared cache never stores one member\'s read');
    const again = await raw(port, '/api/schema', { 'If-None-Match': etag, 'Accept-Encoding': 'gzip' });
    assert.equal(again.status, 304);
    assert.equal(again.body.length, 0, 'a 304 has no body');
    assert.equal(again.headers.etag, etag);
    assert.ok(again.headers['x-weave-schema-version'], 'the route headers ride the 304 so the client still sees the schema version');
    const plain = await raw(port, '/api/schema', { 'If-None-Match': etag });
    assert.equal(plain.status, 304, 'gzipped or not, the same validator matches');
  });
});

test('a write between two reads answers 200 with a new ETag', async () => {
  await withServer(async (port) => {
    const first = await raw(port, '/api/schema');
    const added = await raw(port, '/api/tables/Deals/fields', {}, 'POST', { name: 'Stage', type: 'text' });
    assert.ok(added.status < 300, `the write lands (got ${added.status})`);
    const after = await raw(port, '/api/schema', { 'If-None-Match': first.headers.etag });
    assert.equal(after.status, 200);
    assert.ok(after.body.length > 0);
    assert.notEqual(after.headers.etag, first.headers.etag);
  });
});

test('a table page revalidates, and a new row on it changes the validator', async () => {
  await withServer(async (port) => {
    const path = '/api/tables/Deals/entities?limit=50';
    const first = await raw(port, path);
    assert.equal(first.status, 200);
    assert.ok(first.headers.etag);
    assert.equal((await raw(port, path, { 'If-None-Match': first.headers.etag })).status, 304);
    assert.equal((await raw(port, path, { 'If-None-Match': `W/"nope", ${first.headers.etag}` })).status, 304, 'any tag in the list matches');
    const other = await raw(port, '/api/tables/Deals/entities?limit=5', { 'If-None-Match': first.headers.etag });
    assert.equal(other.status, 200, 'another page is another body');
    await raw(port, '/api/tables/Deals/entities', {}, 'POST', { Name: 'Deal new' });
    assert.equal((await raw(port, path, { 'If-None-Match': first.headers.etag })).status, 200);
  });
});

test('POST /query and writes carry no ETag', async () => {
  await withServer(async (port) => {
    const q = await raw(port, '/api/tables/Deals/query', {}, 'POST', {});
    assert.equal(q.status, 200);
    assert.equal(q.headers.etag, undefined);
    const made = await raw(port, '/api/tables/Deals/entities', {}, 'POST', { Name: 'x' });
    assert.equal(made.headers.etag, undefined);
  });
});

test('a validator never opens a walled read: without credentials the answer stays 401', async () => {
  await withServer(async (port, { admin }) => {
    const mine = await raw(port, '/api/schema', { Authorization: `Bearer ${admin}` });
    assert.equal(mine.status, 200);
    assert.ok(mine.headers.etag);
    const stranger = await raw(port, '/api/schema', { 'If-None-Match': mine.headers.etag });
    assert.equal(stranger.status, 401);
    assert.equal(stranger.headers.etag, undefined);
    assert.equal((await raw(port, '/api/schema', { Authorization: `Bearer ${admin}`, 'If-None-Match': mine.headers.etag })).status, 304);
  }, { requireAuth: true });
});

test('revalidateApi matches only the body this request would get, so one member\'s tag never answers another\'s read', () => {
  const read = (body, ifNoneMatch) => revalidateApi({ status: 200, headers: { 'Content-Type': 'application/json' }, body }, { method: 'GET', path: '/api/tables/Deals/entities', ifNoneMatch });
  const alice = read('{"items":["a","secret"]}');
  const bob = read('{"items":["a"]}', alice.headers.ETag);
  assert.equal(bob.status, 200, 'Bob\'s narrower body hashes to a different tag');
  assert.equal(bob.body, '{"items":["a"]}');
  assert.equal(read('{"items":["a","secret"]}', alice.headers.ETag).status, 304);
});

test('revalidateApi leaves pages, writes, errors, no-store answers and cookie setters alone', () => {
  const ok = { status: 200, headers: { 'Content-Type': 'application/json' }, body: '{}' };
  const call = (outcome, method = 'GET', path = '/api/schema') => revalidateApi(outcome, { method, path, ifNoneMatch: null });
  assert.equal(call(ok, 'GET', '/app.js'), ok);
  assert.equal(call(ok, 'POST', '/api/tables/Deals/query'), ok);
  assert.equal(call({ ...ok, status: 404 }).headers.ETag, undefined);
  assert.equal(call({ ...ok, headers: { ...ok.headers, 'Cache-Control': 'no-store' } }).headers.ETag, undefined);
  assert.equal(call({ ...ok, headers: { ...ok.headers, 'Set-Cookie': 'a=b' } }).headers.ETag, undefined);
  assert.ok(call(ok, 'GET', '/w/sales/api/schema').headers.ETag, 'a workspace mount is an API path too');
});

test('private API answers never enter the shared gzip cache', () => {
  const cache = new Map();
  for (let i = 0; i < 50; i++) {
    const outcome = revalidateApi({ status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ i, pad: 'x'.repeat(4096) }) }, { method: 'GET', path: '/api/schema', ifNoneMatch: null });
    const zipped = gzipOutcome(outcome, 'gzip', { cache, path: '/api/schema' });
    assert.equal(zipped.headers['Content-Encoding'], 'gzip', 'still compressed on the wire');
  }
  assert.equal(cache.size, 0);
});
