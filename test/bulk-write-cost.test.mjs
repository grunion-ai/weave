import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Weave } from '../src/engine.js';
import { onDisk, reopen } from './lib/reopen.mjs';
import { tempDir } from './lib/temp.mjs';

const FIXTURE = new URL('./fixtures/weave-v0.4.100.db', import.meta.url);
const ROWS = 2000;

function ftsTables(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'entities_fts%'").all().map((r) => r.name);
  } finally {
    db.close();
  }
}

function transactions(w) {
  const store = w.store;
  const seen = { outer: 0, outside: new Set() };
  let depth = 0;
  const batch = store.batch.bind(store);
  store.batch = (fn) => {
    if (!depth) seen.outer++;
    depth++;
    try { return batch(fn); } finally { depth--; }
  };
  for (const name of ['save', 'pushUndo', 'audit', 'pushDocRevision']) {
    const write = store[name].bind(store);
    store[name] = (...args) => {
      if (!depth) seen.outside.add(name);
      return write(...args);
    };
  }
  return seen;
}

function ledger(prefix) {
  const w = onDisk(prefix);
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Entry' });
  w.addField('Entry', { name: 'Count', type: 'number' });
  w.addField('Entry', { name: 'Note', type: 'text' });
  w.createTable({ space: 'Ops', name: 'Archive' });
  w.addField('Archive', { name: 'Count', type: 'number' });
  return w;
}

const csv = (n, bad = -1) => ['Name,Count,Note', ...Array.from({ length: n }, (_, i) => `row ${i},${i === bad ? 'lots' : i},note ${i}`)].join('\n');
const rowsOf = (w, table) => w.listEntities(w.getTable(table).id);

test('a workspace that had entities_fts drops it and its shadow tables on open, and search still reads names, documents and comments', () => {
  const path = join(tempDir('wv-fts-gone-'), 'weave.db');
  copyFileSync(FIXTURE, path);
  assert.ok(ftsTables(path).includes('entities_fts'), 'the v0.4.100 fixture carries the old index');
  const w = new Weave({ path });
  w.store.close();
  assert.deepEqual(ftsTables(path), [], 'opening dropped the index and every shadow table');
  const again = new Weave({ path });
  for (const [needle, name] of [['apollo launch', 'Apollo Launch'], ['flagship release', 'Apollo Launch'], ['mocks land', 'Apollo Launch']]) {
    assert.ok(again.search(needle).some((h) => h.name === name), `search finds ${name} by '${needle}'`);
  }
  again.store.close();
});

test('a new workspace never writes entities_fts', () => {
  const w = ledger('wv-fts-new-');
  const e = w.createEntity('Entry', { name: 'zephyr', doc: 'manifest text' });
  w.addComment(e.id, { author: 'k', text: 'a note' });
  w.deleteEntity(e.id);
  const again = reopen(w);
  assert.deepEqual(ftsTables(again.store.path), []);
});

test(`importCSV of ${ROWS} rows commits once and keeps every good row when one row is refused`, () => {
  const w = ledger('wv-bulk-csv-');
  const seen = transactions(w);
  const result = w.importCSV('Entry', csv(ROWS, 700));
  assert.equal(seen.outer, 1, 'one transaction for the whole import');
  assert.deepEqual([...seen.outside], [], 'no write ran outside it');
  assert.equal(result.created, ROWS - 1);
  assert.deepEqual(result.errors, [{ row: 702, error: "'lots' is not a number" }]);
  const again = reopen(w);
  assert.equal(rowsOf(again, 'Entry').length, ROWS - 1, 'the rows before and after the refused one are on disk');
});

test(`bulk set over ${ROWS} rows commits once and reports a missing id without losing the rest`, () => {
  const w = ledger('wv-bulk-set-');
  w.importCSV('Entry', csv(ROWS));
  const ids = rowsOf(w, 'Entry').map((e) => e.id);
  const seen = transactions(w);
  const out = w.bulk([...ids, 'no-such-id'], 'set', { values: { Count: 7 } });
  assert.equal(seen.outer, 1, 'one transaction for the whole bulk set');
  assert.deepEqual([...seen.outside], [], 'no write ran outside it');
  assert.equal(out.done.length, ROWS);
  assert.deepEqual(out.failed.map((f) => f.id), ['no-such-id']);
  const again = reopen(w);
  const count = again.findField(again.getTable('Entry'), 'Count').id;
  assert.ok(rowsOf(again, 'Entry').every((e) => e.values[count] === 7), 'every row holds the new value on disk');
});

test(`bulk move of ${ROWS} rows commits once`, () => {
  const w = ledger('wv-bulk-move-');
  w.importCSV('Entry', csv(ROWS));
  const ids = rowsOf(w, 'Entry').map((e) => e.id);
  const seen = transactions(w);
  const out = w.bulk(ids, 'move', { table: 'Archive' });
  assert.equal(seen.outer, 1, 'one transaction for the whole move');
  assert.deepEqual([...seen.outside], [], 'no write ran outside it');
  assert.equal(out.moved.length, ROWS);
  const again = reopen(w);
  assert.equal(rowsOf(again, 'Entry').length, 0);
  assert.equal(rowsOf(again, 'Archive').length, ROWS);
});
