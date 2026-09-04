import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import { Weave } from '../src/engine.js';
import { startMcpServer, TOOLS, dispatchTool } from '../src/mcp.js';

function makeSession() {
  const weave = new Weave();
  const input = new PassThrough();
  const output = new PassThrough();
  startMcpServer(weave, { input, output });

  const pending = [];
  let buf = '';
  output.setEncoding('utf8');
  output.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.trim()) pending.push(JSON.parse(line));
    }
  });

  let nextId = 1;
  const call = (method, params) => {
    const id = nextId++;
    input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const poll = () => {
        const i = pending.findIndex((m) => m.id === id);
        if (i >= 0) return resolve(pending.splice(i, 1)[0]);
        if (Date.now() - t0 > 2000) return reject(new Error('MCP response timeout'));
        setTimeout(poll, 5);
      };
      poll();
    });
  };
  return { weave, call, input };
}

test('MCP handshake and tool listing', async () => {
  const { call } = makeSession();
  const init = await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(init.result.serverInfo.name, 'weave');
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(init.result.serverInfo.version, pkg.version);
  assert.ok(init.result.capabilities.tools);

  const list = await call('tools/list', {});
  assert.ok(list.result.tools.length >= 15);
  assert.ok(list.result.tools.every((t) => t.name && t.description && t.inputSchema));
});

test('MCP tool calls drive a full workflow', async () => {
  const { call } = makeSession();
  await call('initialize', {});

  const toolCall = async (name, args) => {
    const res = await call('tools/call', { name, arguments: args });
    assert.ok(!res.error, JSON.stringify(res.error));
    const text = res.result.content[0].text;
    return { isError: res.result.isError ?? false, data: (() => { try { return JSON.parse(text); } catch { return text; } })() };
  };

  await toolCall('weave_create_space', { name: 'Ops' });
  await toolCall('weave_create_table', { space: 'Ops', name: 'Ticket' });
  await toolCall('weave_add_field', {
    db: 'Ticket', name: 'Status', type: 'workflow',
    config: { states: [{ name: 'New', category: 'not-started', default: true }, { name: 'Resolved', category: 'done' }] },
  });
  await toolCall('weave_add_field', { db: 'Ticket', name: 'Hours', type: 'number' });

  const created = await toolCall('weave_create_entity', { db: 'Ticket', name: 'Login broken', values: { Hours: 2 }, doc: '# Repro\n\nSteps here.' });
  assert.equal(created.data.fields.Status, 'New');

  const updated = await toolCall('weave_update_entity', { entity: 'Ticket#1', values: { Hours: 3 } });
  assert.equal(updated.data.fields.Hours, 3);

  const moved = await toolCall('weave_set_state', { entity: 'Ticket#1', field: 'Status', state: 'Resolved' });
  assert.equal(moved.data.fields.Status, 'Resolved');

  const doc = await toolCall('weave_get_doc', { entity: 'Ticket#1' });
  assert.match(doc.data, /# Repro/);

  await toolCall('weave_set_doc', { entity: 'Ticket#1', markdown: 'Resolved by patch.', mode: 'append' });
  const doc2 = await toolCall('weave_get_doc', { entity: 'Ticket#1' });
  const feed = await toolCall('weave_activity', { entity: 'Ticket#1' });
  assert.ok(feed.data.items.length >= 1, 'the feed filters by a Table#N ref like every other tool');
  assert.ok(feed.data.items.every((a) => a.entityId === created.data.id), 'and only that entity');
  assert.match(doc2.data, /Resolved by patch/);

  const found = await toolCall('weave_search', { query: 'login' });
  assert.equal(found.data[0].name, 'Login broken');

  const q = await toolCall('weave_query', { db: 'Ticket', where: [['Status', '=', 'Resolved']] });
  assert.equal(q.data.total, 1);

  const bad = await toolCall('weave_get_entity', { entity: 'Ticket#99' });
  assert.equal(bad.isError, true);
});

test('MCP unknown method errors cleanly', async () => {
  const { call } = makeSession();
  const res = await call('bogus/method', {});
  assert.equal(res.error.code, -32601);
});

test('dispatchTool covers relations and rollups directly', () => {
  const w = new Weave();
  dispatchTool(w, 'weave_create_space', { name: 'S' });
  dispatchTool(w, 'weave_create_table', { space: 'S', name: 'A' });
  dispatchTool(w, 'weave_create_table', { space: 'S', name: 'B' });
  dispatchTool(w, 'weave_add_relation', { db: 'A', name: 'Items', targetDb: 'B', cardinality: 'one-to-many', inverseName: 'Parent' });
  dispatchTool(w, 'weave_add_field', { db: 'B', name: 'Points', type: 'number' });
  dispatchTool(w, 'weave_add_field', { db: 'A', name: 'Sum', type: 'rollup', config: { relationField: 'Items', targetField: 'Points', aggregate: 'sum' } });
  dispatchTool(w, 'weave_create_entity', { db: 'A', name: 'parent' });
  dispatchTool(w, 'weave_create_entity', { db: 'B', name: 'x', values: { Points: 4, Parent: 'parent' } });
  dispatchTool(w, 'weave_create_entity', { db: 'B', name: 'y', values: { Points: 6, Parent: 'parent' } });
  const parent = dispatchTool(w, 'weave_get_entity', { entity: 'A#1' });
  assert.equal(parent.fields.Sum, 10);
  const csv = dispatchTool(w, 'weave_export_csv', { db: 'B' });
  assert.match(csv, /Points/);
});
