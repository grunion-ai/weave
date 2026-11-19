import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tempDir } from './lib/temp.mjs';

process.env.WEAVE_KEYSTORE ??= join(tempDir('weave-health-'), 'keystore.json');
const { Weave } = await import('../src/engine.js');
const { startServer, appTiming } = await import('../src/server.js');

const PREFIX = 'app;dur=';

test('appTiming names the app share of the wait in milliseconds (Issue #1268)', () => {
  assert.equal(appTiming(0n), 'app;dur=0.0');
  assert.equal(appTiming(1_500_000n), 'app;dur=1.5');
  assert.equal(appTiming(123_456_789n), 'app;dur=123.5');
});

test('GET /api/health carries Server-Timing, so the edge share is the rest of the wait (Issue #1268)', async () => {
  const { server, port } = await startServer(new Weave(), { port: 0 });
  try {
    const began = Date.now();
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    const wall = Date.now() - began;
    assert.equal(res.status, 200);
    const timing = res.headers.get('server-timing');
    assert.match(String(timing), /^app;dur=\d+\.\d$/, 'one metric, the app duration in milliseconds');
    const app = Number(String(timing).slice(PREFIX.length));
    assert.ok(app >= 0, `the app share is not negative (${app} ms)`);
    assert.ok(app <= wall + 50, `the app share (${app} ms) sits inside the caller's own wait (${wall} ms)`);
  } finally { server.close(); }
});

test('only the health route reports its app duration (Issue #1268)', async () => {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  const { server, port } = await startServer(w, { port: 0 });
  try {
    for (const path of ['/api/workspace', '/api/nope', '/app.js', '/api/health/build']) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(res.headers.get('server-timing'), null, `${path} keeps its handling time to itself`);
    }
  } finally { server.close(); }
});
