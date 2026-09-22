/* Issue #313: content-hashed asset URLs with immutable caching, and a boot
   that does not block the parser once per script.
   A warm load of `/` made 32 static requests, 24 of them answered 304: every
   asset carried `no-cache`, so the browser revalidated each one, one round
   trip apiece. weave has no build step, so the Node adapter versions the
   shell at serve time: every local src/href/import in index.html gains
   `?v=<content hash>`, and an asset asked for at its current hash is sent
   `immutable`. The shell itself stays `no-cache`, with an ETag drawn from the
   bytes it serves, because an asset can change under an unchanged
   index.html. The Worker's Assets binding serves public/ untouched, so the
   file on disk keeps plain URLs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer, createAssetVersions } from '../src/server.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
const IMMUTABLE = 'public, max-age=31536000, immutable';

async function withServer(fn) {
  const { server, port } = await startServer(new Weave(), { port: 0 });
  try {
    await fn((path, opts) => fetch(`http://127.0.0.1:${port}${path}`, opts));
  } finally {
    server.close();
  }
}

const localRefs = (html) => [...html.matchAll(/(?:\b(?:src|href)="|\bfrom ")(\/[^"#?]+\.(?:js|mjs|css|svg|ico))(\?v=[0-9a-f]+)?"/g)]
  .map((m) => ({ url: m[1], v: m[2]?.slice(3) ?? null }));

test('the served shell versions every local asset it references', async () => {
  await withServer(async (get) => {
    const res = await get('/');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-cache', 'the shell always revalidates');
    const refs = localRefs(await res.text());
    assert.ok(refs.length >= 30, `expected the full asset list, saw ${refs.length}`);
    for (const { url, v } of refs) {
      assert.ok(v, `${url} is served without a content version`);
      const want = createHash('sha1').update(readFileSync(join(ROOT, 'public', url))).digest('hex').slice(0, 12);
      assert.equal(v, want, `${url}'s version is the hash of its content`);
    }
    assert.ok(refs.some((r) => r.url === '/vendor/lean-qr.mjs'), 'the module import is versioned too');
  });
});

test('an asset asked for at its current hash is immutable; any other ask revalidates', async () => {
  await withServer(async (get) => {
    const { v } = localRefs(await (await get('/')).text()).find((r) => r.url === '/app.js');
    const hit = await get(`/app.js?v=${v}`);
    assert.equal(hit.status, 200);
    assert.equal(hit.headers.get('cache-control'), IMMUTABLE);
    for (const ask of ['/app.js', '/app.js?v=000000000000']) {
      const res = await get(ask);
      assert.equal(res.headers.get('cache-control'), 'no-cache', `${ask} must revalidate: its bytes may not match the version it names`);
    }
  });
});

test("the shell's validator follows the bytes it serves, not index.html's mtime", async () => {
  await withServer(async (get) => {
    const res = await get('/');
    const body = await res.text();
    const etag = res.headers.get('etag');
    assert.ok(etag, 'the shell carries an ETag');
    assert.equal(res.headers.get('last-modified'), null, "an unchanged index.html's mtime would 304 a shell whose assets moved");
    assert.ok(etag.includes(createHash('sha1').update(body).digest('hex').slice(0, 16)), 'ETag is a hash of the served shell');
    const again = await get('/', { headers: { 'If-None-Match': etag } });
    assert.equal(again.status, 304);
    const since = await get('/', { headers: { 'If-Modified-Since': new Date(Date.now() + 86400e3).toUTCString() } });
    assert.equal(since.status, 200, 'the shell ignores If-Modified-Since');
  });
});

test('versions are cached per mtime and follow a content change', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-assets-'));
  writeFileSync(join(dir, 'a.js'), 'one');
  const assets = createAssetVersions(dir);
  const v1 = assets.version('/a.js');
  assert.match(v1, /^[0-9a-f]{12}$/);
  assert.equal(assets.version('/a.js'), v1);
  writeFileSync(join(dir, 'a.js'), 'two');
  utimesSync(join(dir, 'a.js'), new Date(), new Date(Date.now() + 5000));
  const v2 = assets.version('/a.js');
  assert.notEqual(v2, v1, 'a changed file gets a new version');
  assert.equal(assets.version('/missing.js'), null);
  assert.equal(
    assets.rewrite('<script src="/a.js" defer></script><a href="/w/weave/">x</a><script src="/missing.js"></script>'),
    `<script src="/a.js?v=${v2}" defer></script><a href="/w/weave/">x</a><script src="/missing.js"></script>`,
    'only existing files are versioned; page links are left alone',
  );
});

test('every classic boot script is deferred; the file on disk keeps plain URLs', () => {
  const tags = [...INDEX.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
  const classic = tags.filter((a) => /\bsrc=/.test(a));
  assert.ok(classic.length >= 24, `expected the boot list, saw ${classic.length}`);
  for (const a of classic) assert.match(a, /\bdefer\b/, `<script${a}> blocks the parser`);
  // The Worker's Assets binding serves this file as-is (Issue #231): a baked-in
  // version would name bytes the binding no longer holds after the next edit.
  assert.doesNotMatch(INDEX, /\?v=/);
  assert.ok(INDEX.indexOf('/vendor/lean-qr.mjs') < INDEX.indexOf('/app.js'), 'the lean-qr module is queued before app.js, so it runs first');
});
