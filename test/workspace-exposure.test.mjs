import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer, createWorkspaceHub, deployTokenFromEnv, setupTokenFromEnv } from '../src/server.js';
import { localRequest } from '../src/routes.js';
import { exposed, probeUrls } from '../scripts/exposure.mjs';

const DEPLOY = 'd'.repeat(40);
const SETUP = 's'.repeat(40);

const hit = (port, host, method, path, { token, body, cookie, headers = {} } = {}) => new Promise((resolve, reject) => {
  const payload = body === undefined ? null : JSON.stringify(body);
  const req = request({
    host: '127.0.0.1', port, method, path,
    headers: { Host: host, ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(payload ? { 'Content-Type': 'application/json' } : {}) },
  }, (res) => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { text += c; });
    res.on('end', () => resolve({ status: res.statusCode, text, json: () => JSON.parse(text) }));
  });
  req.on('error', reject);
  req.end(payload ?? undefined);
});

function hubIn({ requireAuth = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'weave-exposure-'));
  const main = new Weave({ path: join(dir, 'workspace.db'), name: 'Net' });
  main.state.meta.name = 'Net';
  if (requireAuth) main.setRequireAuth(true);
  main.save();
  return { dir, main, done: () => { main.store.close?.(); rmSync(dir, { recursive: true, force: true }); } };
}

test('a hub with a public origin walls every workspace it creates', () => {
  const h = hubIn();
  try {
    const w = createWorkspaceHub(h.main, { walled: true }).create('Guessable');
    assert.equal(w.state.meta.requireAuth, true);
  } finally { h.done(); }
});

test('a hub whose default workspace requires sign-in walls every workspace it creates, origin or not', () => {
  const h = hubIn({ requireAuth: true });
  try {
    const w = createWorkspaceHub(h.main).create('Guessable');
    assert.equal(w.state.meta.requireAuth, true);
  } finally { h.done(); }
});

test('a loopback hub with an open default workspace still creates open workspaces', () => {
  const h = hubIn();
  try {
    const w = createWorkspaceHub(h.main).create('Local');
    assert.equal(!!w.state.meta.requireAuth, false);
  } finally { h.done(); }
});

test('a workspace created over HTTP on a public origin answers its tables to nobody anonymous, by host or by path', async () => {
  const h = hubIn();
  const token = h.main.createAccount({ name: 'root', role: 'architect' }).token;
  const { server, port } = await startServer(h.main, { port: 0, origin: 'http://weave.test', baseDomain: 'weave.test' });
  try {
    const made = await hit(port, 'weave.test', 'POST', '/api/workspaces', { token, body: { name: 'guess' } });
    assert.equal(made.status, 201, made.text);
    assert.equal((await hit(port, 'guess.weave.test', 'GET', '/api/tables')).status, 401);
    assert.equal((await hit(port, 'weave.test', 'GET', '/w/guess/api/tables')).status, 401);
  } finally { server.close(); h.done(); }
});

test('the architect who creates a walled workspace from the app still opens it by path', async () => {
  const h = hubIn({ requireAuth: true });
  h.main.createAccount({ name: 'root', role: 'architect' });
  const cookie = `wv_session_${h.main.state.meta.id}=${h.main.createSession('root').token}`;
  const { server, port } = await startServer(h.main, { port: 0, origin: 'http://weave.test', baseDomain: 'weave.test' });
  try {
    const made = await hit(port, 'weave.test', 'POST', '/api/workspaces', { cookie, body: { name: 'mine' } });
    assert.equal(made.status, 201, made.text);
    assert.equal((await hit(port, 'weave.test', 'GET', made.json().url + 'api/tables', { cookie })).status, 200);
    assert.equal((await hit(port, 'weave.test', 'GET', made.json().url + 'api/tables')).status, 401);
  } finally { server.close(); h.done(); }
});

test('the deploy token reads every workspace name and its wall; any other caller does not', async () => {
  const h = hubIn({ requireAuth: true });
  const open = new Weave({ path: join(h.dir, 'open.db'), name: 'open' });
  open.state.meta.name = 'open';
  open.save();
  open.store.close?.();
  const { server, port } = await startServer(h.main, { port: 0, origin: 'http://weave.test', baseDomain: 'weave.test', deployToken: DEPLOY });
  try {
    const listed = await hit(port, 'weave.test', 'GET', '/_supervisor/workspaces', { token: DEPLOY });
    assert.equal(listed.status, 200, listed.text);
    const byName = Object.fromEntries(listed.json().map((x) => [x.name, x.requireAuth]));
    assert.deepEqual(byName, { Net: true, open: false });
    assert.equal((await hit(port, 'weave.test', 'GET', '/_supervisor/workspaces')).status, 401);
    assert.equal((await hit(port, 'weave.test', 'GET', '/_supervisor/workspaces', { token: 'x'.repeat(40) })).status, 401);
    assert.equal((await hit(port, 'weave.test', 'POST', '/_supervisor/workspaces', { token: DEPLOY })).status, 405);
  } finally { server.close(); h.done(); }
});

