import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tempDir } from './lib/temp.mjs';

const dir = tempDir('weave-keys-share-');
process.env.WEAVE_KEYSTORE = join(dir, 'keystore.json');
const { Weave } = await import('../src/engine.js');
const { startServer } = await import('../src/server.js');

test.after(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
async function serve() {
  process.env.WEAVE_KEYSTORE = join(dir, `keystore-${++n}.json`);
  const w = new Weave();
  const admin = w.createAccount({ name: 'root', role: 'admin' });
  const root = admin.token;
  const bob = w.createAccount({ name: 'bob', role: 'writer' }).token;
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { token = root, body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json() };
  };
  assert.equal((await call('POST', '/api/keys', { body: { name: 'stripe', value: 'census-secret' } })).status, 201);
  return { w, rootId: admin.account.id, bob, call, stop: () => server.close() };
}

test('DELETE /api/keys/:name/share withdraws an everyone-share, and the reader loses the secret', async () => {
  const { bob, call, stop } = await serve();
  try {
    assert.deepEqual((await call('POST', '/api/keys/stripe/share', { body: { account: true } })).json, { name: 'stripe', shared: true });
    assert.equal((await call('POST', '/api/keys/stripe/reveal', { token: bob })).status, 200, 'shared with everyone, bob reads it');
    const ok = await call('DELETE', '/api/keys/stripe/share');
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json, { name: 'stripe', shared: false });
    assert.equal((await call('POST', '/api/keys/stripe/reveal', { token: bob })).status, 403, 'withdrawn, bob is refused');
  } finally {
    stop();
  }
});

test('DELETE /api/keys/:name/share refuses an unknown key and a caller who is not a key admin', async () => {
  const { bob, call, stop } = await serve();
  try {
    const ghost = await call('DELETE', '/api/keys/ghost/share');
    assert.equal(ghost.status, 404);
    assert.equal(ghost.json.code, 'not-found');
    await call('POST', '/api/keys/stripe/share', { body: { account: true } });
    const self = await call('DELETE', '/api/keys/stripe/share', { token: bob });
    assert.equal(self.status, 403);
    assert.equal(self.json.code, 'forbidden');
    assert.equal((await call('GET', '/api/keys')).json[0].shared, true, 'a refused withdrawal changes nothing');
  } finally {
    stop();
  }
});

test('Issue #1086: DELETE /api/keys/:name/share with a named account answers 200 and revokes nothing', async () => {
  const { w, rootId, bob, call, stop } = await serve();
  try {
    assert.deepEqual((await call('POST', '/api/keys/stripe/share', { body: { account: 'bob' } })).json, { name: 'stripe', shared: ['bob'] });
    const revoked = await call('DELETE', '/api/keys/stripe/share', { body: { account: 'bob' } });
    assert.equal(revoked.status, 200);
    assert.deepEqual(revoked.json, { name: 'stripe', shared: ['bob'] }, 'Issue #1086: the DELETE body is never read, so bob stays on the list');
    assert.equal((await call('POST', '/api/keys/stripe/reveal', { token: bob })).status, 200, 'Issue #1086: bob still reads the secret');
    w.actor = `account:${rootId}`;
    assert.deepEqual(w.revokeKey('stripe', 'bob'), { name: 'stripe', shared: [] }, 'the engine call the route wraps does revoke');
  } finally {
    stop();
  }
});
