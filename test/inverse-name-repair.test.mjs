import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { tempDir } from './lib/temp.mjs';

function stored(build) {
  const path = join(tempDir('weave-inverse-repair-'), 'ws.db');
  const w = new Weave({ path });
  w.createSpace({ name: 'Ops' });
  const notes = w.createTable({ space: 'Ops', name: 'Meeting Notes' });
  const items = w.createTable({ space: 'Ops', name: 'Action Items' });
  build(w, { notes, items });
  w.save();
  return path;
}

const names = (w, table) => Object.values(w.getTable(table).fields).map((f) => f.name);
const renames = (w) => w.listAudit({ actions: ['field-config-updated'], limit: -1 })
  .filter((r) => r.detail.changed?.includes('name') && r.detail.before?.name === 'Action Itemss');

test('a stored doubled-s inverse is renamed on open, and the rename is audited', () => {
  const path = stored((w, { notes, items }) => {
    w.addRelation(items, { name: 'Meeting Note', targetDb: notes, cardinality: 'many-to-one', inverseName: 'Action Itemss' });
  });
  const w = new Weave({ path });
  assert.ok(names(w, 'Meeting Notes').includes('Action Items'));
  assert.ok(!names(w, 'Meeting Notes').includes('Action Itemss'));
  const inverse = w.getField(w.getTable('Meeting Notes').id, 'Action Items');
  assert.equal(inverse.config.targetDb, w.getTable('Action Items').id, 'the same paired field, renamed');
  assert.equal(renames(w).length, 1, 'one audit row names the rename');
});

test('a rename that would collide with a field on that table is skipped', () => {
  const path = stored((w, { notes, items }) => {
    w.addField(notes, { name: 'Action Items', type: 'text' });
    w.addRelation(items, { name: 'Meeting Note', targetDb: notes, cardinality: 'many-to-one', inverseName: 'Action Itemss' });
  });
  const w = new Weave({ path });
  const found = names(w, 'Meeting Notes');
  assert.ok(found.includes('Action Itemss'), 'the doubled name stays');
  assert.equal(found.filter((n) => n === 'Action Items').length, 1, 'the existing field keeps its name');
  assert.equal(w.getField(w.getTable('Meeting Notes').id, 'Action Items').type, 'text');
  assert.equal(renames(w).length, 0);
});

test('a second open changes nothing', () => {
  const path = stored((w, { notes, items }) => {
    w.addRelation(items, { name: 'Meeting Note', targetDb: notes, cardinality: 'many-to-one', inverseName: 'Action Itemss' });
  });
  const first = new Weave({ path });
  const after = JSON.stringify(first.getTable('Meeting Notes').fields);
  first.save();
  const second = new Weave({ path });
  assert.equal(JSON.stringify(second.getTable('Meeting Notes').fields), after);
  assert.equal(renames(second).length, 1, 'no second audit row');
});

test('a plural inverse of a singular table, like Deals from Deal, is untouched', () => {
  const path = stored((w, { notes }) => {
    const deal = w.createTable({ space: 'Ops', name: 'Deal' });
    w.addRelation(deal, { name: 'Meeting Note', targetDb: notes, cardinality: 'many-to-one', inverseName: 'Deals' });
  });
  const w = new Weave({ path });
  assert.ok(names(w, 'Meeting Notes').includes('Deals'));
  assert.ok(!names(w, 'Meeting Notes').includes('Deal'));
});
