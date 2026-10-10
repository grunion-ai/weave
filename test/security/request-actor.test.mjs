import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WEAVE_KEYSTORE = join(mkdtempSync(join(tmpdir(), 'weave-ks-')), 'keystore.json');
const { Weave } = await import('../../src/engine.js');
const { createWorkspaceHub } = await import('../../src/server.js');
const { createRequestHandler } = await import('../../src/routes.js');

function seed(w) {
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  return w.createEntity('Dev/Task', { name: 'one' });
}

function build({ accounts = true, dir = null } = {}) {
  const at = (name) => { const w = new Weave(dir ? { path: join(dir, `${name}.db`) } : {}); w.updateWorkspace({ name }); return w; };
  const root = at('root');
  const member = at('member');
  const row = seed(root);
  seed(member);
  const tokens = accounts ? {
    a: root.createAccount({ name: 'a', role: 'architect' }).token,
    b: root.createAccount({ name: 'b', role: 'architect' }).token,
  } : {};
  const hub = createWorkspaceHub(root, { workspaces: { member } });
  const handle = createRequestHandler(hub, { version: 'test' });
  const call = (method, path, { body, token, actor, readBody } = {}) => {
    const headers = { host: 'localhost:4400' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (actor) headers['x-weave-actor'] = actor;
    const url = new URL(path, 'http://localhost:4400');
    return handle({ method, path: url.pathname, searchParams: url.searchParams, header: (n) => headers[n.toLowerCase()], readBody: readBody ?? (async () => body ?? {}), remote: '127.0.0.1' })
      .then((res) => { let json = null; try { json = JSON.parse(res.body); } catch {} return { status: res.status, json }; });
  };
  return { root, member, row, hub, call, ...tokens };
}

const lastActivity = (w, id) => w.getEntity(id).activity.at(-1);
const audit = (w, action) => w.listAudit({ limit: 50 }).find((r) => r.action === action);

test('with no account anywhere, an anonymous caller still names itself through x-weave-actor', async () => {
  const { root, row, call } = build({ accounts: false });
  const r = await call('POST', `/api/entities/${row.id}/comments`, { actor: 'someone', body: { text: 'hi' } });
  assert.equal(r.status, 201);
  assert.equal(lastActivity(root, row.id).actor, 'someone');
});

test('once accounts exist, an anonymous caller cannot pick its actor: the header is ignored', async () => {
  const { root, member, row, call } = build();
  const r = await call('POST', `/api/entities/${row.id}/comments`, { actor: 'a', body: { text: 'hi' } });
  assert.equal(r.status, 201);
  assert.equal(lastActivity(root, row.id).actor, 'web');
  const mrow = member.listEntities(member.getTable('Dev/Task').id)[0];
  const m = await call('POST', `/w/member/api/entities/${mrow.id}/comments`, { actor: 'a', body: { text: 'hi' } });
  assert.equal(m.status, 201);
  assert.equal(lastActivity(member, mrow.id).actor, 'web', 'a member is guarded by the accounts on the hub root');
});

test('an authenticated caller is its account name whatever the header says', async () => {
  const { root, call, a } = build();
  assert.equal((await call('POST', '/api/spaces', { token: a, actor: 'b', body: { name: 'Ops' } })).status, 201);
  assert.equal(audit(root, 'space-created').actor, 'a');
});

test('a request that waits on its body is not relabelled by a request that overtakes it', async () => {
  const { root, call, a, b } = build();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const slow = call('POST', '/api/spaces', { token: a, readBody: () => gate.then(() => ({ name: 'Slow' })) });
  const fast = await call('GET', '/api/schema', { token: b });
  assert.equal(fast.status, 200);
  release();
  assert.equal((await slow).status, 201);
  assert.equal(audit(root, 'space-created').actor, 'a');
  assert.equal(root.state.spaces[Object.keys(root.state.spaces).find((id) => root.state.spaces[id].name === 'Slow')].createdBy ?? 'a', 'a');
});

test('export and import each write an audit entry with the caller', async () => {
  const { root, call, a } = build();
  const dump = await call('GET', '/api/export', { token: a });
  assert.equal(dump.status, 200);
  assert.equal(audit(root, 'export')?.actor, 'a');
  const back = await call('POST', '/api/import', { token: a, body: dump.json });
  assert.equal(back.status, 200);
  const row = audit(root, 'import');
  assert.equal(row?.actor, 'a');
  assert.equal(row.detail.tables, Object.keys(dump.json.tables).length);
});

test('workspace create, trash, restore and delete each write an audit entry on the hub root', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-actor-hub-'));
  const { root, call, a } = build({ dir });
  assert.equal((await call('POST', '/api/workspaces', { token: a, body: { name: 'fresh' } })).status, 201);
  assert.equal((await call('DELETE', '/api/workspaces/fresh', { token: a })).status, 200);
  assert.equal((await call('POST', '/api/workspaces/fresh/restore', { token: a })).status, 200);
  assert.equal((await call('DELETE', '/api/workspaces/fresh?hard=1', { token: a })).status, 200);
  assert.equal(existsSync(join(dir, 'fresh.db')), false);
  const LIFECYCLE = ['workspace-created', 'workspace-trashed', 'workspace-restored', 'workspace-deleted'];
  const rows = root.listAudit({ limit: 50 }).filter((r) => LIFECYCLE.includes(r.action));
  assert.deepEqual(rows.map((r) => r.action).reverse(), ['workspace-created', 'workspace-trashed', 'workspace-restored', 'workspace-deleted']);
  assert.ok(rows.every((r) => r.actor === 'a' && r.detail.name === 'fresh'), JSON.stringify(rows));
});

test('an MCP initialize by a signed-in caller does not rename the actor', async () => {
  const { root, call, a } = build();
  const r = await call('POST', '/api/mcp', { token: a, body: [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'evil' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'weave_create_space', arguments: { name: 'Mcp' } } },
  ] });
  assert.equal(r.status, 200);
  assert.equal(audit(root, 'space-created').actor, 'a');
});
