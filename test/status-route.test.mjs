import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

test('public status remains readable behind workspace authentication without opening private routes', async (t) => {
  const w = new Weave();
  w.createAccount({ name: 'root', role: 'architect' });
  w.setRequireAuth(true);
  const { server } = await startServer(w, { port: 0, oidc: null });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/status', '/status/']) {
    const res = await fetch(base + path, { redirect: 'manual' });
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(await res.text(), /Service status|System status|Weave status/i);
    const head = await fetch(base + path, { method: 'HEAD', redirect: 'manual' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  }
  for (const path of ['/', '/api/tables', '/api/accounts', '/api/export']) {
    assert.equal((await fetch(base + path, { redirect: 'manual' })).status, 401, path);
  }
  assert.equal((await fetch(base + '/status', { method: 'POST', redirect: 'manual' })).status, 401);
});
