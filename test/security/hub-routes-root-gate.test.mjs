import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tempDir } from '../lib/temp.mjs';

process.env.WEAVE_KEYSTORE = join(tempDir('weave-ks-'), 'keystore.json');
const { Weave } = await import('../../src/engine.js');
const { createWorkspaceHub } = await import('../../src/server.js');
const { client } = await import('../lib/fixtures.mjs');
const { seedWeaver } = await import('../../src/weaver-seed.js');

const REPORT = { categories: ['slow'], note: 'the grid stalls', events: [], client: { version: 'test' } };

function build({ accounts = true } = {}) {
  const dir = tempDir('weave-hub-');
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
const rows = (r) => r.json.filter((h) => h.kind === 'entity').map((h) => h.name).sort();
const issues = (docs) => docs.listEntities(docs.getTable('Development/Issue').id).length;

test('no accounts anywhere: workspace lifecycle, list and search stay open, as today', async () => {
  const { call, dir } = build({ accounts: false });
  assert.equal((await call('POST', '/w/open/api/workspaces', { body: { name: 'fresh' } })).status, 201);
  assert.ok(names(await call('GET', '/w/open/api/workspaces')).includes('secret'));
  assert.deepEqual(rows(await call('GET', '/w/secret/api/search?q=needle')), ['needle in the secret']);
  assert.equal((await call('DELETE', '/w/open/api/workspaces/fresh')).status, 200);
  assert.equal((await call('POST', '/w/open/api/workspaces/fresh/restore')).status, 200);
  assert.equal((await call('DELETE', '/w/open/api/workspaces/fresh?hard=1')).status, 200);
  assert.equal(existsSync(join(dir, 'fresh.db')), false);
  assert.equal((await call('POST', '/w/open/api/bug-report', { body: REPORT })).status, 201);
});

test('no credentials: a protected workspace cannot be managed through an unwalled sibling', async () => {
  const { call, dir, hub } = build();
  assert.equal((await call('POST', '/api/workspaces', { body: { name: 'mine' } })).status, 401);
  assert.equal(hub.get('mine'), null);
  assert.equal((await call('DELETE', '/w/open/api/workspaces/secret?hard=1')).status, 401);
  assert.equal((await call('DELETE', '/w/open/api/workspaces/secret')).status, 401);
  assert.equal(existsSync(join(dir, 'secret.db')), true);
  assert.equal(hub.get('secret').state.meta.deletedAt ?? null, null);
  assert.equal((await call('POST', '/w/open/api/workspaces/secret/restore')).status, 401);
});

test('no credentials: the list leaves out a walled workspace, its search refuses, and ?all=1 stays home', async () => {
  const { call } = build();
  const list = names(await call('GET', '/w/open/api/workspaces'));
  assert.ok(list.includes('open'));
  assert.equal(list.includes('secret'), false);
  assert.equal(names(await call('GET', '/w/open/api/workspaces?deleted=1')).includes('secret'), false);
  assert.equal((await call('GET', '/w/secret/api/search?q=needle')).status, 401);
  assert.deepEqual(rows(await call('GET', '/w/open/api/search?q=needle&all=1')), ['needle in the open']);
});

test('reader and writer cannot create or manage an unrelated protected workspace', async () => {
  const { call, reader, writer, hub, secret } = build();
  for (const [token, denied] of [[reader, 403], [writer, 401]]) {
    assert.equal((await call('POST', '/api/workspaces', { token, body: { name: 'x' } })).status, 403);
    assert.equal((await call('DELETE', '/api/workspaces/secret', { token })).status, denied);
    assert.equal((await call('POST', '/api/workspaces/secret/restore', { token })).status, denied);
    assert.ok(!secret.state.meta.deletedAt);
    assert.equal(hub.get('x'), null);
  }
});

test('an architect creates its own workspace and cannot manage an unrelated protected workspace', async () => {
  const { call, secretAdmin, hub } = build();
  assert.equal((await call('POST', '/w/secret/api/workspaces', { token: secretAdmin, body: { name: 'x' } })).status, 201);
  assert.equal((await call('DELETE', '/w/secret/api/workspaces/root', { token: secretAdmin })).status, 401);
  assert.equal(hub.get('open').state.meta.deletedAt ?? null, null);
  assert.ok(names(await call('GET', '/w/secret/api/workspaces', { token: secretAdmin })).includes('secret'));
  assert.deepEqual(rows(await call('GET', '/w/secret/api/search?q=needle&all=1', { token: secretAdmin })), ['needle in the secret'], 'its search never reaches a sibling');
});

test('a creator gets a separate account on the new workspace, and source credentials stay scoped', async () => {
  const { call, admin, dir } = build();
  const created = await call('POST', '/api/workspaces', { token: admin, body: { name: 'fresh' } });
  assert.equal(created.status, 201);
  const token = created.json.owner.token;
  assert.equal((await call('DELETE', '/api/workspaces/fresh', { token: admin })).status, 401);
  assert.equal((await call('DELETE', '/w/fresh/api/workspaces/fresh', { token })).status, 200);
  assert.equal((await call('POST', '/w/fresh/api/workspaces/fresh/restore', { token })).status, 404, 'a deleted workspace answers nothing to its former Architect');
  assert.equal(existsSync(join(dir, 'fresh.db')), true, 'the file stays behind the tombstone');
  const other = await call('POST', '/api/workspaces', { token: admin, body: { name: 'other' } });
  assert.equal((await call('DELETE', '/w/other/api/workspaces/other?hard=1', { token: other.json.owner.token })).status, 200);
  assert.equal(existsSync(join(dir, 'other.db')), false);
});

test('a reader or writer of the root, signed in by session, cannot open a walled member or find it in search (Issue #985)', async () => {
  const { call, root } = build();
  for (const name of ['root-reader', 'root-writer']) {
    const { token: session } = root.createSession(name);
    assert.equal((await call('GET', '/w/secret/api/schema', { cookie: session })).status, 401, `${name} holds no account on secret`);
    assert.deepEqual(rows(await call('GET', '/w/open/api/search?q=needle&all=1', { cookie: session })), ['needle in the open'], `${name} never finds secret through search`);
    assert.equal((await call('GET', '/w/secret/api/search?q=needle', { cookie: session })).status, 401, `${name} cannot search secret`);
    assert.equal(names(await call('GET', '/w/open/api/workspaces', { cookie: session })).includes('secret'), false, `${name} does not see secret listed`);
  }
  const { token: admin } = root.createSession('root-admin');
  assert.equal((await call('GET', '/w/secret/api/schema', { cookie: admin })).status, 401, 'architects require a local account too');
  assert.deepEqual(rows(await call('GET', '/w/open/api/search?q=needle&all=1', { cookie: admin })), ['needle in the open']);
});

test('OAuth MCP requires a local membership for every role and applies that membership role', async () => {
  const { hub, root, secret } = build();
  const issuer = 'https://idp.test';
  const oidc = { name: 'Test IdP', issuer, identify: async (token) => ({ issuer, subject: token.slice('idp-'.length), client: null }) };
  const pin = (w, name, subject) => w.redeemIdentityInvite(w.linkIdentity(name, { issuer }).code, { issuer, subject });
  pin(root, 'root-admin', 'admin');
  pin(root, 'root-writer', 'writer');
  pin(root, 'root-reader', 'reader-only');
  root.createAccount({ name: 'root-editor', role: 'editor' });
  pin(root, 'root-editor', 'editor-only');
  root.createAccount({ name: 'root-boss', role: 'architect' });
  pin(root, 'root-boss', 'boss');
  secret.createAccount({ name: 'boss-reader', role: 'observer' });
  pin(secret, 'boss-reader', 'boss');
  secret.createAccount({ name: 'writer-owner', role: 'architect' });
  pin(secret, 'writer-owner', 'writer');
  const call = client(hub, { oidc });
  const rpc = (token, method, params) => call('POST', '/w/secret/mcp', { token, body: { jsonrpc: '2.0', id: 1, method, params } });
  const create = (token, name) => rpc(token, 'tools/call', { name: 'weave_create_entity', arguments: { db: 'Plan', name } });
  const rows = () => secret.listEntities(secret.getTable('Ops/Plan').id).map((e) => secret.entityName(e));
  for (const subject of ['reader-only', 'editor-only']) {
    for (const method of ['tools/list', 'initialize']) {
      const r = await rpc(`idp-${subject}`, method, {});
      assert.equal(r.status, 403, `${subject} ${method}`);
      assert.match(r.json.error, /opens no account on this workspace/, `${subject} is not signed in on secret at all`);
    }
    assert.equal((await create(`idp-${subject}`, `by ${subject}`)).status, 403);
  }
  const boss = await create('idp-admin', 'by the hub operator');
  assert.equal(boss.status, 403);
  const owner = await create('idp-writer', 'by the member architect');
  assert.equal(owner.status, 200);
  assert.ok(!owner.json.result.isError, owner.json.result.content[0].text);
  assert.equal(secret.actorName(secret.getEntity(JSON.parse(owner.json.result.content[0].text).id).createdBy), 'writer-owner via MCP', 'the member account, never the root one');
  await create('idp-boss', 'by a root architect seated as a member observer');
  assert.equal(rows().includes('by a root architect seated as a member observer'), false, 'the member role wins over the root role, as crossSeat does');
  assert.deepEqual(rows().filter((n) => n.startsWith('by ')).sort(), ['by the member architect']);
});

test('bug report: a writer and a reader file into weave through the form; an anonymous caller cannot reach a walled weave', async () => {
  const { call, writer, reader, docs, root, open } = build();
  const n = issues(docs);
  const rootRows = Object.keys(root.state.entities).length;
  const openRows = Object.keys(open.state.entities).length;
  assert.equal((await call('POST', '/w/open/api/bug-report', { body: REPORT })).status, 201, 'weave unwalled: the intake is open');
  docs.setRequireAuth(true);
  assert.equal((await call('POST', '/w/open/api/bug-report', { body: REPORT })).status, 401);
  assert.equal((await call('POST', '/api/bug-report', { token: reader, body: REPORT })).status, 201, 'everyone may submit a bug (Feature #257)');
  const r = await call('POST', '/api/bug-report', { token: writer, body: REPORT });
  assert.equal(r.status, 201);
  assert.equal(r.json.workspace, 'weave');
  assert.equal(issues(docs), n + 3);
  assert.equal(Object.keys(open.state.entities).length, openRows, 'nothing lands in the URL workspace');
  assert.equal(Object.keys(root.state.entities).length, rootRows);
});
