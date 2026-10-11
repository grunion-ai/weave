import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WEAVE_KEYSTORE = join(mkdtempSync(join(tmpdir(), 'weave-ks-')), 'keystore.json');
const { Weave } = await import('../../src/engine.js');
const { createWorkspaceHub } = await import('../../src/server.js');
const { client } = await import('../lib/fixtures.mjs');

function seed(name) {
  const w = new Weave();
  w.updateWorkspace({ name });
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  w.createEntity('Dev/Task', { name: 'one' });
  return w;
}

function build({ rootAccounts = false, memberAccounts = false, wall = false } = {}) {
  const root = seed('root');
  const member = seed('member');
  if (rootAccounts) root.createAccount({ name: 'ra', role: 'architect' });
  if (memberAccounts) member.createAccount({ name: 'ma', role: 'architect' });
  if (wall) { root.setRequireAuth(true); member.setRequireAuth(true); }
  return { root, member, call: client(createWorkspaceHub(root, { workspaces: { member } })) };
}

const mcpCreate = (name) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'weave_create_space', arguments: { name } } });

async function probe(call, prefix) {
  const read = (await call('GET', `${prefix}/api/schema`)).status;
  const row = (await call('POST', `${prefix}/api/tables/Task/entities`, { body: { name: 'anon' } })).status;
  const space = (await call('POST', `${prefix}/api/spaces`, { body: { name: 'Anon' } })).status;
  const mcp = (await call('POST', `${prefix}/api/mcp`, { body: mcpCreate('Mcp') })).status;
  return { read, row, space, mcp };
}

for (const [where, prefix] of [['the hub root', ''], ['a member workspace', '/w/member']]) {
  test(`${where}: no accounts anywhere and the wall off, an anonymous caller keeps full access`, async () => {
    const { call, root, member } = build();
    const r = await probe(call, prefix);
    assert.deepEqual(r, { read: 200, row: 201, space: 201, mcp: 200 });
    const w = prefix ? member : root;
    assert.equal(w.listEntities(w.getTable('Dev/Task').id).length, 2);
  });

  test(`${where}: accounts present and the wall off, an anonymous caller reads but every write asks for credentials`, async () => {
    const { call, root, member } = build({ rootAccounts: !prefix, memberAccounts: !!prefix });
    const w = prefix ? member : root;
    const spaces = w.listSpaces().length;
    const r = await probe(call, prefix);
    assert.deepEqual(r, { read: 200, row: 401, space: 401, mcp: 401 });
    assert.equal(w.listEntities(w.getTable('Dev/Task').id).length, 1, 'no row was written');
    assert.equal(w.listSpaces().length, spaces, 'no space was created');
  });

  test(`${where}: accounts present and the wall on, an anonymous caller gets 401`, async () => {
    const { call } = build({ rootAccounts: true, memberAccounts: true, wall: true });
    const r = await probe(call, prefix);
    assert.deepEqual(r, { read: 401, row: 401, space: 401, mcp: 401 });
  });
}

test('a member workspace with no accounts of its own is guarded by the accounts on the hub root', async () => {
  const { call, member } = build({ rootAccounts: true });
  const r = await probe(call, '/w/member');
  assert.deepEqual(r, { read: 200, row: 401, space: 401, mcp: 401 });
  assert.equal(member.listEntities(member.getTable('Dev/Task').id).length, 1);
});

test('under the cap an anonymous caller still comments, and /api/auth/me answers 401 rather than crashing', async () => {
  const { call, root } = build({ rootAccounts: true });
  const row = root.listEntities(root.getTable('Dev/Task').id)[0];
  const comment = await call('POST', `/api/entities/${row.id}/comments`, { body: { text: 'hello' } });
  assert.equal(comment.status, 201);
  const me = await call('GET', '/api/auth/me');
  assert.equal(me.status, 401);
});

test('a token keeps its own role beside the cap: an editor still writes rows, an architect still writes schema', async () => {
  const root = seed('root');
  const editor = root.createAccount({ name: 'ed', role: 'editor' }).token;
  const architect = root.createAccount({ name: 'ar', role: 'architect' }).token;
  const call = client(createWorkspaceHub(root));
  assert.equal((await call('POST', '/api/tables/Task/entities', { token: editor, body: { name: 'ed' } })).status, 201);
  assert.equal((await call('POST', '/api/spaces', { token: editor, body: { name: 'Ed' } })).status, 403);
  assert.equal((await call('POST', '/api/spaces', { token: architect, body: { name: 'Ar' } })).status, 201);
});
