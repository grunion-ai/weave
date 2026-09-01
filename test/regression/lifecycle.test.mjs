/* The lifecycle regression pack — the gate that fires on every build.

   Twelve named operations: workspace, space, table, entity × create, delete,
   restore. Each level runs one ordered scenario — create → verify live →
   delete → verify hidden → restore → verify back intact — and each operation
   is its own named test, because these names are the breadcrumb vocabulary:
   when the gate rejects a build, the Gerrit comment lists exactly the tests
   below that failed.

   weave-review.sh runs this file FIRST (--test-name-pattern 'lifecycle:');
   a red here rejects the change before the long suite even starts. Keep it
   fast (in-memory stores, one sqlite reopen) and keep the names stable. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../../src/engine.js';
import { startServer } from '../../src/server.js';

/* ---------- entity ---------- */

const ew = new Weave();
ew.createSpace({ name: 'Reg' });
const eTable = ew.createTable({ space: 'Reg', name: 'Item' });
let entity;

test('lifecycle: entity create', () => {
  entity = ew.createEntity(eTable, { name: 'Alpha' });
  assert.equal(ew.readEntity(entity.id).name, 'Alpha');
  assert.equal(ew.query(eTable, {}).total, 1);
});

test('lifecycle: entity delete hides the row but keeps it readable', () => {
  ew.deleteEntity(entity.id);
  assert.equal(ew.query(eTable, {}).total, 0);
  assert.equal(ew.search('Alpha').length, 0);
  assert.ok(ew.readEntity(entity.id).deletedAt, 'still readable by id, marked deleted');
  assert.deepEqual(ew.listTrash(eTable).map((e) => e.name), ['Alpha']);
});

test('lifecycle: entity restore brings the row back intact', () => {
  ew.restoreEntity(entity.id);
  assert.equal(ew.query(eTable, {}).total, 1);
  assert.equal(ew.readEntity(entity.id).deletedAt, null);
  assert.equal(ew.readEntity(entity.id).publicId, entity.publicId, 'identity survives the round trip');
});

/* ---------- table ---------- */

const tw = new Weave();
tw.createSpace({ name: 'Reg' });
const anchor = tw.createTable({ space: 'Reg', name: 'Anchor' });
const anchorRow = tw.createEntity(anchor, { name: 'Home' });
let tTable;
let tRow;

test('lifecycle: table create', () => {
  tTable = tw.createTable({ space: 'Reg', name: 'Load' });
  tw.addRelation(tTable, { name: 'Anchor', targetDb: anchor, cardinality: 'many-to-one', inverseName: 'Loads' });
  tRow = tw.createEntity(tTable, { name: 'Cargo', values: { Anchor: anchorRow.id } });
  assert.ok(tw.findTable('Reg/Load'));
  assert.equal(tw.readEntity(anchorRow.id).fields.Loads.length, 1);
});

test('lifecycle: table delete hides the table and its rows from every read', () => {
  tw.deleteTable(tTable.id);
  assert.ok(!tw.listTables().some((d) => d.id === tTable.id));
  assert.equal(tw.findTable('Reg/Load'), undefined);
  assert.equal(tw.search('Cargo').length, 0);
  assert.deepEqual(tw.readEntity(anchorRow.id).fields.Loads, [], 'relations must not read through the trash');
  assert.equal(tw.readEntity(tRow.id).name, 'Cargo', 'the rows were kept, not purged');
});

test('lifecycle: table restore brings rows and relations back', () => {
  tw.restoreTable(tTable.id);
  assert.equal(tw.getTable('Reg/Load').deletedAt, null);
  assert.equal(tw.query(tTable.id, {}).total, 1);
  assert.deepEqual(tw.readEntity(anchorRow.id).fields.Loads.map((e) => e.name), ['Cargo']);
});

/* ---------- space ---------- */

const sw = new Weave();
let sSpace;
let sTable;
let sRow;

test('lifecycle: space create', () => {
  sSpace = sw.createSpace({ name: 'Bay' });
  sTable = sw.createTable({ space: 'Bay', name: 'Crate' });
  sRow = sw.createEntity(sTable, { name: 'Box' });
  assert.ok(sw.describeSchema().some((s) => s.space === 'Bay'));
});

test('lifecycle: space delete hides the space and everything in it', () => {
  sw.deleteSpace(sSpace.id);
  assert.equal(sw.findSpace('Bay'), undefined);
  assert.ok(!sw.listTables().some((d) => d.id === sTable.id));
  assert.equal(sw.search('Box').length, 0);
  assert.equal(sw.readEntity(sRow.id).name, 'Box', 'contents kept, hidden by the parent');
});

test('lifecycle: space restore rejoins the whole subtree', () => {
  sw.restoreSpace(sSpace.id);
  assert.ok(sw.findSpace('Bay'));
  assert.deepEqual(sw.describeSchema().find((s) => s.space === 'Bay').tables.map((t) => t.name), ['Crate']);
  assert.equal(sw.query('Bay/Crate', {}).total, 1);
});

/* ---------- workspace (hub level, REST) ---------- */

const wsDir = mkdtempSync(join(tmpdir(), 'weave-lifecycle-'));
const wsMain = new Weave({ path: join(wsDir, 'main.db') });
wsMain.state.meta.name = 'main';
wsMain.save();
let wsBase;
let wsServer;
const wsApi = async (method, path) => {
  const res = await fetch(wsBase + path, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'POST' && path === '/api/workspaces' ? '{"name":"probe"}' : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
};

test('lifecycle: workspace create', async () => {
  ({ server: wsServer } = await startServer(wsMain, { port: 0 }));
  wsBase = `http://127.0.0.1:${wsServer.address().port}`;
  assert.equal((await wsApi('POST', '/api/workspaces')).status, 201);
  assert.ok((await wsApi('GET', '/api/workspaces')).data.some((w) => w.name === 'probe'));
});

test('lifecycle: workspace delete leaves the hub list, file untouched', async () => {
  assert.equal((await wsApi('DELETE', '/api/workspaces/probe')).status, 200);
  assert.ok(!(await wsApi('GET', '/api/workspaces')).data.some((w) => w.name === 'probe'));
  assert.ok((await wsApi('GET', '/api/workspaces?deleted=1')).data.find((w) => w.name === 'probe')?.deletedAt);
  assert.equal((await wsApi('GET', '/w/probe/api/health')).status, 200, 'the URL keeps answering');
});

test('lifecycle: workspace restore rejoins hub routing', async () => {
  try {
    assert.equal((await wsApi('POST', '/api/workspaces/probe/restore')).status, 200);
    assert.ok((await wsApi('GET', '/api/workspaces')).data.some((w) => w.name === 'probe'));
  } finally {
    wsServer.close();
    rmSync(wsDir, { recursive: true, force: true });
  }
});

/* ---------- persistence: the tombstones are storage truth ---------- */

test('lifecycle: trash state survives a save/reload cycle', () => {
  const w = new Weave();
  w.createSpace({ name: 'Keep' });
  const t = w.createTable({ space: 'Keep', name: 'Thing' });
  const e = w.createEntity(t, { name: 'One' });
  w.deleteEntity(e.id);
  w.deleteTable(t.id);
  const reopened = new Weave();
  reopened.importJSON(w.exportJSON());
  assert.ok(!reopened.listTables().some((d) => d.name === 'Thing'));
  reopened.restoreTable(t.id);
  assert.deepEqual(reopened.listTrash('Keep/Thing').map((x) => x.name), ['One']);
});
