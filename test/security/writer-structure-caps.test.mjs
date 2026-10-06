import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* Issue #489: three writer routes changed structure without the schema or
   system-table check. POST /api/tables/:t/relations adds a field, so it is a
   schema write (admin); POST /api/bulk and POST /api/tables/:t/import.csv
   write rows the path does not name, so every row and target table they
   reach takes the same system-table check as the single-entity doors. */

process.env.WEAVE_KEYSTORE = join(mkdtempSync(join(tmpdir(), 'weave-ks-')), 'keystore.json');
const { Weave } = await import('../../src/engine.js');
const { createWorkspaceHub } = await import('../../src/server.js');
const { client } = await import('../lib/fixtures.mjs');

function build({ accounts = true } = {}) {
  const w = new Weave();
  w.updateWorkspace({ name: 'ws' });
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  w.addField('Dev/Task', { name: 'Title', type: 'text' });
  w.addRelation('Dev/Task', { name: 'Parent', targetDb: 'Dev/Task', inverseName: 'Children' });
  const row = w.createEntity('Dev/Task', { name: 'one' });
  const sys = (kind) => Object.values(w.state.tables).find((t) => t.system === kind);
  const titleRow = w.query(sys('fields').id, { where: [['Name', '=', 'Title']] }).items[0];
  const ids = accounts ? {
    admin: w.createAccount({ name: 'a', role: 'admin' }).token,
    writer: w.createAccount({ name: 'wr', role: 'writer' }).token,
    reader: w.createAccount({ name: 'rd', role: 'reader' }).token,
  } : {};
  return { w, call: client(createWorkspaceHub(w)), row, sys, titleRow, ...ids };
}

const structure = (w) => JSON.stringify(w.describeSchema());

test('writer: bulk set on a Fields row is refused and the field keeps its name', async () => {
  const { w, call, writer, titleRow } = build();
  const before = structure(w);
  const r = await call('POST', '/api/bulk', { token: writer, body: { ids: [titleRow.id], op: 'set', values: { Name: 'Renamed' } } });
  assert.equal(r.status, 403);
  assert.equal(structure(w), before);
});

test('writer: bulk rollup into a system table is refused', async () => {
  const { w, call, writer, row, sys } = build();
  const before = structure(w);
  const r = await call('POST', '/api/bulk', { token: writer, body: { ids: [row.id], op: 'rollup', field: 'Parent', table: sys('spaces').id, name: 'Evil' } });
  assert.equal(r.status, 403);
  assert.equal(structure(w), before);
});

test('writer: creating a relation is a schema write', async () => {
  const { w, call, writer } = build();
  const before = structure(w);
  const r = await call('POST', '/api/tables/Task/relations', { token: writer, body: { name: 'Blocks', targetDb: 'Dev/Task' } });
  assert.equal(r.status, 403);
  assert.equal(structure(w), before);
});

test('writer: CSV import into a system table is refused', async () => {
  const { w, call, writer, sys } = build();
  const before = structure(w);
  const r = await call('POST', `/api/tables/${sys('spaces').id}/import.csv`, { token: writer, body: { csv: 'Name\nEvil\n' } });
  assert.equal(r.status, 403);
  const r2 = await call('POST', '/api/tables/Spaces/import.csv', { token: writer, body: { csv: 'Name\nEvil\n' } });
  assert.equal(r2.status, 403);
  assert.equal(structure(w), before);
});

test('writer: the same routes still work on user rows and tables', async () => {
  const { w, call, writer, row } = build();
  const r = await call('POST', '/api/bulk', { token: writer, body: { ids: [row.id], op: 'set', values: { Title: 'hi' } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.done, [row.id]);
  const rollup = await call('POST', '/api/bulk', { token: writer, body: { ids: [row.id], op: 'rollup', field: 'Parent', name: 'Epic' } });
  assert.equal(rollup.status, 200);
  const csv = await call('POST', '/api/tables/Task/import.csv', { token: writer, body: { csv: 'Name,Title\ntwo,x\n' } });
  assert.equal(csv.status, 200);
  assert.equal(w.listEntities(w.getTable('Dev/Task').id).length, 3, 'one, the Epic parent, two');
});

test('reader is refused all three; admin keeps all three', async () => {
  const { call, reader, admin, sys, titleRow } = build();
  assert.equal((await call('POST', '/api/tables/Task/relations', { token: reader, body: { name: 'X', targetDb: 'Dev/Task' } })).status, 403);
  assert.equal((await call('POST', '/api/bulk', { token: reader, body: { ids: [titleRow.id], op: 'set', values: { Name: 'R' } } })).status, 403);
  assert.equal((await call('POST', '/api/tables/Task/import.csv', { token: reader, body: { csv: 'Name\nx\n' } })).status, 403);
  assert.equal((await call('POST', '/api/tables/Task/relations', { token: admin, body: { name: 'Blocks', targetDb: 'Dev/Task' } })).status, 201);
  assert.equal((await call('POST', '/api/bulk', { token: admin, body: { ids: [titleRow.id], op: 'set', values: { Name: 'Heading' } } })).status, 200);
  assert.equal((await call('POST', `/api/tables/${sys('spaces').id}/import.csv`, { token: admin, body: { csv: 'Name\nOps\n' } })).status, 200);
});

test('no credentials: open with no accounts and the wall off; refused behind the wall', async () => {
  const open = build({ accounts: false });
  assert.equal((await open.call('POST', '/api/tables/Task/relations', { body: { name: 'Blocks', targetDb: 'Dev/Task' } })).status, 201);
  assert.equal((await open.call('POST', '/api/bulk', { body: { ids: [open.titleRow.id], op: 'set', values: { Name: 'Heading' } } })).status, 200);
  const walled = build();
  walled.w.setRequireAuth(true);
  assert.equal((await walled.call('POST', '/api/tables/Task/relations', { body: { name: 'Blocks', targetDb: 'Dev/Task' } })).status, 401);
  assert.equal((await walled.call('POST', '/api/bulk', { body: { ids: [walled.titleRow.id], op: 'set', values: { Name: 'R' } } })).status, 401);
  assert.equal((await walled.call('POST', '/api/tables/Task/import.csv', { body: { csv: 'Name\nx\n' } })).status, 401);
});
