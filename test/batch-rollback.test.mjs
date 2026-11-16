import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { Store } from '../src/store.js';
import { startServer } from '../src/server.js';
import { handleMcpMessage } from '../src/mcp.js';
import { tempDir } from './lib/temp.mjs';

const locked = () => Object.assign(new Error('database is locked'), { code: 'ERR_SQLITE_ERROR', errcode: 5, errstr: 'database is locked' });

function fixture(t) {
  const path = join(tempDir('weave-batch-rollback-'), 'case.db');
  const w = new Weave({ path });
  t.after(() => w.store.close());
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Task' });
  const keep = w.createEntity('Task', { name: 'Keep' });
  return { w, path, keep };
}

function failNextCommit(w, make = locked) {
  const real = w.store.save;
  w.store.save = () => {
    w.store.save = real;
    throw make();
  };
}

const names = (w) => w.query('Task').items.map((e) => e.name).sort();

function onDisk(path) {
  const fresh = new Weave({ path });
  try { return names(fresh); } finally { fresh.store.close(); }
}

test('a failed create is refused as not-saved, leaves no row in memory, and a later save does not commit it (Issue #1829)', (t) => {
  const { w, path, keep } = fixture(t);
  failNextCommit(w);
  assert.throws(() => w.createEntity('Task', { name: 'Ghost' }), (err) => err.code === 'not-saved' && /not saved/i.test(err.message));
  assert.deepEqual(names(w), ['Keep']);
  assert.deepEqual(onDisk(path), ['Keep']);
  w.updateEntity(keep.id, { Name: 'Keep v2' });
  assert.deepEqual(names(w), ['Keep v2']);
  assert.deepEqual(onDisk(path), ['Keep v2'], 'the refused row never reaches the database');
});

test('a failed run start is refused as not-saved and leaves no run behind (Issue #1829)', (t) => {
  const { w, path, keep } = fixture(t);
  failNextCommit(w);
  assert.throws(() => w.startRun({ name: 'Ghost run' }), (err) => err.code === 'not-saved');
  assert.equal(w.listRuns().items?.length ?? w.listRuns().length, 0);
  w.updateEntity(keep.id, { Name: 'Keep v2' });
  const fresh = new Weave({ path });
  try {
    const runs = fresh.listRuns();
    assert.equal(runs.items?.length ?? runs.length, 0, 'the refused run never reaches the database');
  } finally { fresh.store.close(); }
});

test('a bug inside a batch keeps its internal code and still rolls memory back (Issue #1829)', (t) => {
  const { w, path, keep } = fixture(t);
  failNextCommit(w, () => new TypeError('boom'));
  assert.throws(() => w.createEntity('Task', { name: 'Ghost' }), (err) => err instanceof TypeError);
  assert.deepEqual(names(w), ['Keep']);
  w.updateEntity(keep.id, { Name: 'Keep v2' });
  assert.deepEqual(onDisk(path), ['Keep v2']);
});

test('REST and MCP refuse a failed create with not-saved (Issue #1829)', async (t) => {
  const { w } = fixture(t);
  const { server, port } = await startServer(w, { port: 0 });
  t.after(() => server.close());
  failNextCommit(w);
  const res = await fetch(`http://127.0.0.1:${port}/api/tables/Task/entities`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Name: 'Ghost' }) });
  const body = await res.json();
  assert.equal(res.status, 503);
  assert.equal(body.code, 'not-saved');
  failNextCommit(w);
  const rpc = handleMcpMessage(w, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'weave_create_entity', arguments: { db: 'Task', name: 'Ghost' } } });
  assert.equal(rpc.result.isError, true);
  assert.equal(rpc.result.structuredContent.code, 'not-saved');
  assert.deepEqual(names(w), ['Keep']);
});

test('every store batch hands its rollback to the engine that owns the store, so no caller can skip it (Issue #1829)', (t) => {
  const path = join(tempDir('weave-batch-hook-'), 'case.db');
  const store = new Store(path);
  t.after(() => store.close());
  store.load();
  const seen = [];
  store.onRollback = (err, loaded) => { seen.push([err.message, typeof loaded]); return new Error('mapped'); };
  assert.throws(() => store.batch(() => { throw new Error('inner'); }), /mapped/);
  assert.deepEqual(seen, [['inner', 'object']]);
  const { w } = fixture(t);
  assert.equal(typeof w.store.onRollback, 'function', 'the engine registers its rollback on the store it opens');
});
