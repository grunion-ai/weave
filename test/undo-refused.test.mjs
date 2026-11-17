import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { tempDir } from './lib/temp.mjs';

const locked = () => Object.assign(new Error('database is locked'), { code: 'ERR_SQLITE_ERROR', errcode: 5, errstr: 'database is locked' });

function fixture(t) {
  const path = join(tempDir('weave-undo-refused-'), 'case.db');
  const w = new Weave({ path });
  t.after(() => w.store.close());
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Task' });
  const row = w.createEntity('Task', { name: 'Committed' });
  w.updateEntity(row.id, { Name: 'Second' });
  return { w, path, row };
}

function failNextCommit(w) {
  const real = w.store.save;
  w.store.save = () => {
    w.store.save = real;
    throw locked();
  };
}

const stack = (w) => w.store.listUndo({ actor: w.actor }).map((u) => `${u.kind}:${u.name}`);
const names = (w) => w.query('Task').items.map((e) => e.name).sort();

test('a refused update leaves no undo entry, so one undo takes back the last saved change (Issue #1830)', (t) => {
  const { w, path, row } = fixture(t);
  const before = stack(w);
  failNextCommit(w);
  assert.throws(() => w.updateEntity(row.id, { Name: 'Lost' }), (err) => err.code === 'not-saved');
  assert.deepEqual(stack(w), before);
  const undone = w.undo();
  assert.equal(undone.undone[0].skipped, undefined);
  assert.equal(w.readEntity(row.id).name, 'Committed');
  const fresh = new Weave({ path });
  try { assert.deepEqual(fresh.store.listUndo({ actor: w.actor }).map((u) => `${u.kind}:${u.name}`), ['create:Committed']); } finally { fresh.store.close(); }
});

test('a refused create leaves no undo entry, so one undo takes back the last saved change (Issue #1830)', (t) => {
  const { w, row } = fixture(t);
  const before = stack(w);
  failNextCommit(w);
  assert.throws(() => w.createEntity('Task', { name: 'Ghost' }), (err) => err.code === 'not-saved');
  assert.deepEqual(stack(w), before);
  w.undo();
  assert.equal(w.readEntity(row.id).name, 'Committed');
  assert.deepEqual(names(w), ['Committed']);
});

test('a saved write still lands on the undo stack with its save (Issue #1830)', (t) => {
  const { w, path, row } = fixture(t);
  w.updateEntity(row.id, { Name: 'Third' });
  assert.deepEqual(stack(w), ['update:Third', 'update:Second', 'create:Committed']);
  const fresh = new Weave({ path });
  try { assert.equal(fresh.store.listUndo({ actor: w.actor }).length, 3); } finally { fresh.store.close(); }
});