test('without a deploy token of 32 characters or more there is no workspace list', async () => {
  assert.equal(deployTokenFromEnv({ WEAVE_DEPLOY_TOKEN: 'short' }), null);
  assert.equal(deployTokenFromEnv({}), null);
  assert.equal(deployTokenFromEnv({ WEAVE_DEPLOY_TOKEN: DEPLOY }), DEPLOY);
  const h = hubIn({ requireAuth: true });
  const { server, port } = await startServer(h.main, { port: 0, origin: 'http://weave.test', baseDomain: 'weave.test', deployToken: null });
  try {
    assert.notEqual((await hit(port, 'weave.test', 'GET', '/_supervisor/workspaces', { token: DEPLOY })).status, 200);
  } finally { server.close(); h.done(); }
});

test('the probe asks each workspace by path and by host', () => {
  assert.deepEqual(probeUrls('Test', { base: 'https://weave.grunion.ai', hostDomain: 'weave.grunion.ai' }), [
    'https://weave.grunion.ai/w/Test/api/tables',
    'https://test.weave.grunion.ai/api/tables',
  ]);
  assert.deepEqual(probeUrls('a b', { base: 'https://weave.grunion.ai' }), ['https://weave.grunion.ai/w/a%20b/api/tables']);
});

test('the probe names every workspace that answers its tables anonymously with 200, unless it is deliberately public', async () => {
  const asked = [];
  const io = {
    list: async () => [{ name: 'Net', requireAuth: true }, { name: 'test', requireAuth: false }, { name: 'docs', requireAuth: false }],
    status: async (url) => { asked.push(url); return /test|docs/.test(url) ? 200 : 401; },
  };
  const found = await exposed(io, { base: 'https://weave.grunion.ai', hostDomain: 'weave.grunion.ai', publicNames: ['DOCS'] });
  assert.deepEqual(found.map((x) => [x.name, x.url, x.status]), [
    ['test', 'https://weave.grunion.ai/w/test/api/tables', 200],
    ['test', 'https://test.weave.grunion.ai/api/tables', 200],
  ]);
  assert.equal(asked.length, 6);
});

test('promote.yml runs the probe on production after every promotion, with the production deploy token', () => {
  const promoteJob = readFileSync('.github/workflows/promote.yml', 'utf8').split('\n  promote:\n')[1];
  const probe = promoteJob.slice(promoteJob.indexOf('node scripts/promote.mjs promote'));
  assert.match(probe, /run: node scripts\/exposure\.mjs\n        env:\n          WEAVE_DEPLOY_TOKEN: \$\{\{ secrets\.PROD_DEPLOY_TOKEN \}\}\n          PUBLIC_WORKSPACES: \$\{\{ vars\.PUBLIC_WORKSPACES \}\}/);
});

test('the probe fails when it cannot read the workspace list, and finds nothing when every workspace is walled', async () => {
  await assert.rejects(exposed({ list: async () => { throw new Error('HTTP 404'); }, status: async () => 200 }, { base: 'https://x' }), /HTTP 404/);
  await assert.rejects(exposed({ list: async () => [], status: async () => 200 }, { base: 'https://x' }), /no workspaces/);
  assert.deepEqual(await exposed({ list: async () => [{ name: 'a' }], status: async () => 401 }, { base: 'https://x' }), []);
});

test('a request is local only when its host is a loopback name, it comes from this machine or a private network, and no proxy forwarded it (Issue #472)', () => {
  assert.equal(localRequest({ host: 'localhost:4400', remote: '127.0.0.1' }), true);
  assert.equal(localRequest({ host: '127.0.0.1:4400', remote: '::ffff:127.0.0.1' }), true);
  assert.equal(localRequest({ host: '[::1]:4400', remote: '::1' }), true);
  assert.equal(localRequest({ host: 'localhost:4400', remote: '172.17.0.1' }), true, 'docker on a laptop');
  assert.equal(localRequest({ host: 'localhost:4400', remote: '192.168.65.1' }), true, 'docker desktop');
  assert.equal(localRequest({ host: 'weave.example.com', remote: '127.0.0.1' }), false, 'a public name');
  assert.equal(localRequest({ host: '203.0.113.9:4400', remote: '198.51.100.7' }), false, 'a bare public address');
  assert.equal(localRequest({ host: 'localhost', remote: '198.51.100.7' }), false, 'a spoofed host from the internet');
  assert.equal(localRequest({ host: 'localhost:4400', remote: '127.0.0.1', forwarded: '198.51.100.7' }), false, 'a proxy in front');
  assert.equal(localRequest({ host: '', remote: '127.0.0.1' }), false);
});

