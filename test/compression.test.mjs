import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { gunzipSync, brotliDecompressSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer, acceptsGzip, acceptsCoding, gzipOutcome } from '../src/server.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

function raw(port, path, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function withServer(fn) {
  const weave = new Weave();
  weave.createSpace({ name: 'Sales' });
  weave.createTable({ space: 'Sales', name: 'Deals' });
  for (let i = 0; i < 20; i++) weave.addField('Sales/Deals', { name: `Field ${i}`, type: 'text' });
  const { server, port } = await startServer(weave, { port: 0 });
  try { await fn(port); } finally { server.close(); }
}

test('app.js goes out gzipped when the browser accepts gzip, and inflates to the file', async () => {
  await withServer(async (port) => {
    const file = readFileSync(join(PUBLIC, 'app.js'));
    const res = await raw(port, '/app.js', { 'Accept-Encoding': 'gzip, deflate, br' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-encoding'], 'gzip');
    assert.match(res.headers.vary ?? '', /accept-encoding/i, 'a cache must key on the encoding');
    assert.ok(res.body.length < file.length * 0.4, `gzip should cut app.js well below 40% (got ${res.body.length} of ${file.length})`);
    assert.ok(gunzipSync(res.body).equals(file), 'the inflated body is the file, byte for byte');
  });
});

test('a request without Accept-Encoding gets the plain file', async () => {
  await withServer(async (port) => {
    const file = readFileSync(join(PUBLIC, 'app.js'));
    const res = await raw(port, '/app.js');
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-encoding'], undefined);
    assert.ok(res.body.equals(file));
    const refused = await raw(port, '/app.js', { 'Accept-Encoding': 'gzip;q=0, identity' });
    assert.equal(refused.headers['content-encoding'], undefined, 'q=0 is a refusal');
  });
});

test('/api/schema JSON is gzipped too and parses to the same schema', async () => {
  await withServer(async (port) => {
    const plain = await raw(port, '/api/schema');
    const zipped = await raw(port, '/api/schema', { 'Accept-Encoding': 'gzip' });
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.equal(zipped.headers['content-encoding'], 'gzip');
    assert.ok(zipped.body.length < plain.body.length, 'compression must shrink the schema');
    assert.deepEqual(JSON.parse(gunzipSync(zipped.body)), JSON.parse(plain.body));
    assert.ok(zipped.headers['x-weave-schema-version'], 'route headers survive compression');
  });
});

test('binary and tiny answers are left alone', async () => {
  await withServer(async (port) => {
    const png = await raw(port, '/brand/favicon-32.png', { 'Accept-Encoding': 'gzip' });
    assert.equal(png.status, 200);
    assert.equal(png.headers['content-encoding'], undefined, 'PNG is already compressed');
    const health = await raw(port, '/api/health', { 'Accept-Encoding': 'gzip' });
    assert.equal(health.status, 200);
    assert.equal(health.headers['content-encoding'], undefined, 'a few hundred bytes cost more to gzip than to send');
  });
});

test('statics carry an ETag and answer If-None-Match with 304, gzipped or not', async () => {
  await withServer(async (port) => {
    const first = await raw(port, '/app.js', { 'Accept-Encoding': 'gzip' });
    const etag = first.headers.etag;
    assert.ok(etag, 'no ETag means a revalidation has nothing to match');
    const again = await raw(port, '/app.js', { 'If-None-Match': etag, 'Accept-Encoding': 'gzip' });
    assert.equal(again.status, 304);
    assert.equal(again.body.length, 0, 'a 304 has no body');
    assert.equal(again.headers.etag, etag);
    const plain = await raw(port, '/app.js', { 'If-None-Match': etag });
    assert.equal(plain.status, 304, 'the ETag is weak: one validator for both encodings');
    const other = await raw(port, '/app.js', { 'If-None-Match': 'W/"nope"' });
    assert.equal(other.status, 200);
    const css = await raw(port, '/style.css');
    assert.notEqual(css.headers.etag, etag, 'each file has its own validator');
  });
});

test('acceptsGzip reads the header the way RFC 9110 says', () => {
  assert.equal(acceptsGzip('gzip'), true);
  assert.equal(acceptsGzip('gzip, deflate, br'), true);
  assert.equal(acceptsGzip('br;q=1.0, gzip;q=0.8'), true);
  assert.equal(acceptsGzip('*'), true);
  assert.equal(acceptsGzip('GZIP'), true);
  assert.equal(acceptsGzip(''), false);
  assert.equal(acceptsGzip(undefined), false);
  assert.equal(acceptsGzip('identity'), false);
  assert.equal(acceptsGzip('gzip;q=0'), false);
  assert.equal(acceptsGzip('gzip;q=0.0, *'), false, 'an explicit gzip refusal beats the wildcard');
  assert.equal(acceptsGzip('br, x-gzip'), false);
});

test('the gzip cache never hands one file the bytes of another with the same size and mtime', () => {
  const cache = new Map();
  const tag = 'W/"400-1"';
  const out = (text, path) => gzipOutcome({ status: 200, headers: { 'Content-Type': 'text/css', ETag: tag }, body: text.repeat(1024) }, 'gzip', { cache, path });
  const a = out('a', '/a.css');
  const b = out('b', '/b.css');
  assert.equal(gunzipSync(a.body).toString()[0], 'a');
  assert.equal(gunzipSync(b.body).toString()[0], 'b');
  assert.equal(out('z', '/a.css').body, a.body, 'the same path and validator is a cache hit');
});

const settle = async (read, ok, tries = 200) => {
  let got = await read();
  for (let i = 0; i < tries && !ok(got); i++) {
    await new Promise((r) => setTimeout(r, 10));
    got = await read();
  }
  return got;
};

test('a static asset goes out as Brotli once it is compressed off the request path, and inflates to the file (Issue #989)', async () => {
  await withServer(async (port) => {
    const file = readFileSync(join(PUBLIC, 'app.js'));
    const first = await raw(port, '/app.js', { 'Accept-Encoding': 'gzip, deflate, br' });
    assert.equal(first.headers['content-encoding'], 'gzip', 'the first request does not wait on Brotli');
    const res = await settle(() => raw(port, '/app.js', { 'Accept-Encoding': 'gzip, deflate, br' }), (r) => r.headers['content-encoding'] === 'br');
    assert.equal(res.headers['content-encoding'], 'br');
    assert.match(res.headers.vary ?? '', /accept-encoding/i);
    assert.ok(brotliDecompressSync(res.body).equals(file), 'the inflated body is the file, byte for byte');
    const gz = await raw(port, '/app.js', { 'Accept-Encoding': 'gzip' });
    assert.equal(gz.headers['content-encoding'], 'gzip', 'a client without br still gets gzip');
    assert.ok(res.body.length < gz.body.length * 0.85, `Brotli should beat gzip by 15% or more (br ${res.body.length}, gzip ${gz.body.length})`);
    const refused = await raw(port, '/app.js', { 'Accept-Encoding': 'gzip, br;q=0' });
    assert.equal(refused.headers['content-encoding'], 'gzip', 'br;q=0 is a refusal');
  });
});

test('a response without a validator stays gzip, so nothing uncached pays for Brotli (Issue #989)', () => {
  const cache = new Map();
  const body = 'x'.repeat(4096);
  const out = gzipOutcome({ status: 200, headers: { 'Content-Type': 'application/json' }, body }, 'gzip, br', { cache, path: '/api/schema' });
  assert.equal(out.headers['Content-Encoding'], 'gzip');
  assert.equal(cache.size, 0);
});

test('acceptsCoding reads q-values per coding (Issue #989)', () => {
  assert.equal(acceptsCoding('gzip, deflate, br', 'br'), true);
  assert.equal(acceptsCoding('br;q=0, gzip', 'br'), false);
  assert.equal(acceptsCoding('gzip', 'br'), false);
  assert.equal(acceptsCoding('*', 'br'), true);
  assert.equal(acceptsCoding('BR', 'br'), true);
});
