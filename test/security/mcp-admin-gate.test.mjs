import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WEAVE_KEYSTORE = join(mkdtempSync(join(tmpdir(), 'weave-ks-')), 'keystore.json');
const { Weave } = await import('../../src/engine.js');
const { createWorkspaceHub } = await import('../../src/server.js');
const { client } = await import('../lib/fixtures.mjs');
const { handleMcpMessage } = await import('../../src/mcp.js');

let seq = 0;
const tool = (name, args) => ({ jsonrpc: '2.0', id: ++seq, method: 'tools/call', params: { name, arguments: args } });
const mcp = (call, prefix, name, args, token) => call('POST', `${prefix}/api/mcp`, { token, body: tool(name, args) });
const refused = (r) => r.status >= 400 || r.json?.result?.isError === true;

function build({ accounts = true } = {}) {
  process.env.WEAVE_KEYSTORE = join(mkdtempSync(join(tmpdir(), 'weave-ks-')), 'keystore.json');
  const root = new Weave();
  root.updateWorkspace({ name: 'root' });
  const mem = new Weave();
  mem.updateWorkspace({ name: 'mem' });
  const hub = createWorkspaceHub(root, { workspaces: { mem } });
  const t = accounts ? {
    admin: root.createAccount({ name: 'root-admin', role: 'admin' }).token,
    writer: root.createAccount({ name: 'root-writer', role: 'writer' }).token,
    reader: root.createAccount({ name: 'root-reader', role: 'reader' }).token,
    memAdmin: mem.createAccount({ name: 'mem-admin', role: 'admin' }).token,
  } : {};
  return { root, mem, call: client(hub), ...t };
}

test('no accounts, wall off: the tools stay open to a local caller, as today', async () => {
  const { root, call } = build({ accounts: false });
  const r = await mcp(call, '', 'weave_accounts', { action: 'create', name: 'first', role: 'admin' });
  assert.equal(r.status, 200);
  assert.ok(!r.json.result.isError, r.json.result.content?.[0]?.text);
  assert.equal(root.listAccounts().length, 1);
});

test('no credentials, accounts present: accounts, keys and import are refused over /api/mcp', async () => {
  const { root, call } = build();
  const before = root.listAccounts().length;
  assert.ok(refused(await mcp(call, '', 'weave_accounts', { action: 'create', name: 'evil', role: 'admin' })));
  assert.ok(refused(await mcp(call, '', 'weave_accounts', { action: 'require-auth', on: false })));
  assert.ok(refused(await mcp(call, '', 'weave_keys', { action: 'list' })));
  assert.ok(refused(await mcp(call, '/w/mem', 'weave_keys', { action: 'set', name: 'k', value: 'v' })), 'keys answer to the root');
  const state = root.exportJSON();
  assert.ok(refused(await mcp(call, '', 'weave_import_json', { state: { ...state, meta: { ...state.meta, accounts: {} } } })));
  assert.equal(root.listAccounts().length, before);
  assert.equal((await call('POST', '/api/import', { body: state })).status, 401, 'REST import takes the same gate');
});

test('reader and writer of the root cannot reach /api/mcp at all', async () => {
  const { call, reader, writer } = build();
  assert.equal((await mcp(call, '', 'weave_accounts', { action: 'list' }, reader)).status, 403);
  assert.equal((await mcp(call, '', 'weave_accounts', { action: 'list' }, writer)).status, 403);
});

test('an admin of a member only: its own accounts yes, the keystore no', async () => {
  const { call, memAdmin, mem } = build();
  const r = await mcp(call, '/w/mem', 'weave_accounts', { action: 'create', name: 'helper', role: 'writer' }, memAdmin);
  assert.ok(!refused(r), JSON.stringify(r.json));
  assert.equal(mem.listAccounts().length, 2);
  assert.ok(refused(await mcp(call, '/w/mem', 'weave_keys', { action: 'set', name: 'k', value: 'v' }, memAdmin)));
});

test('the root admin reaches all three tools', async () => {
  const { root, call, admin } = build();
  assert.ok(!refused(await mcp(call, '', 'weave_keys', { action: 'set', name: 'k', value: 'v' }, admin)));
  assert.ok(!refused(await mcp(call, '', 'weave_accounts', { action: 'create', name: 'bot', role: 'writer' }, admin)));
  assert.ok(!refused(await mcp(call, '', 'weave_import_json', { state: root.exportJSON() }, admin)));
});

test('stdio (no caller) is the local operator: it creates an account with accounts already present', () => {
  const { root } = build();
  const reply = handleMcpMessage(root, tool('weave_accounts', { action: 'create', name: 'cli-made', role: 'writer' }));
  assert.ok(!reply.result.isError, reply.result.content?.[0]?.text);
  assert.ok(root.listAccounts().some((a) => a.name === 'cli-made'));
});

test('REST and MCP ask one function', () => {
  const routes = readFileSync(new URL('../../src/routes.js', import.meta.url), 'utf8');
  assert.match(routes, /import \{[^}]*mayAdminister[^}]*\} from '\.\/mcp\.js'/);
  assert.equal(/listAccounts\(\)\.length && role !== 'admin'/.test(routes), false, 'no inline copy of the gate is left in routes.js');
});
