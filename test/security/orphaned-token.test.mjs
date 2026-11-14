import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../../src/engine.js';
import { createWorkspaceHub } from '../../src/server.js';
import { handleMcpMessage } from '../../src/mcp.js';
import { client } from '../lib/fixtures.mjs';

function build({ requireAuth = true } = {}) {
  const w = new Weave();
  w.updateWorkspace({ name: 'ws', description: 'kept' });
  w.createSpace({ name: 'Open' });
  const root = w.createAccount({ name: 'root', role: 'architect' });
  const other = w.createAccount({ name: 'other', role: 'editor' });
  const lead = w.createAccount({ name: 'lead', role: 'architect' });
  const bot = w.asAccount(lead.account, () => w.createAccount({ name: 'readbot', role: 'observer' }));
  const scoped = w.asAccount(lead.account, () => w.createAccount({ name: 'scoped bot', role: 'editor', space: 'Open' }));
  w.setRequireAuth(requireAuth);
  const call = client(createWorkspaceHub(w));
  const rpc = (token, method, params = {}) => call('POST', '/api/mcp', { token, body: { jsonrpc: '2.0', id: 1, method, params } });
  const state = () => ({
    spaces: Object.values(w.state.spaces).map((sp) => sp.name).sort(),
    description: w.state.meta.description,
    accounts: w.listAccounts().map((a) => a.name).sort(),
    views: w.listViews().map((v) => v.name).sort(),
  });
  return { w, call, rpc, state, root, other, lead, bot, scoped };
}

const WORKSPACE_ROUTES = (s) => [
  ['POST', '/api/spaces', { name: 'Made by an orphan' }],
  ['PATCH', '/api/workspace', { description: 'written by an orphan' }],
  ['GET', '/api/accounts'],
  ['DELETE', `/api/accounts/${s.other.account.id}`],
  ['POST', '/api/views', { name: 'Orphan view', blocks: [] }],
  ['GET', '/api/spaces'],
];

test('a token whose issuing account was deleted is refused on every workspace route and changes nothing (Issue #1800)', async () => {
  const s = build();
  assert.equal((await s.call('POST', '/api/spaces', { token: s.bot.token, body: { name: 'Live attempt' } })).status, 403, 'an observer token is refused while its issuer exists');
  s.w.deleteAccount('lead');
  const before = s.state();
  for (const token of [s.bot.token, s.scoped.token]) {
    for (const [method, path, body] of WORKSPACE_ROUTES(s)) {
      const res = await s.call(method, path, { token, body });
      assert.equal(res.status, 403, `${method} ${path}: ${JSON.stringify(res.json)}`);
      assert.equal(res.json.code, 'access-removed', `${method} ${path}`);
      assert.equal(res.json.error, 'This token no longer reaches ws: the account that issued it was removed or lost its own access. Ask an architect of ws for a new token.');
    }
  }
  assert.deepEqual(s.state(), before, 'no space, description, account or view changed');
});

test('a token whose issuing account was deleted lists and calls no MCP tool (Issue #1800)', async () => {
  const s = build();
  s.w.deleteAccount('lead');
  const before = s.state();
  for (const [method, params] of [['tools/list'], ['tools/call', { name: 'weave_views', arguments: { action: 'create', name: 'Orphan view', blocks: [] } }], ['tools/call', { name: 'weave_undo', arguments: {} }]]) {
    const res = await s.rpc(s.bot.token, method, params);
    assert.equal(res.status, 403, `${method} ${params?.name ?? ''}: ${JSON.stringify(res.json)}`);
    assert.equal(res.json.code, 'access-removed');
  }
  assert.deepEqual(s.state(), before);
});

test('a person an architect added loses the workspace with that architect, at the door and on the page (Issue #1800)', async () => {
  const s = build();
  const added = await s.call('POST', '/api/accounts', { token: s.lead.token, body: { name: 'teammate', role: 'editor' } });
  assert.equal(added.json.account.issuedBy, s.lead.account.id, 'POST /api/accounts records the architect who added the account');
  const cookie = s.w.createSession('teammate').token;
  assert.equal((await s.call('GET', '/api/spaces', { cookie })).status, 200);
  s.w.deleteAccount('lead');
  const refused = await s.call('GET', '/api/spaces', { cookie });
  assert.equal(refused.status, 403);
  assert.deepEqual(refused.json, { error: 'Your account no longer reaches ws: the account that added it was removed or lost its own access. Ask an architect of ws for a new invite.', code: 'access-removed' });
  assert.equal((await s.call('GET', '/', { cookie })).status, 403, 'the app page refuses too');
  assert.equal((await s.call('GET', '/api/health', { cookie })).status, 200, 'an open door stays open');
});

test('in a workspace open to visitors, an orphaned token is refused rather than read as an anonymous visitor (Issue #1800)', async () => {
  const s = build({ requireAuth: false });
  s.w.deleteAccount('lead');
  assert.equal((await s.call('GET', '/api/spaces')).status, 200, 'a visitor without a token still reads');
  const res = await s.call('GET', '/api/spaces', { token: s.bot.token });
  assert.equal(res.status, 403);
  assert.equal(res.json.code, 'access-removed');
});

test('a workspace with no accounts stays open to every caller and every MCP tool (Issue #1800)', async () => {
  const w = new Weave();
  const call = client(createWorkspaceHub(w));
  assert.equal((await call('POST', '/api/spaces', { body: { name: 'Local' } })).status, 201);
  const made = await call('POST', '/api/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'weave_create_space', arguments: { name: 'Local MCP' } } } });
  assert.equal(made.status, 200);
  assert.notEqual(made.json.result.isError, true, made.json.result.content?.[0]?.text);
  assert.deepEqual(Object.values(w.state.spaces).filter((sp) => !sp.system).map((sp) => sp.name).sort(), ['Local', 'Local MCP']);
});

test('the MCP door refuses a signed-in caller whose role resolved to nothing, and leaves the local default open (Issue #1800)', () => {
  const w = new Weave();
  w.createSpace({ name: 'Open' });
  const orphan = { signedIn: true, role: null, tier: null, workspaceTier: null };
  const local = { role: null, tier: null, workspaceTier: null };
  const ask = (caller, method, params) => handleMcpMessage(w, { jsonrpc: '2.0', id: 1, method, params }, { caller });
  assert.deepEqual(ask(orphan, 'tools/list').result.tools, []);
  const called = ask(orphan, 'tools/call', { name: 'weave_views', arguments: { action: 'create', name: 'Orphan view', blocks: [] } }).result;
  assert.equal(called.isError, true);
  assert.match(called.content[0].text, /^Error: weave_views needs an observer token on this workspace; this token is none/);
  assert.deepEqual(w.listViews(), []);
  assert.ok(ask(local, 'tools/list').result.tools.length > 0, 'a caller with no account and no role is the local default');
  assert.notEqual(ask(local, 'tools/call', { name: 'weave_views', arguments: { action: 'create', name: 'Local view', blocks: [] } }).result.isError, true);
});
