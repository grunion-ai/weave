import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { dispatchTool } from '../src/mcp.js';
import { tempDir } from './lib/temp.mjs';

async function fixture() {
  const w = new Weave({ path: join(tempDir('run-api-'), 'workspace.db') });
  const admin = w.createAccount({ name: 'owner', role: 'architect' });
  const editor = w.createAccount({ name: 'worker', role: 'editor' });
  const observer = w.createAccount({ name: 'reader', role: 'observer' });
  w.setRequireAuth(true);
  const { server } = await startServer(w, { port: 0, mail: null });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, token = editor.token) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? {body:JSON.stringify(body)} : {}) });
    return { status: res.status, data: await res.json() };
  };
  return { w, admin, editor, observer, server, call };
}

test('authenticated run API starts, updates and lists a run; dispatch is not completion', async () => {
  const f = await fixture();
  try {
    const a = await f.call('POST', '/api/runs', { name: 'Review', key: 'scheduled-slot-1' });
    assert.equal(a.status, 201);
    assert.equal(a.data.status, 'queued');
    const b = await f.call('POST', '/api/runs', { name: 'Review', key: 'scheduled-slot-1' });
    assert.equal(b.data.id, a.data.id);
    const dispatched = await f.call('PATCH', `/api/runs/${a.data.id}`, { status: 'running', sessionUrl: 'https://claude.ai/code/session_test' });
    assert.equal(dispatched.status, 200);
    assert.equal(dispatched.data.status, 'running');
    const done = await f.call('PATCH', `/api/runs/${a.data.id}`, { status: 'succeeded', summary: 'All checked.' });
    assert.equal(done.data.status, 'succeeded');
    const duplicate = await f.call('PATCH', `/api/runs/${a.data.id}`, { status: 'succeeded', summary: 'All checked.' });
    assert.equal(duplicate.status, 200);
    const conflict = await f.call('PATCH', `/api/runs/${a.data.id}`, { status: 'failed' });
    assert.equal(conflict.status, 409);
    const list = await f.call('GET', '/api/runs');
    assert.ok(JSON.stringify(list.data).includes(a.data.id));
  } finally { f.server.closeAllConnections(); await new Promise(resolve => f.server.close(resolve)); }
});

test('run routes reject anonymous writes and observer writes', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call('POST', '/api/runs', { name: 'No' }, null)).status, 401);
    assert.equal((await f.call('POST', '/api/runs', { name: 'No' }, f.observer.token)).status, 403);
    const made = await f.call('POST', '/api/runs', { name: 'Owned' });
    assert.equal((await f.call('PATCH', `/api/runs/${made.data.id}`, { status: 'succeeded' }, f.observer.token)).status, 403);
    assert.equal((await f.call('GET', '/api/runs', null, f.observer.token)).status, 200);
  } finally { f.server.closeAllConnections(); await new Promise(resolve => f.server.close(resolve)); }
});

test('MCP and CLI expose the same persisted run lifecycle', async () => {
  const path = join(tempDir('run-doors-'), 'workspace.db');
  const w = new Weave({ path });
  const made = await dispatchTool(w, 'weave_runs', { action: 'start', name: 'Door check', key: 'door-check' });
  assert.equal(made.status, 'queued');
  const done = await dispatchTool(w, 'weave_runs', { action: 'update', run: made.id, patch: { status: 'succeeded' } });
  assert.equal(done.status, 'succeeded');
  const output = execFileSync(process.execPath, ['bin/weave.js', 'run', 'list', '--data', path], { encoding: 'utf8' });
  assert.ok(output.includes(made.id));
});

test('MCP run mutations require a seated editor on a workspace with accounts while observers can list', () => {
  const w = new Weave();
  w.createAccount({ name: 'owner', role: 'architect' });
  for (const caller of [{ role: 'observer' }, { role: 'editor', seat: 'No seat' }]) {
    assert.throws(() => dispatchTool(w, 'weave_runs', { action: 'start', name: 'Denied' }, { caller }), /editor|seat/i);
  }
  const made = dispatchTool(w, 'weave_runs', { action: 'start', name: 'Allowed' }, { caller: { role: 'editor' } });
  assert.equal(dispatchTool(w, 'weave_runs', { action: 'list' }, { caller: { role: 'observer' } })[0].id, made.id);
});

test('a workspace with no accounts lets its local owner start and update runs on REST and MCP over HTTP alike (Issue #1773)', async () => {
  const w = new Weave({ path: join(tempDir('run-owner-'), 'workspace.db') });
  const { server } = await startServer(w, { port: 0, mail: null });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  const rpc = async (args) => (await call('POST', '/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'weave_runs', arguments: args } })).data.result;
  try {
    const rest = await call('POST', '/api/runs', { name: 'Over REST' });
    assert.equal(rest.status, 201);
    assert.equal((await call('PATCH', `/api/runs/${rest.data.id}`, { status: 'running' })).status, 200);
    const started = await rpc({ action: 'start', name: 'Over MCP', verbose: true });
    assert.notEqual(started.isError, true, started.content[0].text);
    const id = w.listRuns().find((r) => r.name === 'Over MCP').id;
    const updated = await rpc({ action: 'update', run: id, patch: { status: 'running' } });
    assert.notEqual(updated.isError, true, updated.content[0].text);
    assert.equal(w.listRuns().find((r) => r.id === id).status, 'running');
    const listed = await rpc({ action: 'list' });
    assert.notEqual(listed.isError, true);
    const managed = (await call('POST', '/api/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'weave_keys', arguments: { action: 'list' } } })).data.result;
    assert.equal(managed.isError, true, 'keys still need an account on this workspace');
    assert.match(managed.content[0].text, /needs an account/);
    assert.equal((await call('GET', '/api/keys')).status, 401, 'and over REST');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('a workspace with accounts refuses MCP run writes to a caller with no token, as REST does (Issue #1773)', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call('POST', '/api/runs', { name: 'No' }, null)).status, 401);
    assert.equal((await f.call('POST', '/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'weave_runs', arguments: { action: 'start', name: 'No' } } }, null)).status, 401);
    assert.equal(f.w.listRuns().length, 0);
  } finally { f.server.closeAllConnections(); await new Promise(resolve => f.server.close(resolve)); }
});

test('the server sweep sends timeout mail even when schedule processing fails', { timeout: 10000 }, async (t) => {
  const w = new Weave();
  w.now = () => new Date('2026-11-10T12:00:00Z');
  const run = w.startRun({ name: 'Abandoned review', recipient: 'owner@example.com', timeoutMinutes: 1 });
  w.now = () => new Date('2026-11-10T12:02:00Z');
  w.runSchedules = () => { throw new Error('Schedule unavailable'); };
  const errors = t.mock.method(console, 'error', () => {});
  let delivered;
  let deadline;
  const sent = new Promise((resolve, reject) => {
    delivered = resolve;
    deadline = setTimeout(() => reject(new Error('No timeout confirmation received')), 3000);
  });
  const { server } = await startServer(w, { port: 0, origin: 'https://weave.example.com', scheduleEvery: 10, mail: async message => { delivered(message); return { id: 'provider-test' }; } });
  try {
    const message = await sent;
    assert.equal(message.to, 'owner@example.com');
    assert.match(message.html, /Abandoned review/);
    assert.match(message.text, /timed out/i);
    assert.equal(message.idempotencyKey, `weave-run-${run.id}`);
    assert.equal(w.listRuns()[0].status, 'timed-out');
    assert.ok(errors.mock.callCount() > 0);
  } finally { clearTimeout(deadline); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
