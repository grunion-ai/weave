import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Weave } from '../src/engine.js';
import { tempDir } from './lib/temp.mjs';

const scratch = () => tempDir('weave-pid-');

test('two connections that create in one table get distinct public ids (Issue #1455)', () => {
  const dir = scratch();
  try {
    const path = join(dir, 'ws.db');
    const seed = new Weave({ path });
    seed.createSpace({ name: 'S' });
    const item = seed.createTable({ space: 'S', name: 'Item' });
    const server = new Weave({ path });
    const cli = new Weave({ path });
    const external = cli.createEntity(item.id, { name: 'External during body read' });
    const http = server.createEntity(item.id, { name: 'HTTP after body read' });
    const rows = new Weave({ path }).listEntities(item.id).map((e) => e.publicId).sort();
    assert.deepEqual(rows, [1, 2]);
    assert.notEqual(http.publicId, external.publicId, 'the returned row carries the id it was stored under');
    assert.equal(server.createEntity(item.id, { name: 'Next' }).publicId, 3, 'the counter follows the stored maximum');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('opening a workspace that holds duplicate public ids keeps every row and makes the index unique (Issue #1455)', () => {
  const dir = scratch();
  try {
    const path = join(dir, 'ws.db');
    const w = new Weave({ path });
    w.createSpace({ name: 'S' });
    const item = w.createTable({ space: 'S', name: 'Item' });
    const a = w.createEntity(item.id, { name: 'A' });
    const b = w.createEntity(item.id, { name: 'B' });
    w.store.close();
    const raw = new DatabaseSync(path);
    raw.exec('DROP INDEX idx_entities_pid');
    raw.exec('CREATE INDEX idx_entities_pid ON entities(db_id, public_id)');
    raw.prepare("UPDATE entities SET public_id = 1, json = json_set(json, '$.publicId', 1) WHERE id = ?").run(b.id);
    raw.close();
    const reopened = new Weave({ path });
    const ids = reopened.listEntities(item.id).map((e) => [reopened.readEntity(e.id).name, e.publicId]).sort();
    assert.deepEqual(ids, [['A', 1], ['B', 2]]);
    assert.equal(reopened.readEntity(a.id).publicId, 1, 'the first holder keeps its id');
    const check = new DatabaseSync(path);
    const sql = check.prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_entities_pid'").get().sql;
    check.close();
    assert.match(sql, /UNIQUE/);
    assert.equal(reopened.createEntity(item.id, { name: 'C' }).publicId, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an automation on create sees the public id the row is stored under, not a stale counter (Issue #1455)', () => {
  const dir = scratch();
  try {
    const path = join(dir, 'ws.db');
    const seed = new Weave({ path });
    seed.createSpace({ name: 'S' });
    const item = seed.createTable({ space: 'S', name: 'Item' });
    seed.createAutomation(item.id, { name: 'Remember id', trigger: { type: 'entity-created' }, actions: [{ type: 'add-comment', text: 'Item#{{PublicId}}' }] });
    const stale = new Weave({ path });
    const other = new Weave({ path });
    other.createEntity(item.id, { name: 'External' });
    const row = stale.createEntity(item.id, { name: 'Late' });
    assert.equal(row.publicId, 2);
    assert.deepEqual(stale.readEntity(row.id).comments.map((c) => c.text), ['Item#2']);
    const back = new Weave({ path });
    assert.equal(back.readEntity(row.id).publicId, 2);
    assert.equal(back.getEntity('Item#2').id, row.id);
    for (const w of [seed, stale, other, back]) w.store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the duplicate repair writes one audit line per renumbered record (Issue #1455)', () => {
  const dir = scratch();
  try {
    const path = join(dir, 'ws.db');
    const w = new Weave({ path });
    w.createSpace({ name: 'S' });
    const item = w.createTable({ space: 'S', name: 'Item' });
    w.createEntity(item.id, { name: 'A' });
    const b = w.createEntity(item.id, { name: 'B' });
    w.store.close();
    const raw = new DatabaseSync(path);
    raw.exec('DROP INDEX idx_entities_pid');
    raw.exec('CREATE INDEX idx_entities_pid ON entities(db_id, public_id)');
    raw.prepare("UPDATE entities SET public_id = 1, json = json_set(json, '$.publicId', 1) WHERE id = ?").run(b.id);
    raw.close();
    const reopened = new Weave({ path });
    const lines = reopened.listAudit({ limit: -1 }).filter((r) => r.action === 'public-id-renumbered');
    assert.equal(lines.length, 1);
    assert.deepEqual(lines[0].detail, { table: 'Item', tableId: item.id, entity: b.id, from: 1, to: 2 });
    assert.equal(reopened.readEntity(b.id).publicId, 2);
    reopened.store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
