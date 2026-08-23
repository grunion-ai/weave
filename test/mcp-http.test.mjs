import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

/* MCP over HTTP (Feature #99): POST /api/mcp speaks the same JSON-RPC the
   stdio transport does — one handler, two transports. */

let base, server, weave;

async function rpc(msg, token) {
  const res = await fetch(`${base}/api/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(msg),
  });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

test.before(async () => {
  weave = new Weave();
  ({ server } = await startServer(weave, { port: 0 }));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

test('initialize reports the real version over HTTP', async () => {
  const { status, data } = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'test-agent' } } });
  assert.equal(status, 200);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(data.result.serverInfo.version, pkg.version, 'the transport injects the version the health route reports (Issue #19 class)');
  assert.equal(data.result.capabilities.tools !== undefined, true);
});

test('a notification is accepted with 202 and no body', async () => {
  const { status, data } = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(status, 202);
  assert.equal(data, null);
});

test('tools/list and tools/call round-trip through the engine', async () => {
  const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names = list.data.result.tools.map((t) => t.name);
  assert.ok(names.includes('weave_undo'), 'undo rides the HTTP transport too');

  await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'weave_create_space', arguments: { name: 'S' } } });
  await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'weave_create_table', arguments: { space: 'S', name: 'T' } } });
  const made = await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'weave_create_entity', arguments: { db: 'T', name: 'row' } } });
  assert.equal(made.status, 200);
  assert.match(made.data.result.content[0].text, /"row"/);

  const q = await rpc({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'weave_query', arguments: { db: 'T' } } });
  assert.match(q.data.result.content[0].text, /"total": 1/);
});

test('a batch array returns an array, notifications elided', async () => {
  const { status, data } = await rpc([
    { jsonrpc: '2.0', id: 7, method: 'ping' },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 8, method: 'tools/list' },
  ]);
  assert.equal(status, 200);
  assert.equal(data.length, 2);
  assert.deepEqual(data.map((r) => r.id), [7, 8]);
});

test('a tool error is an MCP error result, not a transport failure', async () => {
  const { status, data } = await rpc({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'weave_get_entity', arguments: { entity: 'nope' } } });
  assert.equal(status, 200);
  assert.equal(data.result.isError, true);
});

test('capped tokens cannot widen themselves through the MCP tunnel', async () => {
  const mint = async (role, admin) => (await (await fetch(`${base}/api/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: `Bearer ${admin}` } : {}) },
    body: JSON.stringify({ name: `${role}-acct`, role }),
  })).json()).token;
  const admin = await mint('admin');
  const writer = await mint('writer', admin);
  const reader = await mint('reader', admin);

  assert.equal((await rpc({ jsonrpc: '2.0', id: 10, method: 'tools/list' }, reader)).status, 403, 'reader: MCP is a write surface');
  assert.equal((await rpc({ jsonrpc: '2.0', id: 11, method: 'tools/list' }, writer)).status, 403, 'writer: MCP carries schema tools');
  assert.equal((await rpc({ jsonrpc: '2.0', id: 12, method: 'tools/list' }, admin)).status, 200, 'admin passes');
});
