/* Feature #148: fast in-app navigation.
   The API was never the bottleneck (schema ~3ms, query <1ms); the wait was
   client policy — the rope showed on every hash route and padded any >200ms
   nav to a full 2s cycle, hiding the skeleton it painted over. These tests
   pin the server half: statics answer If-Modified-Since with 304 so a
   workspace switch (a genuine full page load) transfers headers, not
   megabytes — and an unknown page path gets a branded 404 page, not a
   plain-text shrug. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

async function withServer(fn) {
  const { server, port } = await startServer(new Weave(), { port: 0 });
  try {
    await fn((path, opts) => fetch(`http://127.0.0.1:${port}${path}`, opts));
  } finally {
    server.close();
  }
}

test('statics carry Last-Modified and answer If-Modified-Since with 304', async () => {
  await withServer(async (get) => {
    const first = await get('/app.js');
    assert.equal(first.status, 200);
    const lastMod = first.headers.get('last-modified');
    assert.ok(lastMod, 'no Last-Modified means every workspace switch re-downloads ~1MB');
    assert.equal(first.headers.get('cache-control'), 'no-cache', 'revalidate, never trust blindly');

    const again = await get('/app.js', { headers: { 'If-Modified-Since': lastMod } });
    assert.equal(again.status, 304);
    assert.equal((await again.text()).length, 0, 'a 304 has no body');

    // A stale copy still gets the real file.
    const stale = await get('/app.js', { headers: { 'If-Modified-Since': new Date(0).toUTCString() } });
    assert.equal(stale.status, 200);
  });
});

test('an unknown page path gets the branded 404 page', async () => {
  await withServer(async (get) => {
    const res = await get('/no/such/page');
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const body = await res.text();
    assert.match(body, /weave/i);
    assert.match(body, /href="\/"/, 'the page must offer a way home');
  });
});

test('an unknown workspace gets the 404 page for navigation, JSON for API', async () => {
  await withServer(async (get) => {
    const page = await get('/w/no-such-workspace/');
    assert.equal(page.status, 404);
    assert.match(page.headers.get('content-type'), /text\/html/);

    const api = await get('/w/no-such-workspace/api/schema');
    assert.equal(api.status, 404);
    assert.match(api.headers.get('content-type'), /application\/json/);
    assert.equal((await api.json()).code, 'not-found');
  });
});

test('unknown API routes still answer JSON, not the 404 page', async () => {
  await withServer(async (get) => {
    const res = await get('/api/no-such-route');
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type'), /application\/json/);
  });
});

test('the 404 page is self-contained and theme-aware', () => {
  const page = readFileSync(join(ROOT, 'public/404.html'), 'utf8');
  assert.doesNotMatch(page, /https?:\/\//, 'no external hosts — the page must render offline');
  assert.match(page, /prefers-color-scheme: dark/, 'both themes, like every weave surface');
  assert.match(page, /\/brand\/weave-mark/, 'the mark identifies whose 404 this is');
});
