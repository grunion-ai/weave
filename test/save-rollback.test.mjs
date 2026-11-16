import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { handleMcpMessage } from '../src/mcp.js';
import { tempDir } from './lib/temp.mjs';

const locked = () => Object.assign(new Error('database is locked'), { code: 'ERR_SQLITE_ERROR', errcode: 5, errstr: 'database is locked' });
const full = () => Object.assign(new Error('database or disk is full'), { code: 'ERR_SQLITE_ERROR', errcode: 13, errstr: 'database or disk is full' });

function fixture(t) {
  const path = join(tempDir('weave-save-rollback-'), 'case.db');
  const w = new Weave({ path });
  t.after(() => w.store.close());
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Task' });
  const row = w.createEntity('Task', { name: 'Committed' });
  const other = w.createEntity('Task', { name: 'Bystander' });
  return { w, path, row, other };
}

function failNextCommit(w, make = locked) {
  const real = w.store.save;
  w.store.save = () => {
    w.store.save = real;
    throw make();
  };
}

function onDisk(path, id) {
  const fresh = new Weave({ path });
  try { return fresh.readEntity(id).name; } finally { fresh.store.close(); }
}

test('a failed commit refuses the write as not-saved and reads answer the committed row (Issue #1667)', (t) => {
  const { w, path, row, other } = fixture(t);
  failNextCommit(w);
  assert.throws(() => w.updateEntity(row.id, { Name: 'Lost' }), (err) => err.code === 'not-saved' && /not saved/i.test(err.message));
  assert.equal(w.readEntity(row.id).name, 'Committed', 'memory falls back to the committed row');
  assert.equal(w.query('Task').items.find((e) => e.id === row.id).name, 'Committed');
  w.updateEntity(other.id, { Name: 'Bystander v2' });
  assert.equal(onDisk(path, row.id), 'Committed', 'a later successful save does not write the refused value');
  assert.equal(onDisk(path, other.id), 'Bystander v2');
  assert.equal(w.readEntity(row.id).name, 'Committed');
});

test('a full disk keeps its storage-full refusal and still rolls memory back (Issue #1667)', (t) => {
  const { w, path, row, other } = fixture(t);
  failNextCommit(w, full);
  assert.throws(() => w.updateEntity(row.id, { Name: 'Lost' }), (err) => err.code === 'ERR_SQLITE_ERROR' && err.errcode === 13);
  assert.equal(w.readEntity(row.id).name, 'Committed');
  w.updateEntity(other.id, { Name: 'Bystander v2' });
  assert.equal(onDisk(path, row.id), 'Committed');
});

test('REST answers 503 not-saved for a failed commit and the next GET shows the committed row (Issue #1667)', async (t) => {
  const { w, row } = fixture(t);
  const { server, port } = await startServer(w, { port: 0 });
  t.after(() => server.close());
  const call = async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${port}/api${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  failNextCommit(w);
  const write = await call('PATCH', `/entities/${row.id}`, { Name: 'Lost' });
  assert.equal(write.status, 503);
  assert.equal(write.data.code, 'not-saved');
  assert.match(write.data.error, /not saved/i);
  const read = await call('GET', `/entities/${row.id}`);
  assert.equal(read.status, 200);
  assert.equal(read.data.name, 'Committed');
});

test('MCP refuses a failed commit with the not-saved code (Issue #1667)', (t) => {
  const { w, row } = fixture(t);
  failNextCommit(w);
  const res = handleMcpMessage(w, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'weave_update_entity', arguments: { entity: row.id, values: { Name: 'Lost' } } } });
  assert.equal(res.result.isError, true);
  assert.equal(res.result.structuredContent.code, 'not-saved');
  assert.equal(res.result.structuredContent.rpc, -32009);
  assert.equal(w.readEntity(row.id).name, 'Committed');
});
