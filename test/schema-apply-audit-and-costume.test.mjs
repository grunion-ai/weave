import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

const applied = (w) => w.listAudit({ limit: 100 }).filter((r) => r.action === 'schema-applied');

test('an applied document audits how many changes it made', () => {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  const doc = w.describeSchema();
  doc.find((s) => s.space === 'Dev').tables.push({ name: 'Project', fields: [{ name: 'Budget', type: 'number' }] });
  doc.push({ space: 'Ops', tables: [] });
  const plan = w.applySchema(doc);
  assert.equal(plan.length, 2);
  const rows = applied(w);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].detail.changes, 2);
});

test('a document with no changes writes no audit line', () => {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  assert.deepEqual(w.applySchema(w.describeSchema()), []);
  assert.equal(applied(w).length, 0);
});

test('a table created by a document keeps the term set on its renamed name field', () => {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  const doc = w.describeSchema();
  doc.find((s) => s.space === 'Dev').tables.push({
    name: 'Invoice',
    fields: [{ name: 'Title', type: 'text', role: 'name', term: { singular: 'bill', plural: 'bills' } }],
  });
  w.applySchema(doc);
  const table = w.getTable('Dev/Invoice');
  assert.equal(table.fields[table.nameFieldId].name, 'Title');
  assert.deepEqual(w.termOf('Dev/Invoice'), { singular: 'bill', plural: 'bills', set: true });
});
