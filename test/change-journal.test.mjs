import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Weave } from '../src/engine.js';
import { Store, JOURNAL_CAP } from '../src/store.js';
import { tempDir } from './lib/temp.mjs';

const CLI = fileURLToPath(new URL('../bin/weave.js', import.meta.url));

function seeded(rows) {
  const path = join(tempDir('weave-journal-'), 'w.db');
  const w = new Weave({ path });
  w.createSpace({ name: 'Product' });
  w.createTable({ space: 'Product', name: 'Task' });
  w.createTable({ space: 'Product', name: 'Note' });
  w.store.batch(() => {
    for (let i = 0; i < rows; i++) w.createEntity('Task', { name: `Row ${i}` });
  });
  return { path, w };
}

function journal(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare('SELECT entity_id FROM changes ORDER BY seq').all().map((r) => r.entity_id);
  } finally {
    db.close();
  }
}

function raw(path, sql, ...params) {
  const db = new DatabaseSync(path);
  try {
    db.prepare(sql).run(...params);
  } finally {
    db.close();
  }
}

function fullLoad(path) {
  const store = new Store(path);
  try {
    return store.load();
  } finally {
    store.close();
  }
}

function parsesDuring(fn) {
  const parse = JSON.parse;
  let count = 0;
  JSON.parse = function counted(...args) {
    count++;
    return parse.apply(this, args);
  };
  try {
    fn();
  } finally {
    JSON.parse = parse;
  }
  return count;
}

const nameOf = (w, id) => w.entityName(w.getEntity(id));

test('store.save writes the journal row inside its own transaction', () => {
  const { path, w } = seeded(2);
  const [one, two] = ['#1', '#2'].map((ref) => w.findEntity('Task', ref).id);
  const store = new Store(path);
  const state = store.load();
  const before = journal(path).length;

  state.entities[one].updatedAt = '2030-01-01T00:00:00.000Z';
  store.save(state, { dirty: new Set([one]) });
  assert.deepEqual(journal(path).slice(before), [one], 'the committed save journals the row it wrote');

  state.entities[two].unstorable = 1n;
  assert.throws(() => store.save(state, { dirty: new Set([one, two]) }), /BigInt/);
  assert.deepEqual(journal(path).slice(before), [one], 'a save that rolls back leaves no journal row');
  store.close();
});

test('a CLI write followed by a server read reparses only the changed rows', () => {
  const { path, w: server } = seeded(200);
  const row = server.findEntity('Task', '#7');
  execFileSync(process.execPath, [CLI, '--data', path, 'update', row.id, '--values', JSON.stringify({ Name: 'Written by the CLI' })], { encoding: 'utf8' });

  const parses = parsesDuring(() => assert.equal(server.maybeRefresh(), true));
  assert.equal(nameOf(server, row.id), 'Written by the CLI');
  assert.ok(parses < 5, `the refresh after a one-row CLI write parsed ${parses} JSON values in a 200-row workspace`);
  assert.deepEqual(server.state, fullLoad(path), 'the refreshed state equals a full load');

  const full = parsesDuring(() => server.store.reload());
  assert.ok(full > 200, `a full reload parses every row (${full})`);
});

test('reload() applies the journal rows above the last seen sequence and keeps every other row', () => {
  const { path, w: writer } = seeded(20);
  const [kept, changed, dropped] = ['#1', '#2', '#3'].map((ref) => writer.findEntity('Task', ref).id);
  const store = new Store(path);
  const state = store.load();

  writer.updateEntity(changed, { Name: 'Changed elsewhere' });
  writer.deleteEntity(dropped, { hard: true });
  const added = writer.createEntity('Task', { name: 'Added elsewhere' }).id;

  const next = store.reload(state);
  assert.equal(next.entities[kept], state.entities[kept], 'a row with no journal row keeps its parsed object');
  assert.notEqual(next.entities[changed], state.entities[changed]);
  assert.equal(next.entities[dropped], undefined, 'a row deleted elsewhere leaves');
  assert.ok(next.entities[added], 'a row created elsewhere arrives');
  assert.deepEqual(next, fullLoad(path));
  assert.equal(store.reload(next).entities[kept], state.entities[kept], 'a reload with nothing new keeps every row');
  store.close();
});

test('a table changed elsewhere is reparsed alone; the other tables keep their objects', () => {
  const { path, w: server } = seeded(3);
  const other = new Weave({ path });
  const task = server.getTable('Task').id;
  const note = server.getTable('Note').id;
  const before = { task: server.state.tables[task], note: server.state.tables[note] };

  other.addField('Note', { name: 'Body', type: 'text' });
  assert.equal(server.maybeRefresh(), true);
  assert.equal(server.state.tables[task], before.task, 'an unchanged table keeps its object');
  assert.notEqual(server.state.tables[note], before.note);
  assert.ok(Object.values(server.state.tables[note].fields).some((f) => f.name === 'Body'));
  assert.deepEqual(server.state, fullLoad(path));
});

test('a write from a process that predates the journal still reaches the server', () => {
  const { path, w: server } = seeded(3);
  const row = server.findEntity('Task', '#1').id;
  raw(path, "UPDATE entities SET json = json_set(json, '$.updatedAt', ?) WHERE id = ?", '2030-01-01T00:00:00.000Z', row);

  assert.equal(server.maybeRefresh(), true);
  assert.equal(server.state.entities[row].updatedAt, '2030-01-01T00:00:00.000Z');
  assert.deepEqual(server.state, fullLoad(path));
});

test('a save made between two refreshes does not skip a write made elsewhere', () => {
  const { path, w: server } = seeded(3);
  const other = new Weave({ path });
  const [mine, theirs] = ['#1', '#2'].map((ref) => server.findEntity('Task', ref).id);

  other.updateEntity(theirs, { Name: 'Theirs' });
  server.updateEntity(mine, { Name: 'Mine' });
  assert.equal(server.maybeRefresh(), true);
  assert.equal(nameOf(server, theirs), 'Theirs');
  assert.equal(nameOf(server, mine), 'Mine');
  assert.deepEqual(server.state.entities, fullLoad(path).entities);
});

test('a reader whose last seen row left the journal reloads in full', () => {
  const { path, w: server } = seeded(10);
  const other = new Weave({ path });
  const row = server.findEntity('Task', '#1').id;

  other.updateEntity(row, { Name: 'After the prune' });
  raw(path, 'DELETE FROM changes');
  const parses = parsesDuring(() => assert.equal(server.maybeRefresh(), true));
  assert.equal(nameOf(server, row), 'After the prune');
  assert.ok(parses > 10, `the fallback parsed every row (${parses})`);
  assert.deepEqual(server.state, fullLoad(path));
});

test('the journal keeps its newest JOURNAL_CAP rows', () => {
  const { path, w } = seeded(1);
  const row = w.findEntity('Task', '#1').id;
  const db = new DatabaseSync(path);
  const add = db.prepare('INSERT INTO changes (entity_id) VALUES (?)');
  db.exec('BEGIN');
  for (let i = 0; i < JOURNAL_CAP + 50; i++) add.run('filler');
  db.exec('COMMIT');
  db.close();

  w.updateEntity(row, { Name: 'Pruned' });
  const rows = journal(path);
  assert.equal(rows.length, JOURNAL_CAP);
  assert.equal(rows.at(-1), row);
});
