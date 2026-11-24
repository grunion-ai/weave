import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { tempDir } from './lib/temp.mjs';

const fieldsT = (w) => w.getTable('Fields');
const rowFor = (w, fieldId, opts) => w.listEntities(fieldsT(w).id, opts).find((e) => e.sysId === fieldId);
const valOf = (w, row, name) => row.values[Object.values(fieldsT(w).fields).find((f) => f.name === name).id];

function pair(path) {
  const w = new Weave(path ? { path } : {});
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Project' });
  w.createTable({ space: 'Dev', name: 'Task' });
  w.addRelation('Task', { name: 'Project', targetDb: 'Project', cardinality: 'many-to-one', inverseName: 'Tasks' });
  w.addField('Task', { name: 'Code', type: 'lookup', config: { relationField: 'Project', targetField: 'Name' } });
  return w;
}

test('a type change refreshes the System/Fields Type, and a reopen keeps it (Issue #1626)', () => {
  const dir = tempDir('weave-registry-type-');
  const path = join(dir, 'ws.db');
  try {
    const w = pair(path);
    const f = w.addField('Task', { name: 'Estimate', type: 'text' });
    w.updateField('Task', 'Estimate', { type: 'number' });
    assert.equal(valOf(w, rowFor(w, f.id), 'Type'), 'number');
    assert.deepEqual(w.registryReport().problems, []);
    const again = new Weave({ path });
    assert.equal(valOf(again, rowFor(again, f.id), 'Type'), 'number');
    assert.deepEqual(again.registryReport().problems, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('registryReport names a row whose Type or Definition differs from its field', () => {
  const w = pair();
  const f = w.addField('Task', { name: 'Estimate', type: 'number', config: { width: 200 } });
  assert.deepEqual(w.registryReport().problems, [], 'a column width lives on the view, so it is no drift');
  const row = rowFor(w, f.id);
  const typeId = Object.values(fieldsT(w).fields).find((x) => x.name === 'Type').id;
  const defId = Object.values(fieldsT(w).fields).find((x) => x.name === 'Definition').id;
  row.values[typeId] = 'text';
  row.values[defId] = { type: 'text', config: {} };
  const problems = w.registryReport().problems.filter((p) => p.name === 'Task.Estimate').map((p) => p.problem).sort();
  assert.deepEqual(problems, ['row Definition differs from the field', 'row Type differs from the field']);
});

test('hard-deleting a relation drops its lookup row too', () => {
  const w = pair();
  const lookup = w.getField('Task', 'Code');
  w.deleteField('Task', 'Project', { hard: true });
  assert.equal(rowFor(w, lookup.id, { includeDeleted: true }), undefined);
  assert.deepEqual(w.registryReport().problems, []);
});

test('trashing a relation trashes its lookup row, and restoring brings both rows back', () => {
  const w = pair();
  const rel = w.getField('Task', 'Project');
  const lookup = w.getField('Task', 'Code');
  w.deleteField('Task', 'Project');
  assert.equal(rowFor(w, lookup.id), undefined, 'no live row for a field in the trash');
  assert.ok(rowFor(w, lookup.id, { includeDeleted: true })?.deletedAt, 'its row waits in the trash with the field');
  assert.deepEqual(w.registryReport().problems, []);
  w.restoreField('Task', 'Project');
  assert.ok(rowFor(w, rel.id), 'the relation row is live again');
  assert.ok(rowFor(w, lookup.id), 'the lookup row is live again');
  assert.deepEqual(w.registryReport().problems, []);
  w.deleteField('Task', 'Project');
  w.deleteField('Task', 'Project', { hard: true });
  assert.equal(rowFor(w, lookup.id, { includeDeleted: true }), undefined, 'a purge from the trash drops both rows');
  assert.deepEqual(w.registryReport().problems, []);
});

test('a record term set with the table keeps the Name field row in step', () => {
  const w = pair();
  w.updateTable('Task', { noun: 'chore' });
  assert.deepEqual(w.registryReport().problems, []);
});