test('a fresh instance with no accounts serves nobody anonymous as admin on a public host, and stays open on localhost (Issue #472)', async () => {
  const h = hubIn();
  const { server, port } = await startServer(h.main, { port: 0, origin: 'https://weave.example.com' });
  try {
    for (const [method, path, body] of [['POST', '/api/accounts', { name: 'mallory', role: 'architect' }], ['PATCH', '/api/workspace', { requireAuth: false }], ['PATCH', '/api/workspace', { name: 'owned' }], ['GET', '/api/tables']]) {
      assert.equal((await hit(port, 'weave.example.com', method, path, { body })).status, 401, `${method} ${path} on the public host`);
    }
    assert.equal((await hit(port, 'weave.example.com', 'GET', '/api/health')).status, 200);
    assert.equal((await hit(port, `localhost:${port}`, 'GET', '/api/tables', { headers: { 'X-Forwarded-For': '198.51.100.7' } })).status, 401, 'a proxied request is not local');
    assert.equal((await hit(port, `localhost:${port}`, 'GET', '/api/tables')).status, 200, 'a first-time local user still gets in');
    assert.deepEqual(h.main.listAccounts(), []);
  } finally { server.close(); h.done(); }
});

test('the door is shut on a public host before WEAVE_ORIGIN is set too, the moment a platform domain points at the service (Issue #472)', async () => {
  const h = hubIn();
  const { server, port } = await startServer(h.main, { port: 0, host: '0.0.0.0' });
  try {
    assert.equal((await hit(port, 'weave-production.up.railway.app', 'POST', '/api/accounts', { body: { name: 'mallory', role: 'architect' } })).status, 401);
    assert.equal((await hit(port, 'weave-production.up.railway.app', 'PATCH', '/api/workspace', { body: { requireAuth: false } })).status, 401);
    assert.deepEqual(h.main.listAccounts(), []);
  } finally { server.close(); h.done(); }
});

test('an operator who turned the wall off on purpose keeps an open instance (Issue #472)', async () => {
  const h = hubIn();
  h.main.setRequireAuth(false);
  h.main.save();
  const { server, port } = await startServer(h.main, { port: 0, origin: 'https://weave.example.com' });
  try {
    assert.equal((await hit(port, 'weave.example.com', 'GET', '/api/tables')).status, 200);
  } finally { server.close(); h.done(); }
});

test('the setup token makes the first architect over HTTPS, closes the wall behind it, and stops working once the workspace has an account (Issue #472)', async () => {
  assert.equal(setupTokenFromEnv({ WEAVE_SETUP_TOKEN: 'short' }), null);
  assert.equal(setupTokenFromEnv({}), null);
  assert.equal(setupTokenFromEnv({ WEAVE_SETUP_TOKEN: SETUP }), SETUP);
  const h = hubIn();
  const docs = new Weave({ path: join(h.dir, 'other.db'), name: 'other' });
  docs.state.meta.name = 'other';
  docs.save();
  docs.store.close?.();
  const { server, port } = await startServer(h.main, { port: 0, origin: 'https://weave.example.com', setupToken: SETUP });
  try {
    assert.equal((await hit(port, 'weave.example.com', 'POST', '/api/accounts', { token: 'x'.repeat(40), body: { name: 'kyle', role: 'architect' } })).status, 401, 'a wrong secret');
    const made = await hit(port, 'weave.example.com', 'POST', '/api/accounts', { token: SETUP, body: { name: 'kyle', role: 'architect' } });
    assert.equal(made.status, 201, made.text);
    const { token } = made.json();
    assert.deepEqual(h.main.listAccounts().map((a) => [a.name, Weave.roleName(a.role)]), [['kyle', 'architect']]);
    assert.equal(h.main.state.meta.requireAuth, true, 'the wall is on behind the first account');
    assert.equal((await hit(port, 'weave.example.com', 'POST', '/api/accounts', { token: SETUP, body: { name: 'mallory', role: 'architect' } })).status, 401, 'one time only');
    assert.equal((await hit(port, 'weave.example.com', 'GET', '/api/tables')).status, 401, 'anonymous reads stay shut');
    assert.equal((await hit(port, 'weave.example.com', 'GET', '/api/tables', { token })).status, 200, 'the new token opens it');
    assert.equal((await hit(port, 'weave.example.com', 'POST', '/w/other/api/accounts', { token: SETUP, body: { name: 'kyle', role: 'architect' } })).status, 201, 'the wall is per workspace, and so is the first account');
  } finally { server.close(); h.done(); }
});
