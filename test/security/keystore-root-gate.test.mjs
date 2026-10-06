import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WEAVE_KEYSTORE = join(mkdtempSync(join(tmpdir(), 'weave-ks-')), 'keystore.json');
const { Weave } = await import('../../src/engine.js');
const { createWorkspaceHub } = await import('../../src/server.js');
const { client } = await import('../lib/fixtures.mjs');

const freshKeystore = () => { process.env.WEAVE_KEYSTORE = join(mkdtempSync(join(tmpdir(), 'weave-ks-')), 'keystore.json'); };

function build() {
  freshKeystore();
  const root = new Weave();
  root.updateWorkspace({ name: 'root' });
  const open = new Weave();
  open.updateWorkspace({ name: 'open' });
  const mem = new Weave();
  mem.updateWorkspace({ name: 'mem' });
  const hub = createWorkspaceHub(root, { workspaces: { open, mem } });
  const admin = root.createAccount({ name: 'root-admin', role: 'admin' });
  const writer = root.createAccount({ name: 'root-writer', role: 'writer' });
  const reader = root.createAccount({ name: 'root-reader', role: 'reader' });
  const memAdmin = mem.createAccount({ name: 'mem-admin', role: 'admin' });
  root.actor = 'root-admin';
  root.setKey('k', 's3cret');
  root.actor = 'root-writer';
  root.setKey('w', 'writer-secret');
  return { hub, root, open, mem, call: client(hub), admin, writer, reader, memAdmin };
}

test('no accounts anywhere: keys stay open to the local operator, as today', async () => {
  freshKeystore();
  const root = new Weave();
  root.updateWorkspace({ name: 'solo' });
  const call = client(createWorkspaceHub(root));
  assert.equal((await call('POST', '/api/keys', { body: { name: 'k', value: 'v' } })).status, 201);
  assert.equal((await call('GET', '/api/keys')).status, 200);
  const r = await call('POST', '/api/keys/k/reveal');
  assert.equal(r.status, 200);
  assert.equal(r.json.value, 'v');
  assert.equal((await call('DELETE', '/api/keys/k')).status, 200);
});

test('no credentials, root has accounts: every key route is refused through an account-less member', async () => {
  const { call, root } = build();
  assert.equal((await call('GET', '/w/open/api/keys')).status, 401);
  assert.equal((await call('POST', '/w/open/api/keys/k/reveal')).status, 401);
  assert.equal((await call('POST', '/w/open/api/keys', { body: { name: 'k', value: 'x' } })).status, 401);
  assert.equal((await call('DELETE', '/w/open/api/keys/k')).status, 401);
  assert.equal((await call('GET', '/api/keys')).status, 401);
  assert.equal(root.resolveKey('k'), 's3cret', 'the secret was not overwritten');
});

test('reader and writer of the root are not key admins; the writer reveals and manages only what is theirs', async () => {
  const { call, reader, writer, root } = build();
  assert.equal((await call('GET', '/api/keys', { token: reader.token })).status, 403);
  assert.equal((await call('POST', '/api/keys/k/reveal', { token: reader.token })).status, 403);
  assert.equal((await call('GET', '/api/keys', { token: writer.token })).status, 403);
  assert.equal((await call('POST', '/api/keys/k/reveal', { token: writer.token })).status, 403, 'not on the access list');
  assert.equal((await call('POST', '/api/keys', { token: writer.token, body: { name: 'k', value: 'x' } })).status, 403, 'not the owner');
  assert.equal((await call('DELETE', '/api/keys/k', { token: writer.token })).status, 403, 'not the owner');
  assert.equal((await call('POST', '/api/keys', { token: writer.token, body: { name: 'new', value: 'x' } })).status, 403, 'creating needs an admin');
  const own = await call('POST', '/api/keys/w/reveal', { token: writer.token });
  assert.equal(own.status, 200);
  assert.equal(own.json.value, 'writer-secret');
  assert.equal((await call('POST', '/api/keys', { token: writer.token, body: { name: 'w', value: 'rotated' } })).status, 201);
  assert.equal(root.resolveKey('w'), 'rotated');
  root.actor = 'root-admin';
  root.grantKey('k', 'root-writer');
  assert.equal((await call('POST', '/api/keys/k/reveal', { token: writer.token })).status, 200);
  assert.equal((await call('DELETE', '/api/keys/k', { token: writer.token })).status, 403);
  assert.equal((await call('DELETE', '/api/keys/w', { token: writer.token })).status, 200);
});

test('an admin of a member workspace only is not a key admin', async () => {
  const { call, memAdmin, root } = build();
  assert.equal((await call('GET', '/w/mem/api/keys', { token: memAdmin.token })).status, 401);
  assert.equal((await call('POST', '/w/mem/api/keys/k/reveal', { token: memAdmin.token })).status, 401);
  assert.equal((await call('DELETE', '/w/mem/api/keys/k', { token: memAdmin.token })).status, 401);
  assert.equal(root.hasKey('k'), true);
});

test('the root admin manages keys at the root, and through a member with a root session', async () => {
  const { call, admin, root } = build();
  assert.equal((await call('GET', '/api/keys', { token: admin.token })).status, 200);
  const r = await call('POST', '/api/keys/k/reveal', { token: admin.token });
  assert.equal(r.status, 200);
  assert.equal(r.json.value, 's3cret');
  const { token: session } = root.createSession('root-admin');
  const viaMember = await call('POST', '/w/open/api/keys/k/reveal', { cookie: session });
  assert.equal(viaMember.status, 200);
  assert.equal(viaMember.json.value, 's3cret');
  assert.equal((await call('POST', '/api/keys', { token: admin.token, body: { name: 'w', value: 'admin-set' } })).status, 201, 'an admin may overwrite any key');
  assert.equal((await call('DELETE', '/w/open/api/keys/w', { cookie: session })).status, 200);
});

test('engine: a member engine decides reveal against the root accounts', () => {
  const { open } = build();
  open.actor = 'someone';
  assert.throws(() => open.revealKey('k'), /not shared with you/);
  open.actor = 'root-admin';
  assert.equal(open.revealKey('k'), 's3cret');
});
