import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WEAVE_KEYSTORE = join(mkdtempSync(join(tmpdir(), 'weave-ks-')), 'keystore.json');
const { Weave } = await import('../../src/engine.js');
const { createWorkspaceHub } = await import('../../src/server.js');
const { client } = await import('../lib/fixtures.mjs');
const { seedWeaver } = await import('../../src/weaver-seed.js');

const REPORT = { categories: ['slow'], note: 'the grid stalls', events: [], client: { version: 'test' } };

function build({ accounts = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'weave-hub-'));
  const at = (name) => { const w = new Weave({ path: join(dir, `${name}.db`) }); w.updateWorkspace({ name }); return w; };
  const root = at('root');
  const open = at('open');
  open.createSpace({ name: 'Dev' });
  open.createTable({ space: 'Dev', name: 'Note' });
  open.createEntity('Dev/Note', { name: 'needle in the open' });
  const secret = at('secret');
  secret.createSpace({ name: 'Ops' });
  secret.createTable({ space: 'Ops', name: 'Plan' });
  secret.createEntity('Ops/Plan', { name: 'needle in the secret' });
  const docs = new Weave({ path: join(dir, 'weave.db') });
  seedWeaver(docs);
  docs.updateWorkspace({ name: 'weave' });
  const t = {};
  if (accounts) {
    t.admin = root.createAccount({ name: 'root-admin', role: 'admin' }).token;
    t.writer = root.createAccount({ name: 'root-writer', role: 'writer' }).token;
    t.reader = root.createAccount({ name: 'root-reader', role: 'reader' }).token;
    t.secretAdmin = secret.createAccount({ name: 'secret-admin', role: 'admin' }).token;
    secret.setRequireAuth(true);
  }
  const hub = createWorkspaceHub(root, { workspaces: { open, secret, weave: docs } });
  return { dir, hub, root, open, secret, docs, call: client(hub), ...t };
}

const names = (r) => r.json.map((w) => w.name).sort();
const hitsIn = (r) => [...new Set(r.json.filter((h) => h.kind === 'entity').map((h) => h.workspace))].sort();
const issues = (docs) => docs.listEntities(docs.getTable('Development/Issue').id).length;

test('no accounts anywhere: workspace lifecycle, list and search stay open, as today', async () => {
  const { call, dir } = build({ accounts: false });
  assert.equal((await call('POST', '/w/open/api/workspaces', { body: { name: 'fresh' } })).status, 201);
  assert.ok(names(await call('GET', '/w/open/api/workspaces')).includes('secret'));
  assert.deepEqual(hitsIn(await call('GET', '/w/open/api/search?q=needle&all=1')), ['open', 'secret']);
  assert.equal((await call('DELETE', '/w/open/api/workspaces/fresh')).status, 200);
  assert.equal((await call('POST', '/w/open/api/workspaces/fresh/restore')).status, 200);
  assert.equal((await call('DELETE', '/w/open/api/workspaces/fresh?hard=1')).status, 200);
  assert.equal(existsSync(join(dir, 'fresh.db')), false);
  assert.equal((await call('POST', '/w/open/api/bug-report', { body: REPORT })).status, 201);
});

test('no credentials, root has accounts: lifecycle is refused through an unwalled member', async () => {
  const { call, dir, hub } = build();
  assert.equal((await call('POST', '/w/open/api/workspaces', { body: { name: 'mine' } })).status, 401);
  assert.equal(hub.get('mine'), null);
  assert.equal((await call('DELETE', '/w/open/api/workspaces/secret?hard=1')).status, 401);
  assert.equal((await call('DELETE', '/w/open/api/workspaces/secret')).status, 401);
  assert.equal(existsSync(join(dir, 'secret.db')), true);
  assert.equal(hub.get('secret').state.meta.deletedAt ?? null, null);
  assert.equal((await call('POST', '/w/open/api/workspaces/secret/restore')).status, 401);
});

test('no credentials: the list and search ?all=1 leave out a walled workspace', async () => {
  const { call } = build();
  const list = names(await call('GET', '/w/open/api/workspaces'));
  assert.ok(list.includes('open'));
  assert.equal(list.includes('secret'), false);
  assert.equal(names(await call('GET', '/w/open/api/workspaces?deleted=1')).includes('secret'), false);
  assert.deepEqual(hitsIn(await call('GET', '/w/open/api/search?q=needle&all=1')), ['open']);
});

test('reader and writer of the root cannot create, delete or restore workspaces', async () => {
  const { call, reader, writer } = build();
  for (const token of [reader, writer]) {
    assert.equal((await call('POST', '/api/workspaces', { token, body: { name: 'x' } })).status, 403);
    assert.equal((await call('DELETE', '/api/workspaces/open', { token })).status, 403);
    assert.equal((await call('POST', '/api/workspaces/open/restore', { token })).status, 403);
  }
});

test('an admin of a member only: its own workspace in the list and search, no lifecycle', async () => {
  const { call, secretAdmin, hub } = build();
  assert.equal((await call('POST', '/w/secret/api/workspaces', { token: secretAdmin, body: { name: 'x' } })).status, 401);
  assert.equal((await call('DELETE', '/w/secret/api/workspaces/open', { token: secretAdmin })).status, 401);
  assert.equal(hub.get('open').state.meta.deletedAt ?? null, null);
  assert.ok(names(await call('GET', '/w/secret/api/workspaces', { token: secretAdmin })).includes('secret'));
  assert.deepEqual(hitsIn(await call('GET', '/w/secret/api/search?q=needle&all=1', { token: secretAdmin })), ['open', 'secret']);
});

test('the root admin manages workspaces, from the root or through a member with a root session', async () => {
  const { call, admin, root, dir } = build();
  assert.equal((await call('POST', '/api/workspaces', { token: admin, body: { name: 'fresh' } })).status, 201);
  assert.equal((await call('DELETE', '/api/workspaces/fresh', { token: admin })).status, 200);
  assert.equal((await call('POST', '/api/workspaces/fresh/restore', { token: admin })).status, 200);
  const { token: session } = root.createSession('root-admin');
  assert.equal((await call('DELETE', '/w/open/api/workspaces/fresh?hard=1', { cookie: session })).status, 200);
  assert.equal(existsSync(join(dir, 'fresh.db')), false);
  assert.ok(names(await call('GET', '/w/open/api/workspaces', { cookie: session })).includes('secret'));
});

test('bug report: a writer still files into weave; an anonymous caller cannot reach a walled weave', async () => {
  const { call, writer, reader, docs, root, open } = build();
  const n = issues(docs);
  const rootRows = Object.keys(root.state.entities).length;
  const openRows = Object.keys(open.state.entities).length;
  assert.equal((await call('POST', '/w/open/api/bug-report', { body: REPORT })).status, 201, 'weave unwalled: the intake is open');
  docs.setRequireAuth(true);
  assert.equal((await call('POST', '/w/open/api/bug-report', { body: REPORT })).status, 401);
  assert.equal((await call('POST', '/api/bug-report', { token: reader, body: REPORT })).status, 403);
  const r = await call('POST', '/api/bug-report', { token: writer, body: REPORT });
  assert.equal(r.status, 201);
  assert.equal(r.json.workspace, 'weave');
  assert.equal(issues(docs), n + 2);
  assert.equal(Object.keys(open.state.entities).length, openRows, 'nothing lands in the URL workspace');
  assert.equal(Object.keys(root.state.entities).length, rootRows);
});
