/* Issue #595: tools/list carried 56 definitions, about 12,000 tokens an
   agent re-read on every turn, while a workspace build used about twelve of
   them. The default profile is now the core build set plus weave_call, one
   hop to everything else: its description names every other tool in a line,
   and weave_call {name: "help", args: {tool}} returns a tool's full
   definition. `weave mcp --tools all` or WEAVE_MCP_TOOLS=all lists every tool
   on stdio and HTTP. Every capability stays reachable either way. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { Weave } from '../src/engine.js';
import { handleMcpMessage, startMcpServer, TOOLS, CORE_TOOLS, listTools } from '../src/mcp.js';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
const CORE = ['weave_schema', 'weave_query', 'weave_get_entity', 'weave_create_entity', 'weave_update_entity',
  'weave_create_space', 'weave_create_table', 'weave_add_field', 'weave_update_field', 'weave_add_relation',
  'weave_import_csv', 'weave_vocabulary', 'weave_workspace', 'weave_search'];

let rpcId = 0;
const rpc = (w, method, params, opts) => handleMcpMessage(w, { jsonrpc: '2.0', id: ++rpcId, method, params }, opts);
const callTool = (w, name, args, opts) => rpc(w, 'tools/call', { name, arguments: args }, opts).result;
const ok = (res) => {
  assert.ok(!res.isError, res.content[0].text);
  try { return JSON.parse(res.content[0].text); } catch { return res.content[0].text; }
};

function withEnv(value, fn) {
  const before = process.env.WEAVE_MCP_TOOLS;
  if (value == null) delete process.env.WEAVE_MCP_TOOLS; else process.env.WEAVE_MCP_TOOLS = value;
  try { return fn(); } finally {
    if (before == null) delete process.env.WEAVE_MCP_TOOLS; else process.env.WEAVE_MCP_TOOLS = before;
  }
}

test('tools/list answers the core set plus weave_call by default', () => withEnv(null, () => {
  const names = rpc(new Weave(), 'tools/list').result.tools.map((t) => t.name);
  const expected = [...CORE, ...(TOOLS.some((t) => t.name === 'weave_build') ? ['weave_build'] : []), 'weave_call'];
  assert.deepEqual(new Set(names), new Set(expected));
  assert.equal(names.length, expected.length);
  const existing = [...CORE_TOOLS].filter((n) => TOOLS.some((t) => t.name === n));
  assert.deepEqual(new Set(existing), new Set(names), 'CORE_TOOLS is what is listed');
}));

test('the core list costs well under half the full one', () => withEnv(null, () => {
  const w = new Weave();
  const core = JSON.stringify(rpc(w, 'tools/list').result).length;
  const all = JSON.stringify(rpc(w, 'tools/list', {}, { tools: 'all' }).result).length;
  // 29,251 bytes for all 56 tools at v0.4.54; 11,942 for the core set.
  assert.ok(core * 2.5 < all, `core ${core} bytes vs all ${all}`);
  assert.ok(core < 12500, `core tools/list is ${core} bytes`);
}));

test('--tools all, WEAVE_MCP_TOOLS=all and listTools("all") list every tool', () => {
  const w = new Weave();
  assert.equal(listTools('all').length, TOOLS.length);
  assert.equal(rpc(w, 'tools/list', {}, { tools: 'all' }).result.tools.length, TOOLS.length);
  withEnv('all', () => assert.equal(rpc(w, 'tools/list').result.tools.length, TOOLS.length, 'the env var reaches the default'));
  withEnv('all', () => assert.equal(rpc(w, 'tools/list', {}, { tools: 'core' }).result.tools.length, listTools('core').length, 'an explicit profile wins'));
});

test('weave_call reaches a tool the core list leaves out, with compact replies and verbose', () => withEnv(null, () => {
  const w = new Weave();
  ok(callTool(w, 'weave_create_space', { name: 'Ops' }));
  ok(callTool(w, 'weave_create_table', { space: 'Ops', name: 'Task' }));
  ok(callTool(w, 'weave_add_field', { db: 'Task', name: 'Status', type: 'workflow', config: { states: [{ name: 'New', category: 'not-started', default: true }, { name: 'Done', category: 'done' }] } }));
  const row = ok(callTool(w, 'weave_create_entity', { db: 'Task', name: 'a' }));
  ok(callTool(w, 'weave_call', { name: 'weave_set_doc', args: { entity: 'Task#1', markdown: 'hello' } }));
  assert.equal(ok(callTool(w, 'weave_call', { name: 'weave_get_doc', args: { entity: 'Task#1' } })), 'hello');
  const moved = ok(callTool(w, 'weave_call', { name: 'weave_set_state', args: { entity: 'Task#1', field: 'Status', state: 'Done' } }));
  assert.deepEqual(moved, { id: row.id, publicId: 1, name: 'a' }, 'the write answers compact through the hatch too');
  const full = ok(callTool(w, 'weave_call', { name: 'weave_set_state', args: { entity: 'Task#1', field: 'Status', state: 'New', verbose: true } }));
  assert.equal(full.fields.Status, 'New');
  assert.equal(ok(callTool(w, 'weave_call', { name: 'weave_undo', args: { list: true } })).history.length > 0, true);
  // A client that sends args as a JSON string still lands.
  assert.equal(ok(callTool(w, 'weave_call', { name: 'weave_get_doc', args: '{"entity":"Task#1"}' })), 'hello');
}));

test('weave_call help returns a tool\'s whole definition; mistakes are tool errors', () => {
  const w = new Weave();
  for (const t of TOOLS) {
    if (t.name === 'weave_call') continue;
    const def = ok(callTool(w, 'weave_call', { name: 'help', args: { tool: t.name } }));
    assert.deepEqual(def, { name: t.name, description: t.description, inputSchema: t.inputSchema }, `help covers ${t.name}`);
  }
  for (const args of [
    { name: 'help', args: { tool: 'weave_nope' } },
    { name: 'help', args: {} },
    { name: 'weave_nope', args: {} },
    { name: 'weave_call', args: { name: 'weave_schema' } },
    {},
  ]) {
    const res = callTool(w, 'weave_call', args);
    assert.equal(res.isError, true, `${JSON.stringify(args)} is refused: ${res.content[0].text}`);
  }
});

test('weave_call names every tool the core list leaves out, one short line each', () => {
  const call = TOOLS.find((t) => t.name === 'weave_call');
  const listed = new Set(listTools('core').map((t) => t.name));
  const lines = call.description.split('\n');
  for (const t of TOOLS) {
    if (listed.has(t.name)) continue;
    const line = lines.find((l) => l.startsWith(t.name + ':'));
    assert.ok(line, `weave_call names ${t.name}`);
    assert.ok(line.length <= 80, `${t.name} line is short: ${line}`);
  }
  assert.match(call.description, /help/);
  assert.deepEqual(call.inputSchema.required, ['name']);
});

test('the admin gate holds through weave_call', () => {
  const w = new Weave();
  w.createAccount({ name: 'boss', role: 'admin' });
  const caller = { role: 'writer', root: w, rootRole: 'writer' };
  const res = callTool(w, 'weave_call', { name: 'weave_accounts', args: { action: 'create', name: 'evil', role: 'admin' } }, { caller });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /architect token/);
  assert.equal(w.listAccounts().length, 1);
});

test('the stdio server takes the profile', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  startMcpServer(new Weave(), { input, output, tools: 'all' });
  const reply = new Promise((resolve) => output.once('data', (d) => resolve(JSON.parse(String(d)))));
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n');
  assert.equal((await reply).result.tools.length, TOOLS.length);
});

test('weave mcp --tools all lists every tool; a bad value is refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-mcp-tools-'));
  try {
    const data = join(dir, 'w.db');
    const count = (extra, env = {}) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [BIN, 'mcp', '--data', data, ...extra], { env: { ...process.env, WEAVE_MCP_TOOLS: '', ...env } });
      let buf = '';
      child.stdout.on('data', (d) => {
        buf += d;
        if (buf.includes('\n')) { child.kill(); resolve(JSON.parse(buf.split('\n')[0]).result.tools.length); }
      });
      child.on('error', reject);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n');
    });
    assert.equal(await count(['--tools', 'all']), TOOLS.length);
    assert.equal(await count([]), listTools('core').length);
    assert.equal(await count([], { WEAVE_MCP_TOOLS: 'all' }), TOOLS.length);
    assert.throws(() => execFileSync(process.execPath, [BIN, 'mcp', '--data', data, '--tools', 'some'], { stdio: 'pipe', input: '' }), /core|all/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the docs give the tool counts the server has', async () => {
  const { readFileSync } = await import('node:fs');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const total = String(TOOLS.length);
  const core = String(listTools('core').length);
  for (const file of ['README.md', 'AGENTS.md', 'llms.txt']) {
    const text = readFileSync(join(root, file), 'utf8');
    assert.ok(text.includes(total), `${file} names ${total} tools`);
    assert.match(text, /weave_call/, `${file} names the escape hatch`);
    assert.match(text, /--tools all/, `${file} says how to list every tool`);
  }
  assert.ok(readFileSync(join(root, 'llms.txt'), 'utf8').includes(core), `llms.txt names the ${core} listed by default`);
});
