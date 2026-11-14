import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const raw = (port, path, { method = 'GET', headers = {}, body = null } = {}) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }));
  });
  req.on('error', reject);
  req.end(body ?? undefined);
});

function workspace() {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Task' });
  for (let i = 0; i < 30; i++) w.createEntity('Ops/Task', { name: `Café ☕ ${i}, résumé à la carte` });
  return w;
}

async function serving(w, options = {}) {
  const { server, port } = await startServer(w, { port: 0, ...options });
  return { port, close: () => { server.closeAllConnections(); server.close(); } };
}

test('a buffered response carries the length of the bytes it sends instead of going out chunked (Issue #1645)', { timeout: 60_000 }, async () => {
  const s = await serving(workspace());
  try {
    const answers = {
      'a JSON list with multibyte names': await raw(s.port, '/api/tables/Task/entities'),
      'the same list gzipped': await raw(s.port, '/api/tables/Task/entities', { headers: { 'Accept-Encoding': 'gzip' } }),
      'the app shell': await raw(s.port, '/'),
      'a static script': await raw(s.port, '/app.js'),
      'a refusal': await raw(s.port, '/api/tables/Nope/entities'),
      'a malformed path': await raw(s.port, '/api/%E0%A4%A'),
      'a write': await raw(s.port, '/api/tables/Task/entities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Naïve write' }) }),
    };
    for (const [what, r] of Object.entries(answers)) {
      assert.equal(r.headers['transfer-encoding'], undefined, `${what} is not chunked`);
      assert.equal(r.headers['content-length'], String(r.bytes.length), `${what} names its length in bytes`);
      assert.ok(r.bytes.length > 0, `${what} has a body`);
    }
    const plain = answers['a JSON list with multibyte names'];
    assert.ok(plain.bytes.length > plain.bytes.toString('utf8').length, 'the length counts bytes, not characters');
    const zipped = answers['the same list gzipped'];
    assert.equal(zipped.headers['content-encoding'], 'gzip');
    assert.ok(zipped.bytes.length < plain.bytes.length, 'the gzipped length is the compressed size');
    assert.deepEqual(gunzipSync(zipped.bytes), plain.bytes);
  } finally { s.close(); }
});

test('HEAD reports the size a GET sends, and a 304 or 204 carries no length and no body (Issue #1645)', { timeout: 60_000 }, async () => {
  const s = await serving(workspace());
  try {
    const page = await raw(s.port, '/');
    const head = await raw(s.port, '/', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers['content-length'], String(page.bytes.length), 'HEAD names the length GET sends');
    assert.equal(head.bytes.length, 0, 'HEAD sends no body');
    const list = await raw(s.port, '/api/tables/Task/entities');
    const again = await raw(s.port, '/api/tables/Task/entities', { headers: { 'If-None-Match': list.headers.etag } });
    assert.equal(again.status, 304);
    const report = await raw(s.port, '/csp-report', { method: 'POST', headers: { 'Content-Type': 'application/csp-report' }, body: JSON.stringify({ 'csp-report': { 'effective-directive': 'img-src', disposition: 'report' } }) });
    assert.equal(report.status, 204);
    for (const [what, r] of [['the 304', again], ['the 204', report]]) {
      assert.equal(r.headers['content-length'], undefined, `${what} names no length`);
      assert.equal(r.headers['transfer-encoding'], undefined, `${what} is not chunked`);
      assert.equal(r.bytes.length, 0, `${what} has no body`);
    }
  } finally { s.close(); }
});

test('a redirect to the public origin carries a zero length instead of an empty chunked body (Issue #1645)', { timeout: 60_000 }, async () => {
  const s = await serving(workspace(), { origin: 'https://weave.example.com', allowedHosts: ['old.example.com'] });
  try {
    const r = await raw(s.port, '/start', { headers: { Host: 'old.example.com' } });
    assert.equal(r.status, 308);
    assert.equal(r.headers.location, 'https://weave.example.com/start');
    assert.equal(r.headers['content-length'], '0');
    assert.equal(r.headers['transfer-encoding'], undefined);
  } finally { s.close(); }
});
