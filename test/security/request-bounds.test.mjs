import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
process.env.WEAVE_KEYSTORE ??= join(mkdtempSync(join(tmpdir(), 'weave-sec-')), 'keystore.json');
const { Weave } = await import('../../src/engine.js');
const { createRequestHandler, MAX_BODY_BYTES } = await import('../../src/routes.js');
const { createWorkspaceHub, startServer } = await import('../../src/server.js');

const withPasscode = (value, fn) => {
  const prior = process.env.WEAVE_APPLET_PASSCODE;
  if (value == null) delete process.env.WEAVE_APPLET_PASSCODE; else process.env.WEAVE_APPLET_PASSCODE = value;
  return Promise.resolve().then(fn).finally(() => { if (prior == null) delete process.env.WEAVE_APPLET_PASSCODE; else process.env.WEAVE_APPLET_PASSCODE = prior; });
};

function handler() {
  const w = new Weave();
  w.createSpace({ name: 'Product' });
  w.createTable({ space: 'Product', name: 'Task' });
  const handle = createRequestHandler(createWorkspaceHub(w), { version: 'test' });
  return async (method, path, { headers = {}, body = {} } = {}) => {
    const url = new URL(path, 'http://localhost:4400');
    const h = { host: 'localhost:4400', ...headers };
    let reads = 0;
    const res = await handle({
      method, path: decodeURIComponent(url.pathname), searchParams: url.searchParams,
      header: (n) => h[n.toLowerCase()], readBody: async () => { reads += 1; return body; }, remote: '127.0.0.1',
    });
    let json = null;
    try { json = JSON.parse(res.body); } catch {}
    return { status: res.status, json, reads };
  };
}

test('the applet path reads no body while the applet is off', () => withPasscode(null, async () => {
  const call = handler();
  for (const path of ['/t/unlock', '/t/data', '/t/file']) {
    const { reads } = await call('POST', path, { body: { passcode: 'x' } });
    assert.equal(reads, 0, `${path} read the body with no applet configured`);
  }
}));

test('with the applet on, a body larger than the cap is refused before it is read', () => withPasscode('1234', async () => {
  const call = handler();
  const big = await call('POST', '/t/unlock', { headers: { 'content-length': String(MAX_BODY_BYTES + 1) }, body: { passcode: '1234' } });
  assert.equal(big.status, 413);
  assert.equal(big.reads, 0, 'nothing was buffered');
  const ok = await call('POST', '/t/unlock', { headers: { 'content-length': '20' }, body: { passcode: '1234' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.reads, 1);
}));

test('over HTTP the declared size is refused with 413 and the 10 MiB streaming cap stays', () => withPasscode('1234', async () => {
  const { server, port } = await startServer(new Weave(), { port: 0 });
  const send = (length, chunk) => new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method: 'POST', path: '/t/unlock', headers: { 'Content-Type': 'application/json', 'Content-Length': length } }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    if (chunk) req.write(chunk);
    req.end();
  });
  try {
    const declared = await send(String(MAX_BODY_BYTES + 1), null);
    assert.equal(declared.status, 413, declared.text);
    assert.equal(MAX_BODY_BYTES, 10 * 1024 * 1024);
  } finally { server.close(); }
}));

async function serveRows(n = 620) {
  const w = new Weave();
  w.createSpace({ name: 'Product' });
  w.createTable({ space: 'Product', name: 'Task' });
  for (let i = 0; i < n; i++) w.createEntity('Product/Task', { name: `needle ${i}` });
  const { server, port } = await startServer(w, { port: 0 });
  const get = async (path) => (await fetch(`http://127.0.0.1:${port}${path}`)).json();
  const post = async (path, body) => (await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  return { get, post, stop: () => server.close() };
}

test('every limit a route takes is capped at 500, the most the UI asks for; the absent limit still means every row', async () => {
  const { get, post, stop } = await serveRows();
  try {
    assert.equal((await get('/api/tables/Product%2FTask/entities?limit=100000')).items.length, 500, 'GET entities');
    assert.equal((await get('/api/tables/Product%2FTask/entities')).items.length, 620, 'no limit, every row');
    assert.equal((await post('/api/tables/Product%2FTask/query', { limit: 100000 })).items.length, 500, 'POST query');
    assert.equal((await post('/api/tables/Product%2FTask/query', {})).items.length, 620, 'POST query, no limit');
    assert.equal((await get('/api/activity?limit=100000')).items.length, 500, 'activity');
    assert.ok((await get('/api/audit?limit=100000')).length <= 500, 'audit');
    assert.ok((await get('/api/undo?limit=100000')).length <= 500, 'undo');
    const search = await get('/api/search?q=needle&limit=100000');
    assert.equal(search.filter((h) => h.kind === 'entity').length, 500, 'search');
    const all = await get('/api/search?q=needle&all=1&limit=100000');
    assert.equal(all.filter((h) => h.kind === 'entity').length, 500, 'search across workspaces');
  } finally { stop(); }
});

test('WEAVE_MAX_ROWS raises the cap for an operator who needs more', async () => {
  const prior = process.env.WEAVE_MAX_ROWS;
  process.env.WEAVE_MAX_ROWS = '600';
  const { get, stop } = await serveRows();
  try {
    assert.equal((await get('/api/tables/Product%2FTask/entities?limit=100000')).items.length, 600);
    assert.equal((await get('/api/activity?limit=100000')).items.length, 600);
  } finally { stop(); if (prior == null) delete process.env.WEAVE_MAX_ROWS; else process.env.WEAVE_MAX_ROWS = prior; }
});
