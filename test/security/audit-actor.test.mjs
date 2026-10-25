import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tempDir } from '../lib/temp.mjs';

process.env.WEAVE_KEYSTORE = join(tempDir('weave-ks-'), 'keystore.json');
const { Weave } = await import('../../src/engine.js');
const { createWorkspaceHub } = await import('../../src/server.js');
const { createRequestHandler } = await import('../../src/routes.js');

function seed(name, opts = {}) {
  const w = new Weave(opts);
  w.updateWorkspace({ name });
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  w.createEntity('Dev/Task', { name: 'one' });
  return w;
}

function caller(hub, opts = {}) {
  const handle = createRequestHandler(hub, { version: 'test', ...opts });
  return async (method, path, { body, token, actor } = {}) => {
    const url = new URL(path, 'http://localhost:4400');
    const headers = { host: 'localhost:4400' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (actor) headers['x-weave-actor'] = actor;
    const res = await handle({
      method, path: decodeURIComponent(url.pathname), searchParams: url.searchParams,
      header: (n) => headers[n.toLowerCase()], readBody: async () => body ?? {}, remote: '127.0.0.1',
    });
    let json = null;
    try { json = JSON.parse(res.body); } catch {}
    return { status: res.status, json };
  };
}

const lastAudit = (w, action) => w.listAudit({ limit: -1 }).filter((r) => r.action === action);
const firstRow = (w) => w.listEntities(w.getTable('Dev/Task').id)[0];

test('a token request records its account and ignores x-weave-actor', async () => {
  const root = seed('root');
  const { token } = root.createAccount({ name: 'ar', role: 'architect' });
  const call = caller(createWorkspaceHub(root));
  assert.equal((await call('POST', '/api/spaces', { token, actor: 'mallory', body: { name: 'Ops' } })).status, 201);
  const [made] = lastAudit(root, 'space-created');
  assert.equal(made.actor, 'ar');
});

test('a token request keeps its account while another request names itself during an await', async () => {
  const root = seed('root');
  const { token } = root.createAccount({ name: 'ar', role: 'architect' });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const billing = { standing: async () => { await gate; return { seated: () => true } }, syncMembers: async () => ({}) };
  const call = caller(createWorkspaceHub(root), { billing });
  const a = call('POST', '/api/spaces', { token, body: { name: 'Ops' } });
  await new Promise((resolve) => setImmediate(resolve));
  await call('GET', '/api/schema', { actor: 'mallory' });
  release();
  assert.equal((await a).status, 201);
  assert.equal(lastAudit(root, 'space-created')[0].actor, 'ar');
});

for (const [where, prefix, rootAccounts] of [['the hub root', '', true], ['a member guarded by the hub root', '/w/member', true]]) {
  test(`${where}: an anonymous caller is recorded as anonymous and cannot pick a comment author`, async () => {
    const root = seed('root');
    const member = seed('member');
    if (rootAccounts) root.createAccount({ name: 'ra', role: 'architect' });
    const call = caller(createWorkspaceHub(root, { workspaces: { member } }));
    const w = prefix ? member : root;
    const row = firstRow(w);
    const r = await call('POST', `${prefix}/api/entities/${row.id}/comments`, { actor: 'mallory', body: { text: 'hi', author: 'ceo' } });
    assert.equal(r.status, 201);
    assert.equal(r.json.author, 'anonymous');
    const stored = w.getEntity(row.id);
    assert.equal(stored.comments.at(-1).author, 'anonymous');
    assert.equal(stored.activity.at(-1).actor, 'anonymous');
  });
}

test('an account-less hub: an anonymous caller still names itself through x-weave-actor', async () => {
  const root = seed('root');
  const call = caller(createWorkspaceHub(root));
  assert.equal((await call('POST', '/api/spaces', { actor: 'agent-7', body: { name: 'Ops' } })).status, 201);
  assert.equal(lastAudit(root, 'space-created')[0].actor, 'agent-7');
  const made = await call('POST', '/api/tables/Task/entities', { actor: 'agent-7', body: { name: 'two' } });
  assert.equal(made.json.createdBy, 'agent-7');
});

test('import CSV, export JSON and import JSON each write one audit entry naming the caller', async () => {
  const root = seed('root');
  const call = caller(createWorkspaceHub(root));
  assert.equal((await call('POST', '/api/tables/Task/import.csv', { actor: 'agent-7', body: { csv: 'Name\nalpha\nbeta\n' } })).status, 200);
  const dump = await call('GET', '/api/export', { actor: 'agent-7' });
  assert.equal(dump.status, 200);
  assert.equal((await call('POST', '/api/import', { actor: 'agent-7', body: dump.json })).status, 200);
  for (const action of ['csv-imported', 'workspace-exported', 'workspace-imported']) {
    const hits = lastAudit(root, action);
    assert.equal(hits.length, 1, `${action} is audited once`);
    assert.equal(hits[0].actor, 'agent-7', `${action} names the caller`);
  }
  assert.equal(lastAudit(root, 'csv-imported')[0].detail.created, 2);
});

test('workspace create, trash, restore and delete each write one audit entry on the hub root', async (t) => {
  const dir = tempDir('weave-audit-hub-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = seed('root', { path: join(dir, 'root.db') });
  const call = caller(createWorkspaceHub(root));
  assert.equal((await call('POST', '/api/workspaces', { actor: 'agent-7', body: { name: 'fresh' } })).status, 201);
  assert.equal((await call('DELETE', '/api/workspaces/fresh', { actor: 'agent-7' })).status, 200);
  assert.equal((await call('POST', '/api/workspaces/fresh/restore', { actor: 'agent-7' })).status, 200);
  assert.equal((await call('DELETE', '/api/workspaces/fresh?hard=1', { actor: 'agent-7' })).status, 200);
  for (const action of ['workspace-created', 'workspace-trashed', 'workspace-restored', 'workspace-deleted']) {
    const hits = lastAudit(root, action);
    assert.equal(hits.length, 1, `${action} is audited once`);
    assert.equal(hits[0].actor, 'agent-7', `${action} names the caller`);
    assert.equal(hits[0].detail.name, 'fresh');
  }
});
