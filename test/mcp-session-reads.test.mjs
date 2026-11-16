import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { unwrapData } from './lib/fixtures.mjs';

let base, server, weave, token, row;
let nextId = 1;

async function post(body, session) {
  const res = await fetch(`${base}/api/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(session ? { 'Mcp-Session-Id': session } : {}) },
    body: JSON.stringify(body),
  });
  return { headers: res.headers, data: await res.json() };
}

const callMsg = (name, args) => ({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } });

function client(session) {
  const call = async (name, args) => (await post(callMsg(name, args), session)).data.result;
  return {
    call,
    read: async () => {
      const res = await call('weave_get_doc', { entity: row });
      assert.ok(!res.isError, res.content[0].text);
      return unwrapData(res.content[0].text);
    },
    replace: (markdown) => call('weave_set_doc', { entity: row, markdown }),
  };
}

async function open() {
  const { headers } = await post({ jsonrpc: '2.0', id: nextId++, method: 'initialize', params: { clientInfo: { name: 'probe' } } });
  const session = headers.get('mcp-session-id');
  assert.match(session ?? '', /^[0-9a-f-]{36}$/, 'initialize answers an Mcp-Session-Id header');
  return client(session);
}

const humanWrites = (text) => { weave.actor = 'web'; weave.setDoc(row, text); };

test.before(async () => {
  weave = new Weave({ actor: 'web' });
  weave.createSpace({ name: 'Work' });
  const table = weave.createTable({ space: 'Work', name: 'Task' });
  row = weave.createEntity(table.id, { name: 'Row' }).id;
  token = weave.createAccount({ name: 'one-account', role: 'admin' }).token;
  ({ server } = await startServer(weave, { port: 0 }));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

test('two HTTP MCP sessions of one token keep their own reads: one session read does not let the other overwrite text it never saw (Issue #1741)', async () => {
  humanWrites('FIRST_TEXT');
  const a = await open();
  const b = await open();
  assert.notEqual(a, b);
  assert.equal(await a.read(), 'FIRST_TEXT');
  humanWrites('HUMAN_EDIT');
  assert.equal(await b.read(), 'HUMAN_EDIT');
  const no = await a.replace('SESSION_A_TEXT');
  assert.equal(no.isError, true, 'session A never saw HUMAN_EDIT');
  assert.equal(no.structuredContent.code, 'stale');
  assert.match(no.content[0].text, /Description changed since you read it/);
  assert.equal(weave.getDoc(row), 'HUMAN_EDIT', 'the human edit survives');
  const yes = await b.replace('SESSION_B_TEXT');
  assert.ok(!yes.isError, 'session B read the text it replaces');
  assert.equal(weave.getDoc(row), 'SESSION_B_TEXT');
});

test('a session that never read the document is refused as stale, though another session of its token read it (Issue #1741)', async () => {
  humanWrites('SEEN_BY_ONE');
  const reader = await open();
  const blind = await open();
  await reader.read();
  const no = await blind.replace('BLIND');
  assert.equal(no.isError, true);
  assert.match(no.content[0].text, /You have not read Description/);
  assert.equal(weave.getDoc(row), 'SEEN_BY_ONE');
});

test('without a session id a read counts only inside its own request: a later request is refused and a batch of read then replace lands (Issue #1741)', async () => {
  humanWrites('NO_SESSION');
  const bare = client(null);
  await bare.read();
  const no = await bare.replace('LATER_REQUEST');
  assert.equal(no.isError, true, 'another request carries no read');
  assert.match(no.content[0].text, /You have not read Description/);
  assert.equal(weave.getDoc(row), 'NO_SESSION');
  const { data } = await post([callMsg('weave_get_doc', { entity: row }), callMsg('weave_set_doc', { entity: row, markdown: 'SAME_REQUEST' })]);
  assert.ok(!data[1].result.isError, data[1].result.content[0].text);
  assert.equal(weave.getDoc(row), 'SAME_REQUEST');
});
