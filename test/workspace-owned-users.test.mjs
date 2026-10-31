import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { createWorkspaceHub, openDefaultWorkspace } from '../src/server.js';
import { client } from './lib/fixtures.mjs';
import { tempDir } from './lib/temp.mjs';

function fixture() {
  const dir = tempDir('weave-own-users-');
  const keystorePath = join(dir, 'keystore.json');
  const first = new Weave({ path: join(dir, 'first.db'), name: 'first', keystorePath });
  const second = new Weave({ path: join(dir, 'second.db'), name: 'second', keystorePath });
  const a = first.createAccount({ name: 'first-owner', role: 'architect' });
  const b = second.createAccount({ name: 'second-owner', role: 'architect' });
  first.setRequireAuth(true);
  second.setRequireAuth(true);
  const hub = createWorkspaceHub(first, { workspaces: { second } });
  return { dir, first, second, a, b, hub, call: client(hub) };
}

test('every workspace owns its Users table and can relate its records to its users', () => {
  const { first, second } = fixture();
  for (const [w, expected] of [[first, 'first-owner'], [second, 'second-owner']]) {
    const users = w.getTable('System/Users');
    assert.equal(w.registryHost, null);
    assert.deepEqual(w.listEntities(users.id).map(e => w.entityName(e)), [expected]);
    w.createSpace({ name: 'Work' });
    const tasks = w.createTable({ space: 'Work', name: 'Task' });
    w.addRelation(tasks.id, { name: 'Owner', targetDb: users.id, cardinality: 'many-to-one', inverseName: 'Tasks' });
    const owner = w.listEntities(users.id)[0];
    const task = w.createEntity(tasks.id, { name: 'Assigned', values: { Owner: owner.id } });
    assert.equal(w.readEntity(task.id).fields.Owner.id, owner.id);
  }
});

test('an architect session grants no access to a different workspace', async () => {
  const { first, second, call } = fixture();
  const session = first.createSession('first-owner').token;
  assert.equal((await call('GET', '/w/second/api/schema', { cookie: session })).status, 401);
  assert.equal((await call('GET', '/api/workspaces', { cookie: session })).json.some(w => w.id === second.state.meta.id), false);
});

test('MCP accepts only the requested workspace account', async () => {
  const { first, second, hub } = fixture();
  const issuer = 'https://identity.test';
  first.redeemIdentityInvite(first.linkIdentity('first-owner', { issuer }).code, { issuer, subject: 'person' });
  const call = client(hub, { oidc: { issuer, name: 'Identity', identify: async () => ({ issuer, subject: 'person' }) } });
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
  assert.equal((await call('POST', '/w/second/mcp', { token: 'idp-token', body })).status, 403);
  second.redeemIdentityInvite(second.linkIdentity('second-owner', { issuer }).code, { issuer, subject: 'person' });
  assert.equal((await call('POST', '/w/second/mcp', { token: 'idp-token', body })).status, 200);
});

test('workspace lifecycle checks the target workspace architect', async () => {
  const { second, b, call } = fixture();
  assert.equal((await call('DELETE', '/w/second/api/workspaces/second', { token: b.token })).status, 200);
  assert.ok(second.state.meta.deletedAt);
});

test('the initial mount can be deleted and restart follows the remaining workspace', () => {
  const { dir, first, second, hub } = fixture();
  hub.remove('first', { hard: true });
  assert.equal(hub.defaultName, 'second');
  assert.throws(() => hub.remove('second'), /last workspace/);
  second.store.close();
  const reopened = openDefaultWorkspace(join(dir, 'first.db'));
  assert.equal(reopened.state.meta.id, second.state.meta.id);
  assert.notEqual(reopened.state.meta.id, first.state.meta.id);
  reopened.store.close();
});

test('same-named accounts and credentials remain independent', async () => {
  const { first, second, call } = fixture();
  const a = first.createAccount({ name: 'same', role: 'architect' });
  second.createAccount({ name: 'same', role: 'architect' });
  assert.equal((await call('GET', '/w/second/api/schema', { token: a.token })).status, 401);
  assert.equal((await call('GET', '/w/second/api/schema', { cookie: first.createSession('same').token })).status, 401);
});

test('removing a local account never falls back to another workspace account', async () => {
  const { first, second, call } = fixture();
  const local = second.createSession('second-owner').token;
  second.deleteAccount('second-owner');
  assert.equal((await call('GET', '/w/second/api/schema', { cookie: local })).status, 403);
  assert.equal((await call('GET', '/w/second/api/schema', { cookie: first.createSession('first-owner').token })).status, 401);
});

test('an architect cannot enumerate, overwrite, share or delete another workspace secret', async () => {
  const { first, a, b, call } = fixture();
  first.actor = `account:${a.account.id}`;
  first.setKey('private', 'private-value');
  assert.deepEqual((await call('GET', '/w/second/api/keys', { token: b.token })).json, []);
  for (const [method, path, body] of [
    ['POST', '/api/keys', { name: 'private', value: 'replacement' }],
    ['POST', '/api/keys/private/share', { account: true }],
    ['POST', '/api/keys/private/reveal', {}],
    ['DELETE', '/api/keys/private', {}],
  ]) {
    const result = await call(method, `/w/second${path}`, { token: b.token, body });
    assert.ok([403, 404].includes(result.status), `${method} ${path}: ${result.status}`);
  }
  assert.equal((await call('POST', '/api/keys/private/reveal', { token: a.token })).json.value, 'private-value');
});

test('an accountless sibling cannot expose shared keystore keys over HTTP or MCP', async () => {
  const { dir, first, a, hub } = fixture();
  first.actor = `account:${a.account.id}`;
  first.setKey('private', 'private-value');
  const open = hub.create('open');
  open.keystorePath = join(dir, 'keystore.json');
  const call = client(hub);
  assert.equal((await call('POST', '/w/open/api/keys/private/reveal')).status, 401);
  const result = await call('POST', '/w/open/api/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'weave_keys', arguments: { action: 'list' } } } });
  assert.equal(result.json.result.isError, true);
});

test('workspace ordering neither persists hidden peer IDs nor moves a hidden peer over MCP', async () => {
  const { first, second, a, call } = fixture();
  const moved = await call('PATCH', '/api/workspaces/first', { token: a.token, body: { position: 0 } });
  assert.equal(moved.status, 200);
  assert.deepEqual(first.state.meta.workspaceOrder, [first.state.meta.id]);
  assert.ok(!JSON.stringify(first.exportJSON()).includes(second.state.meta.id));
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'weave_workspace', arguments: { action: 'move', name: 'second', position: 0 } } };
  const refused = await call('POST', '/api/mcp', { token: a.token, body });
  assert.equal(refused.json.result.isError, true);
  assert.deepEqual(first.state.meta.workspaceOrder, [first.state.meta.id]);
});
