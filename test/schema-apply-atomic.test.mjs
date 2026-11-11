import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { onDisk, reopen, storedValues, assertValueTypes } from './lib/reopen.mjs';

function seed(w) {
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  w.addField('Task', { name: 'Old', type: 'text' });
  w.addField('Task', { name: 'Qty', type: 'number' });
  w.createEntity('Task', { name: 'a', values: { Old: 'kept', Qty: 3 } });
  return w;
}

const dev = (doc) => doc.find((s) => s.space === 'Dev');
const ratingTooHigh = /A rating's max is a whole number from 1 to 100/;

function assertUntouched(w, before) {
  assert.deepEqual(w.describeSchema(), before, 'the schema is as it was');
  assert.deepEqual(storedValues(w, 'Task', 'Old'), ['kept'], 'the row keeps its value');
  assertValueTypes(w, 'Task', 'Qty', 'number');
}

test('an apply whose later step is refused writes nothing, and its dry run raises the same error (Issue #1625)', () => {
  const w = seed(onDisk('wv-1625-'));
  const before = w.describeSchema();
  const doc = structuredClone(before);
  dev(doc).tables.push({ name: 'New1', fields: [{ name: 'Note', type: 'text' }] });
  dev(doc).tables.push({ name: 'New2', fields: [{ name: 'Score', type: 'rating', max: 999 }] });
  assert.throws(() => w.applySchema(doc, { dryRun: true }), ratingTooHigh, 'the dry run reports the refusal');
  assert.throws(() => w.applySchema(doc), ratingTooHigh);
  assertUntouched(w, before);
  assertUntouched(reopen(w), before);
});

for (const [where, make] of [['on disk', () => onDisk('wv-1625-')], ['in memory', () => new Weave()]]) {
  test(`a failure inside the real pass rolls every earlier step back, ${where} (Issue #1625)`, () => {
    const w = seed(make());
    const before = w.describeSchema();
    const doc = structuredClone(before);
    const task = dev(doc).tables.find((t) => t.name === 'Task');
    task.fields = task.fields.filter((f) => f.name !== 'Old');
    dev(doc).tables.push({ name: 'Zed', fields: [{ name: 'Note', type: 'text' }] });
    const save = w.store.save.bind(w.store);
    w.store.save = (state, options) => {
      if (Object.values(state.tables).some((t) => t.name === 'Zed')) throw new Error('disk failure');
      return save(state, options);
    };
    assert.throws(() => w.applySchema(doc, { allowDestructive: true }), /disk failure/);
    w.store.save = save;
    assertUntouched(w, before);
    if (w.store.path) assertUntouched(reopen(w), before);
    assert.deepEqual(w.applySchema(doc, { allowDestructive: true }).map((p) => p.action), ['delete-field', 'create-table'], 'a clean retry applies the whole document');
  });
}

test('a dry run writes nothing and plans every step the apply takes (Issue #1625)', () => {
  const w = seed(onDisk('wv-1625-'));
  const before = w.describeSchema();
  const doc = structuredClone(before);
  doc.push({ space: 'Ops', tables: [{ name: 'Ticket', fields: [{ name: 'Size', type: 'number' }] }] });
  const planned = w.applySchema(doc, { dryRun: true });
  assertUntouched(w, before);
  assertUntouched(reopen(w), before);
  assert.deepEqual(w.applySchema(doc), planned, 'the apply takes the planned steps');
  assert.deepEqual(planned.map((p) => p.action), ['create-space', 'create-table']);
});
