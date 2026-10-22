import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.WEAVE_KEYSTORE = join(mkdtempSync(join(tmpdir(), 'weave-ks-')), 'keystore.json');
const { Weave } = await import('../../src/engine.js');
const { createWorkspaceHub } = await import('../../src/server.js');
const { client } = await import('../lib/fixtures.mjs');
const { handleMcpMessage, listTools, ROLE_TOOLS, SEATLESS_TOOLS } = await import('../../src/mcp.js');

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

test('the role table: an observer reads and comments, an editor adds row writes and file attach, an architect has every tool (Issue #508)', () => {
  const byName = Object.fromEntries(listTools('all').map((t) => [t.name, t]));
  for (const name of ROLE_TOOLS.observer) {
    assert.ok(byName[name], `${name} is a tool`);
    assert.ok(byName[name].annotations.readOnlyHint || ['weave_add_comment', 'weave_call'].includes(name), `${name} writes, so an observer may not hold it`);
  }
  for (const name of SEATLESS_TOOLS) assert.ok(ROLE_TOOLS.observer.has(name), `observer holds ${name}`);
  assert.deepEqual([...ROLE_TOOLS.editor].filter((n) => !ROLE_TOOLS.observer.has(n)).sort(), ['weave_attach_file', 'weave_create_entity', 'weave_delete_entity', 'weave_update_entity']);
  assert.equal(ROLE_TOOLS.architect, undefined, 'an architect is not narrowed');
});

test('tools/list holds the tools the caller\'s role may call; tools/call on any other answers as an unknown tool (Issue #508)', async () => {
  const { root, call, reader, writer, admin } = build();
  root.createSpace({ name: 'Dev' });
  root.createTable({ space: 'Dev', name: 'Task' });
  const row = root.createEntity('Dev/Task', { name: 'seed' });
  const spaces = () => root.listSpaces().length;
  const rpc = (token, method, params) => call('POST', '/api/mcp', { token, body: { jsonrpc: '2.0', id: ++seq, method, params } });
  const text = (r) => r.json.result.content[0].text;
  const unknown = text(await rpc(admin, 'tools/call', { name: 'weave_nope', arguments: {} })).replace('weave_nope', '<name>');
  const asUnknown = async (token, name, args, shown = name) => {
    const r = await rpc(token, 'tools/call', { name, arguments: args });
    assert.equal(r.status, 200, name);
    assert.equal(r.json.result.isError, true, name);
    assert.equal(text(r), unknown.replace('<name>', shown), `${name} answers as an unknown tool`);
  };
  const works = async (token, name, args) => {
    const r = await rpc(token, 'tools/call', { name, arguments: args });
    assert.equal(r.status, 200, name);
    assert.notEqual(r.json.result.isError, true, `${name}: ${text(r)}`);
    return r;
  };
  const core = listTools().map((t) => t.name);
  for (const [token, role] of [[reader, 'observer'], [writer, 'editor'], [admin, 'architect']]) {
    const listed = await rpc(token, 'tools/list', {});
    assert.equal(listed.status, 200, `${role} reaches /api/mcp`);
    assert.deepEqual(listed.json.result.tools.map((t) => t.name), core.filter((n) => !ROLE_TOOLS[role] || ROLE_TOOLS[role].has(n)), role);
    assert.equal((await rpc(token, 'initialize', {})).status, 200);
    await works(token, 'weave_query', { db: 'Dev/Task' });
    await works(token, 'weave_call', { name: 'weave_search', args: { query: 'seed' } });
    await works(token, 'weave_add_comment', { entity: row.id, text: `from ${role}` });
  }
  for (const [name, args] of [['weave_create_entity', { db: 'Dev/Task', name: 'x' }], ['weave_delete_entity', { entity: row.id }], ['weave_create_space', { name: 'S' }], ['weave_accounts', { action: 'list' }], ['weave_export_json', {}]]) {
    await asUnknown(reader, name, args);
  }
  const posed = await works(reader, 'weave_add_comment', { entity: row.id, text: 'posing', author: 'root-admin' });
  assert.notEqual(JSON.parse(text(posed)).author, 'root-admin', 'an observer comments under its own name, as over REST');
  await asUnknown(reader, 'weave_call', { name: 'weave_create_entity', args: { db: 'Dev/Task', name: 'x' } }, 'weave_create_entity');
  const made = await works(writer, 'weave_create_entity', { db: 'Dev/Task', name: 'by the editor' });
  const id = JSON.parse(text(made)).id;
  await works(writer, 'weave_update_entity', { entity: id, values: { Name: 'renamed by the editor' } });
  await works(writer, 'weave_delete_entity', { entity: id });
  for (const [name, args] of [['weave_create_space', { name: 'S' }], ['weave_create_table', { space: 'Dev', name: 'T2' }], ['weave_add_field', { db: 'Dev/Task', name: 'Due', type: 'date' }], ['weave_accounts', { action: 'list' }], ['weave_keys', { action: 'list' }], ['weave_import_json', { state: root.exportJSON() }], ['weave_bulk', { ids: [row.id], op: 'delete' }]]) {
    await asUnknown(writer, name, args);
  }
  await asUnknown(writer, 'weave_call', { name: 'weave_create_space', args: { name: 'S' } }, 'weave_create_space');
  const help = await rpc(writer, 'tools/call', { name: 'weave_call', arguments: { name: 'help', args: { tool: 'weave_create_space' } } });
  assert.equal(help.json.result.isError, true, 'help describes no tool the caller cannot call');
  const before = spaces();
  const schema = JSON.stringify(root.describeSchema());
  const system = root.listTables().filter((t) => t.system);
  assert.ok(system.some((t) => t.system === 'spaces') && system.some((t) => t.system === 'fields'));
  const spaceRow = root.listEntities(system.find((t) => t.system === 'spaces').id)[0];
  for (const t of system) {
    const r = await rpc(writer, 'tools/call', { name: 'weave_create_entity', arguments: { db: t.id, name: 'Sneaked' } });
    assert.equal(r.json.result.isError, true, `an editor writes no ${t.name} row`);
  }
  for (const [name, args] of [['weave_update_entity', { entity: spaceRow.id, values: { Name: 'Renamed' } }], ['weave_delete_entity', { entity: spaceRow.id }]]) {
    const r = await rpc(writer, 'tools/call', { name, arguments: args });
    assert.equal(r.json.result.isError, true, `${name} on a Spaces row is refused to an editor`);
  }
  assert.equal(spaces(), before, 'no space was made by an editor');
  assert.equal(JSON.stringify(root.describeSchema()), schema, 'the schema did not move');
  await works(admin, 'weave_create_space', { name: 'Ops' });
  await works(admin, 'weave_accounts', { action: 'list' });
  assert.equal(spaces(), before + 1);
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
