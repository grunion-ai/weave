import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer, createWorkspaceHub, deployTokenFromEnv } from '../src/server.js';
import { exposed, probeUrls } from '../scripts/exposure.mjs';
import { tempDir } from './lib/temp.mjs';

const DEPLOY = 'd'.repeat(40);

const hit = (port, host, method, path, { token, body, cookie } = {}) => new Promise((resolve, reject) => {
  const payload = body === undefined ? null : JSON.stringify(body);
  const req = request({
    host: '127.0.0.1', port, method, path,
    headers: { Host: host, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(payload ? { 'Content-Type': 'application/json' } : {}) },
  }, (res) => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { text += c; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
  });
  req.on('error', reject);
  req.end(payload ?? undefined);
});

function hubIn({ requireAuth = false } = {}) {
  const dir = tempDir('weave-exposure-');
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

test('a workspace auth setting does not become an instance creation policy', () => {
  const h = hubIn({ requireAuth: true });
  try {
    const w = createWorkspaceHub(h.main).create('Guessable');
    assert.equal(!!w.state.meta.requireAuth, false);
  } finally { h.done(); }
});

test('a loopback hub with an open default workspace still creates open workspaces', () => {
  const h = hubIn();
  try {
    const w = createWorkspaceHub(h.main).create('Local');
    assert.equal(!!w.state.meta.requireAuth, false);
  } finally { h.done(); }
});

test('hosted legacy workspace creation cannot bypass start-page policy', async () => {
  const h = hubIn();
  const token = h.main.createAccount({ name: 'root', role: 'architect' }).token;
  const { server, port } = await startServer(h.main, { port: 0, origin: 'http://weave.test', baseDomain: 'weave.test' });
  try {
    const made = await hit(port, 'weave.test', 'POST', '/api/workspaces', { token, body: { name: 'guess' } });
    assert.equal(made.status, 403, made.text);
    assert.equal((await hit(port, 'guess.weave.test', 'GET', '/api/tables')).status, 404);
    assert.equal((await hit(port, 'weave.test', 'GET', '/w/guess/api/tables')).status, 404);
  } finally { server.close(); h.done(); }
});

test('local workspace creation gives the browser its own new workspace session', async () => {
  const h = hubIn({ requireAuth: true });
  h.main.createAccount({ name: 'root', role: 'architect' });
  const cookie = `wv_session_${h.main.state.meta.id}=${h.main.createSession('root').token}`;
  const { server, port } = await startServer(h.main, { port: 0, origin: null, baseDomain: null });
  try {
    const made = await hit(port, `localhost:${port}`, 'POST', '/api/workspaces', { cookie, body: { name: 'mine' } });
    assert.equal(made.status, 201, made.text);
    const createdCookie = made.headers['set-cookie'].map(c => c.split(';')[0]).join('; ');
    assert.equal((await hit(port, `localhost:${port}`, 'GET', made.json().url + 'api/tables', { cookie: createdCookie })).status, 200);
    assert.equal((await hit(port, `localhost:${port}`, 'GET', made.json().url + 'api/tables', { cookie })).status, 401);
    assert.equal((await hit(port, `localhost:${port}`, 'GET', made.json().url + 'api/tables')).status, 401);
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
