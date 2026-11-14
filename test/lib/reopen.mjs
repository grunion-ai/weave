import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Weave } from '../../src/engine.js';
import { tempDir } from './temp.mjs';

export function onDisk(prefix = 'wv-reopen-') {
  return new Weave({ path: join(tempDir(prefix), 'w.db') });
}

export function reopen(w) {
  assert.ok(w.store.path, 'only a workspace with a file reopens');
  return new Weave({ path: w.store.path });
}

export function storedValues(w, table, field) {
  const db = w.getTable(table);
  const f = w.getField(db.id, field);
  return w.listEntities(db.id).map((e) => e.values[f.id] ?? null);
}

const kindOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

export function assertValueTypes(w, table, field, kind) {
  const values = storedValues(w, table, field);
  assert.ok(values.length, `${table}.${field} has rows to check`);
  assert.deepEqual(values.map(kindOf), values.map(() => kind), `${table}.${field} holds ${kind} values, read ${JSON.stringify(values)}`);
}
