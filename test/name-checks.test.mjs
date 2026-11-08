import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

const conflict = (fn, message) => assert.throws(fn, (err) => err.code === 'conflict' && err.message === message, message);

const ws = () => {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Ops', name: 'Task' });
  return w;
};

test('a space name is free only when no live or trashed space holds it, in any case', () => {
  const w = ws();
  conflict(() => w.createSpace({ name: 'ops' }), "Space 'ops' already exists");
  w.createSpace({ name: 'Old' });
  w.deleteSpace('Old');
  conflict(() => w.createSpace({ name: 'OLD' }), "Space 'OLD' is in the trash — restore or purge it first");
});

test('restoring a space refuses a name a live space took meanwhile', () => {
  const w = ws();
  const old = w.createSpace({ name: 'Old' });
  w.deleteSpace('Old');
  w.updateSpace('Dev', { name: 'old' });
  conflict(() => w.restoreSpace(old.id), "A live space already holds the name 'Old'");
});

test('a table name is checked within its space against live and trashed tables', () => {
  const w = ws();
  conflict(() => w.createTable({ space: 'Ops', name: 'task' }), "Table 'Ops/task' already exists");
  w.createTable({ space: 'Dev', name: 'Task' });
  w.createTable({ space: 'Ops', name: 'Bin' });
  w.deleteTable('Ops/Bin');
  conflict(() => w.createTable({ space: 'Ops', name: 'bin' }), "Table 'Ops/bin' is in the trash — restore or purge it first");
});

test('moving a table refuses a live or trashed name in the target space', () => {
  const w = ws();
  w.createTable({ space: 'Dev', name: 'Task' });
  conflict(() => w.moveTable('Ops/Task', 'Dev'), "Table 'Dev/Task' already exists");
  const w2 = ws();
  w2.createTable({ space: 'Dev', name: 'Task' });
  w2.deleteTable('Dev/Task');
  conflict(() => w2.moveTable('Ops/Task', 'Dev'), "Table 'Dev/Task' is in the trash — restore or purge it first");
});

test('restoring a table refuses a name a live table took meanwhile', () => {
  const w = ws();
  const t = w.getTable('Ops/Task');
  w.deleteTable('Ops/Task');
  w.createTable({ space: 'Ops', name: 'Other' });
  w.updateTable('Ops/Other', { name: 'Task' });
  conflict(() => w.restoreTable(t.id), "A live table already holds the name 'Ops/Task'");
});

test('duplicating skips copy names a live or trashed table holds', () => {
  const w = ws();
  w.createTable({ space: 'Ops', name: 'Task Copy' });
  w.createTable({ space: 'Ops', name: 'Task Copy 2' });
  w.deleteTable('Ops/Task Copy 2');
  assert.equal(w.duplicateTable('Ops/Task').name, 'Task Copy 3');
});
