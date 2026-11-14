import test from 'node:test';
import assert from 'node:assert/strict';
import { onDisk, reopen, storedValues, assertValueTypes } from './lib/reopen.mjs';

function items(field, type, values) {
  const w = onDisk('wv-1623-');
  w.createSpace({ name: 'Ops' });
  w.createTable({ space: 'Ops', name: 'Item' });
  const f = w.addField('Item', { name: field, type });
  values.forEach((v, i) => w.createEntity('Item', { name: `r${i}`, values: { [field]: v } }));
  return { w, f };
}

test('a text-to-number migration reopened from disk holds numbers (Issue #1623)', () => {
  const { w, f } = items('Size', 'text', ['1', '2', '3']);
  w.updateField('Item', f.id, { type: 'number' });
  const again = reopen(w);
  assert.equal(again.getField('Item', 'Size').type, 'number');
  assertValueTypes(again, 'Item', 'Size', 'number');
  assert.deepEqual(storedValues(again, 'Item', 'Size'), [1, 2, 3]);
});

test('a text-to-select migration reopened from disk holds option ids (Issue #1623)', () => {
  const { w, f } = items('Priority', 'text', ['High', 'Low', 'High']);
  w.updateField('Item', f.id, { type: 'select' });
  const again = reopen(w);
  const ids = Object.fromEntries(again.getField('Item', 'Priority').config.options.map((o) => [o.name, o.id]));
  assert.deepEqual(storedValues(again, 'Item', 'Priority'), [ids.High, ids.Low, ids.High]);
});

test('a type change rolled back after a reopen restores every value (Issue #1623)', () => {
  const { w, f } = items('Qty', 'number', [9.75]);
  w.updateField('Item', f.id, { type: 'text' });
  const again = reopen(w);
  assertValueTypes(again, 'Item', 'Qty', 'string');
  const entry = again.activityFeed({ entityId: again.getTable('Item').id, kinds: ['field-config-updated'] }).items[0];
  const back = again.rollbackFieldConfig(entry.id);
  assert.deepEqual([back.restored, back.left], [1, 0], 'the value on disk is the one the change wrote');
  assert.deepEqual(storedValues(reopen(again), 'Item', 'Qty'), [9.75]);
});
