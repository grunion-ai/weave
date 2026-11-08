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
