import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { gunzipSync, gzipSync } from 'node:zlib';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { gzipOutcome, createByteCache, COMPRESSED_CACHE_BYTES } from '../src/server.js';
import { withServer } from './lib/fixtures.mjs';

function raw(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

const settle = async (read, done, tries = 200) => {
  let got = await read();
  for (let i = 0; i < tries && !done(got); i++) {
    await new Promise((r) => setTimeout(r, 10));
    got = await read();
  }
  return got;
};

const BROWSER = { 'Accept-Encoding': 'gzip, deflate, br' };
const isBrotli = (res) => res.headers['content-encoding'] === 'br';

function deals(n) {
  const w = new Weave();
  w.createSpace({ name: 'Sales' });
  const t = w.createTable({ space: 'Sales', name: 'Deals' });
  return { w, rows: Array.from({ length: n }, (_, i) => w.createEntity(t.id, { Name: `Deal ${i}` })) };
}

test('a page built per request is gzipped on the way out and never cached, so it never pays for Brotli (Issue #1638)', () => {
  const cache = new Map();
  const page = '<p>a record page</p>'.repeat(200);
  for (const policy of ['no-cache', 'no-store']) {
    const out = gzipOutcome({ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': policy, ETag: 'W/"0123456789abcdef"' }, body: page }, 'gzip, deflate, br', { cache, path: '/e/1' });
    assert.equal(out.headers['Content-Encoding'], 'gzip');
    assert.equal(gunzipSync(out.body).toString(), page);
  }
  assert.equal(cache.size, 0, 'nothing a single request built may stay behind in the cache');
});

test('the compression cache holds at most its byte cap and lets the least recently used copy go first (Issue #1638)', () => {
  const cache = createByteCache(100);
  const bytes = (n) => Buffer.alloc(n);
  cache.set('a', bytes(40));
  cache.set('b', bytes(40));
  assert.equal(cache.bytes, 80);
  assert.equal(cache.get('a').length, 40, 'a read makes a the most recently used');
  cache.set('c', bytes(40));
  assert.equal(cache.get('b'), undefined, 'b was the least recently used, so it went');
  assert.deepEqual([cache.get('a')?.length, cache.get('c')?.length], [40, 40]);
  assert.equal(cache.bytes, 80);
  cache.set('a', bytes(90));
  assert.deepEqual([cache.size, cache.bytes], [1, 90], 'a replaced copy counts once, and room is made for it');
  cache.set('huge', bytes(101));
  assert.equal(cache.get('huge'), undefined, 'a copy bigger than the whole cap is never kept');
  assert.equal(cache.bytes, 90);
  cache.set('pending', null);
  assert.equal(cache.get('pending'), null, 'a Brotli job in flight holds its key at no cost');
  assert.equal(cache.delete('a'), true);
  assert.equal(cache.delete('a'), false);
  assert.deepEqual([cache.size, cache.bytes], [1, 0]);
});

test('compressed statics stay under the byte cap however many paths ask, and every answer still inflates (Issue #1638)', () => {
  const cap = 1024;
  const cache = createByteCache(cap);
  const sheet = (i) => ({ status: 200, headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache', ETag: `W/"${i}"` }, body: `.rule-${i} { color: #${String(i).padStart(6, '0')}; }\n`.repeat(200) });
  let newest;
  for (let i = 0; i < 64; i++) {
    newest = gzipOutcome(sheet(i), 'gzip', { cache, path: `/sheet-${i}.css` });
    assert.equal(gunzipSync(newest.body).toString(), sheet(i).body);
    assert.ok(cache.bytes <= cap, `${cache.bytes} bytes cached after ${i + 1} sheets`);
  }
  assert.ok(cache.size < 64, 'the oldest copies made room');
  assert.equal(gzipOutcome(sheet(63), 'gzip', { cache, path: '/sheet-63.css' }).body, newest.body, 'the newest copy is still a hit');
});

test("the server's cap holds a gzip and a Brotli copy of every compressible public file, so statics never churn (Issue #1638)", () => {
  const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
  const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : [join(dir, d.name)]));
  const gzip = files(PUBLIC).filter((f) => /\.(?:html|m?js|css|svg|json)$/.test(f)).map((f) => readFileSync(f)).filter((b) => b.length >= 1024)
    .reduce((n, b) => n + gzipSync(b).length, 0);
  assert.ok(COMPRESSED_CACHE_BYTES >= 2 * gzip, `the cap is ${COMPRESSED_CACHE_BYTES} bytes; gzip alone needs ${gzip}`);
});

test('a permalink page answers gzip every time and is never compressed to Brotli in the background (Issue #1638)', async () => {
  const { w, rows: [row] } = deals(1);
  await withServer(w, async ({ port }) => {
    const first = await raw(port, `/e/${row.id}`, BROWSER);
    assert.equal(first.status, 200);
    assert.equal(first.headers['content-encoding'], 'gzip');
    const later = await settle(() => raw(port, `/e/${row.id}`, BROWSER), isBrotli, 50);
    assert.equal(later.status, 200);
    assert.equal(later.headers['content-encoding'], 'gzip', 'a Brotli copy means the page went into the compression cache');
    assert.match(gunzipSync(later.body).toString(), /Deal 0/);
  });
});

test('an escaped spelling of an asset path shares the compressed copy of the path it names (Issue #1638)', async () => {
  await withServer(new Weave(), async ({ port }) => {
    const plain = await settle(() => raw(port, '/app.js', BROWSER), isBrotli);
    assert.equal(plain.headers['content-encoding'], 'br');
    const escaped = await raw(port, '/%61pp.js', BROWSER);
    assert.equal(escaped.status, 200);
    assert.equal(escaped.headers['content-encoding'], 'br', 'a new cache key per spelling would answer gzip and start another Brotli job');
    assert.ok(escaped.body.equals(plain.body));
  });
});
