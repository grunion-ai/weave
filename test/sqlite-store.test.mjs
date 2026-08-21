import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Weave, WeaveError } from '../src/engine.js';
import { startServer } from '../src/server.js';

function tmp() {
  return mkdtempSync(join(tmpdir(), 'weave-sqlite-'));
}

// Build a small workspace and return the engine.
function seed(w) {
  w.createSpace({ name: 'Product' });
  w.createTable({ space: 'Product', name: 'Task' });
  w.addField('Task', {
    name: 'State', type: 'workflow',
    config: { states: [{ name: 'Open', category: 'not-started', default: true }, { name: 'Done', category: 'done' }] },
  });
  w.createEntity('Task', { name: 'First', doc: 'alpha bravo searchable' });
  w.createEntity('Task', { name: 'Second' });
  return w;
}

test('fresh .db workspace: persistence roundtrip, file is real SQLite', () => {
  const dir = tmp();
  const dbPath = join(dir, 'ws.db');
  const w = seed(new Weave({ path: dbPath }));
  w.addComment(w.findEntity('Task', '#1').id, { author: 'kyle', text: 'note' });

  assert.ok(existsSync(dbPath));
  const magic = readFileSync(dbPath).subarray(0, 16).toString('utf8');
  assert.ok(magic.startsWith('SQLite format 3'), `not a SQLite file: ${magic}`);

  const w2 = new Weave({ path: dbPath });
  assert.equal(w2.listSpaces().filter((sp) => !sp.system).length, 1);
  const e = w2.findEntity('Task', '#1');
  assert.equal(w2.entityName(e), 'First');
  assert.equal(w2.getDoc(e.id), 'alpha bravo searchable');
  assert.equal(e.comments.length, 1);
  assert.equal(e.values[Object.keys(e.values).find((k) => w2.getTable('Task').fields[k]?.type === 'workflow')], 'open');
});

test('legacy .json workspace auto-migrates to sibling .db; json preserved untouched', () => {
  const dir = tmp();
  const jsonPath = join(dir, 'legacy.json');
  const mem = seed(new Weave());
  writeFileSync(jsonPath, JSON.stringify(mem.exportJSON(), null, 1));
  const originalBytes = readFileSync(jsonPath);

  const w = new Weave({ path: jsonPath });
  assert.ok(existsSync(join(dir, 'legacy.db')), 'sibling .db not created');
  assert.deepEqual(readFileSync(jsonPath), originalBytes, 'legacy json was rewritten');
  assert.equal(w.entityName(w.findEntity('Task', '#1')), 'First');

  // Reopening via the .json path must use the .db (mutations persist there, json stays frozen).
  w.createEntity('Task', { name: 'Third' });
  const w2 = new Weave({ path: jsonPath });
  assert.ok(w2.findEntity('Task', '#3'), 'mutation lost on reopen via .json path');
  assert.deepEqual(readFileSync(jsonPath), originalBytes);
});

test('exportJSON survives migration deep-equal', () => {
  const dir = tmp();
  const jsonPath = join(dir, 'x.json');
  const mem = seed(new Weave());
  writeFileSync(jsonPath, JSON.stringify(mem.exportJSON(), null, 1));
  const w = new Weave({ path: jsonPath });
  assert.deepEqual(w.exportJSON(), mem.exportJSON());
});

test('row-level writes: mutating one entity leaves other rows byte-identical', () => {
  const dir = tmp();
  const dbPath = join(dir, 'rows.db');
  const w = seed(new Weave({ path: dbPath }));
  const a = w.findEntity('Task', '#1');
  const b = w.findEntity('Task', '#2');

  const read = () => {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = Object.fromEntries(db.prepare('SELECT id, json FROM entities').all().map((r) => [r.id, r.json]));
    db.close();
    return rows;
  };
  const before = read();
  w.updateEntity(a.id, { Name: 'First renamed' });
  const after = read();
  assert.equal(after[b.id], before[b.id], 'untouched entity row was rewritten');
  assert.notEqual(after[a.id], before[a.id], 'mutated entity row unchanged');
});

test('cross-connection freshness: second engine sees committed writes via maybeRefresh', () => {
  const dir = tmp();
  const dbPath = join(dir, 'shared.db');
  const a = seed(new Weave({ path: dbPath }));
  const b = new Weave({ path: dbPath });

  a.createEntity('Task', { name: 'From A' });
  assert.equal(b.findEntity('Task', 'From A'), undefined, 'stale read expected before refresh');
  assert.equal(b.maybeRefresh(), true);
  assert.ok(b.findEntity('Task', 'From A'));

  // B writes; A refreshes and sees it — no clobbering in either direction.
  b.createEntity('Task', { name: 'From B' });
  assert.equal(a.maybeRefresh(), true);
  assert.ok(a.findEntity('Task', 'From A'));
  assert.ok(a.findEntity('Task', 'From B'));
  assert.equal(a.maybeRefresh(), false, 'no external change → no reload');
});

test('server refreshes per request: external CLI-style write is visible over HTTP', async () => {
  const dir = tmp();
  const dbPath = join(dir, 'served.db');
  seed(new Weave({ path: dbPath }));
  const weave = new Weave({ path: dbPath });
  const { server } = await startServer(weave, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const cli = new Weave({ path: dbPath });
    cli.createEntity('Task', { name: 'Written externally' });
    const res = await fetch(`${base}/api/tables/Task/entities`);
    const { items } = await res.json();
    assert.ok(items.some((e) => e.name === 'Written externally'));
  } finally {
    server.close();
  }
});

