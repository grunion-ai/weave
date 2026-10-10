import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WEAVE_KEYSTORE = join(mkdtempSync(join(tmpdir(), 'weave-ks-')), 'keystore.json');
const { ROOT } = await import('../lib/source.mjs');
const { Weave } = await import('../../src/engine.js');
const { createWorkspaceHub } = await import('../../src/server.js');
const { createRequestHandler } = await import('../../src/routes.js');
const { bootAndStop } = await import('../lib/serve-fixture.mjs');

const BIN = join(ROOT, 'bin', 'weave.js');
const TOKEN = 'bootstrap-secret-for-the-test-0123';
const ENV = { WEAVE_UPDATE_CHECK: 'off', WEAVE_KEYSTORE: process.env.WEAVE_KEYSTORE };

function serve(t, { host, env = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'weave-bootstrap-'));
  const child = spawn(process.execPath, [BIN, 'serve', '--port', '0', '--host', host, '--data', join(dir, 'ws.db')], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...ENV, ...env },
  });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  return child;
}

function handler({ bootstrapToken = null } = {}) {
  const root = new Weave();
  root.updateWorkspace({ name: 'root' });
  const member = new Weave();
  member.updateWorkspace({ name: 'member' });
  const hub = createWorkspaceHub(root, { workspaces: { member } });
  const handle = createRequestHandler(hub, { version: 'test', bootstrapToken });
  const call = async (method, path, { body, token } = {}) => {
    const headers = { host: 'localhost:4400' };
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await handle({ method, path, searchParams: new URLSearchParams(), header: (n) => headers[n.toLowerCase()], readBody: async () => body ?? {}, remote: '127.0.0.1' });
    let json = null;
    try { json = JSON.parse(res.body); } catch {}
    return { status: res.status, json };
  };
  return { root, member, call };
}

test('serve refuses a non-loopback bind while the hub root has no account and no WEAVE_BOOTSTRAP_TOKEN is set', async (t) => {
  const child = serve(t, { host: '0.0.0.0', env: { WEAVE_BOOTSTRAP_TOKEN: '' } });
  await assert.rejects(bootAndStop(child, { timeout: 60000 }), /serve exited 1:[\s\S]*WEAVE_BOOTSTRAP_TOKEN/);
});

test('serve refuses a bootstrap token shorter than sixteen characters', async (t) => {
  const child = serve(t, { host: '0.0.0.0', env: { WEAVE_BOOTSTRAP_TOKEN: 'short' } });
  await assert.rejects(bootAndStop(child, { timeout: 60000 }), /serve exited 1:[\s\S]*sixteen/);
});

test('loopback with no account still boots with no token, as today', async (t) => {
  const child = serve(t, { host: '127.0.0.1', env: { WEAVE_BOOTSTRAP_TOKEN: '' } });
  const log = await bootAndStop(child, { timeout: 60000 });
  assert.match(log, /Weave running/);
});

test('with WEAVE_BOOTSTRAP_TOKEN set a non-loopback bind boots, and the log names the token as the way in', async (t) => {
  const child = serve(t, { host: '0.0.0.0', env: { WEAVE_BOOTSTRAP_TOKEN: TOKEN } });
  const log = await bootAndStop(child, { timeout: 60000 });
  assert.match(log, /Weave running/);
  assert.match(log, /WEAVE_BOOTSTRAP_TOKEN/);
  assert.doesNotMatch(log, new RegExp(TOKEN), 'the token itself is never printed');
});

test('the bootstrap token is an architect bearer on the root and on a member while the root has no account', async () => {
  const { root, member, call } = handler({ bootstrapToken: TOKEN });
  assert.equal((await call('POST', '/api/spaces', { token: 'wrong-token-of-the-same-length-00', body: { name: 'X' } })).status, 401);
  assert.equal((await call('POST', '/api/spaces', { token: TOKEN, body: { name: 'Dev' } })).status, 201);
  assert.equal((await call('POST', '/w/member/api/spaces', { token: TOKEN, body: { name: 'Ops' } })).status, 201);
  assert.equal(root.listAudit({ limit: 1 })[0].actor, 'bootstrap');
  const made = await call('POST', '/api/accounts', { token: TOKEN, body: { name: 'owner', role: 'architect' } });
  assert.equal(made.status, 201);
  assert.match(made.json.token, /^wv_/);
  assert.equal(root.listAccounts().length, 1);
  assert.equal((await call('POST', '/api/spaces', { token: TOKEN, body: { name: 'Late' } })).status, 401, 'the first account retires the bootstrap token');
  assert.equal((await call('GET', '/api/schema', { token: TOKEN })).status, 401);
  assert.equal((await call('POST', '/w/member/api/spaces', { token: TOKEN, body: { name: 'Late' } })).status, 401);
  assert.equal((await call('POST', '/api/spaces', { token: made.json.token, body: { name: 'Owned' } })).status, 201);
  assert.equal(member.listSpaces().length, 1);
});

test('with no bootstrap token configured, nothing is accepted as one', async () => {
  const { call } = handler();
  assert.equal((await call('POST', '/api/accounts', { token: TOKEN, body: { name: 'owner', role: 'architect' } })).status, 401);
  assert.equal((await call('POST', '/api/accounts', { token: '', body: { name: 'owner', role: 'architect' } })).status, 201, 'the loopback, account-less path is unchanged');
});
