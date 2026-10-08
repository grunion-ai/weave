import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const withServer = async (fn) => {
  const { server } = await startServer(new Weave(), { port: 0 });
  try { await fn((path, init) => fetch(`http://127.0.0.1:${server.address().port}${path}`, init)); } finally { server.close(); }
};

test('vendored files the editor loads on its own stay cached for an hour and revalidate by ETag after (Issue #735)', async () => {
  await withServer(async (get) => {
    for (const path of ['/vendor/vditor/dist/js/icons/ant.js', '/vendor/vditor/dist/js/lute/lute.min.js', '/vendor/vditor/dist/css/content-theme/light.css']) {
      const res = await get(path);
      assert.equal(res.status, 200, path);
      assert.equal(res.headers.get('cache-control'), 'public, max-age=3600', `${path} is reused across row opens`);
      const etag = res.headers.get('etag');
      assert.ok(etag, `${path} carries a validator`);
      assert.equal((await get(path, { headers: { 'If-None-Match': etag } })).status, 304);
    }
  });
});

test('first-party files asked for without their version still revalidate every time (Issue #735)', async () => {
  await withServer(async (get) => {
    for (const path of ['/app.js', '/style.css']) assert.equal((await get(path)).headers.get('cache-control'), 'no-cache', path);
  });
});