test('guards: foreign sqlite refused, garbage refused, non-workspace json still refused', () => {
  const dir = tmp();

  const foreign = join(dir, 'foreign.db');
  const db = new DatabaseSync(foreign);
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
  db.close();
  assert.throws(() => new Weave({ path: foreign }), WeaveError);

  const garbage = join(dir, 'garbage.db');
  writeFileSync(garbage, 'this is not sqlite at all, definitely more than sixteen bytes');
  assert.throws(() => new Weave({ path: garbage }), WeaveError);

  const pkg = join(dir, 'package.json');
  writeFileSync(pkg, JSON.stringify({ name: 'x', version: '1.0.0' }));
  assert.throws(() => new Weave({ path: pkg }), WeaveError);
  assert.ok(!existsSync(join(dir, 'package.db')), 'must not create a db beside non-workspace json');
});

test('FTS5 index exists and tracks entity lifecycle', () => {
  const dir = tmp();
  const dbPath = join(dir, 'fts.db');
  const w = seed(new Weave({ path: dbPath }));
  const hits = () => {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare("SELECT id FROM entities_fts WHERE entities_fts MATCH 'searchable'").all();
    db.close();
    return rows.map((r) => r.id);
  };
  const e = w.findEntity('Task', '#1');
  assert.deepEqual(hits(), [e.id]);
  w.deleteEntity(e.id);
  assert.deepEqual(hits(), [], 'deleted entity still in FTS index');
});

test('failed create rolls back cleanly: no orphan row persisted', () => {
  const dir = tmp();
  const dbPath = join(dir, 'rollback.db');
  const w = seed(new Weave({ path: dbPath }));
  assert.throws(() => w.createEntity('Task', { name: 'Bad', values: { Nope: 1 } }), WeaveError);
  w.createEntity('Task', { name: 'Good' });
  const w2 = new Weave({ path: dbPath });
  const names = w2.listEntities(w2.getTable('Task').id).map((e) => w2.entityName(e)).sort();
  assert.deepEqual(names, ['First', 'Good', 'Second']);
});

test('schema cascades persist across reopen (deleteField, deleteTable)', () => {
  const dir = tmp();
  const dbPath = join(dir, 'cascade.db');
  const w = seed(new Weave({ path: dbPath }));
  w.createTable({ space: 'Product', name: 'Project' });
  w.addRelation('Task', { name: 'Project', targetDb: 'Project', cardinality: 'many-to-one', inverseName: 'Tasks' });
  const p = w.createEntity('Project', { name: 'P1' });
  w.updateEntity(w.findEntity('Task', '#1').id, { Project: p.id });

  w.deleteField('Task', 'Project');
  const w2 = new Weave({ path: dbPath });
  assert.equal(w2.findField(w2.getTable('Task'), 'Project'), undefined);
  assert.equal(w2.findField(w2.getTable('Project'), 'Tasks'), undefined);

  w2.deleteTable('Project');
  const w3 = new Weave({ path: dbPath });
  assert.equal(w3.findTable('Project'), undefined);
  assert.equal(w3.listEntities(w3.getTable('Task').id).length, 2);
});

test('hub discovers .db siblings and dedupes a migrated json/db pair', async () => {
  const dir = tmp();
  // Default workspace as .db; one legacy sibling json; one native sibling db; one junk json.
  const main = seed(new Weave({ path: join(dir, 'main.db') }));
  main.state.meta.name = 'main';
  main.save();
  const memA = new Weave();
  memA.state.meta.name = 'siblingjson';
  memA.createSpace({ name: 'S' });
  writeFileSync(join(dir, 'siblingjson.json'), JSON.stringify(memA.exportJSON(), null, 1));
  const nativeDb = new Weave({ path: join(dir, 'nativedb.db') });
  nativeDb.state.meta.name = 'nativedb';
  nativeDb.save();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'junk' }));

  const { server } = await startServer(main, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const list = await (await fetch(`${base}/api/workspaces`)).json();
    const names = list.map((x) => x.name).sort();
    assert.deepEqual(names, ['main', 'nativedb', 'siblingjson']);
    // The sibling json is now migrated; a second listing must not duplicate it.
    const list2 = await (await fetch(`${base}/api/workspaces`)).json();
    assert.equal(list2.length, 3);
    assert.ok(existsSync(join(dir, 'siblingjson.db')));
  } finally {
    server.close();
  }
});

test('workspace file gains WAL journal mode', () => {
  const dir = tmp();
  const dbPath = join(dir, 'wal.db');
  seed(new Weave({ path: dbPath }));
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const { journal_mode } = db.prepare('PRAGMA journal_mode').get();
  db.close();
  assert.equal(journal_mode, 'wal');
});

test('in-memory engine (no path) still works with no sqlite side effects', () => {
  const w = seed(new Weave());
  assert.equal(w.maybeRefresh(), false);
  assert.equal(w.store.path, null);
  const e = w.findEntity('Task', '#1');
  w.attachFile(e.id, { name: 'a.txt', mime: 'text/plain', bytes: Buffer.from('hi').toString('base64') });
  assert.equal(w.readFile(e.files[0].id).bytes.toString(), 'hi');
});
