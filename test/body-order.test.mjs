/* Where the field block sits among the documents and the related tables.

   The entity page used to hard-sort its body: values, then documents, then
   attachments, then collections, and no amount of dragging could say
   otherwise. Kyle wants the whole field block to move above or below a
   document or a related table, and the documents and tables to move too
   (2026-08-26) — so the order is a table setting, the way hiddenFields and
   fieldOrder already are.

   The value fields stay one block: `@values` is the sentinel that stands for
   the run of them, so the grid is a thing you move rather than a thing you
   take apart. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

const build = () => {
  const w = new Weave();
  w.createSpace({ name: 'Showcase' });
  const parts = w.createTable({ space: 'Showcase', name: 'Part' });
  w.addField(parts, { name: 'Vendor', type: 'text' });
  w.addField(parts, { name: 'Brief', type: 'document' });
  w.addField(parts, { name: 'Files', type: 'attachments' });
  return { w, parts };
};

test('a table has no body order until someone sets one', () => {
  const { w, parts } = build();
  assert.equal(w.getTable(parts).bodyOrder, undefined);
});

test('bodyOrder is stored by field id, so a rename cannot orphan it', () => {
  const { w, parts } = build();
  w.updateTable(parts, { bodyOrder: ['Brief', '@values', 'Files'] });
  const brief = w.findField(w.getTable(parts), 'Brief');
  assert.deepEqual(w.getTable(parts).bodyOrder, [brief.id, '@values', w.findField(w.getTable(parts), 'Files').id]);
  w.updateField(parts, brief.id, { name: 'Summary' });
  assert.deepEqual(w.bodyBlocks(parts), ['Summary', '@values', 'Files', 'Description'],
    'the block keeps its place under its new name');
});

test('bodyBlocks fills in what the order does not mention', () => {
  const { w, parts } = build();
  w.updateTable(parts, { bodyOrder: ['Brief'] });
  assert.deepEqual(w.bodyBlocks(parts), ['Brief', '@values', 'Description', 'Files'],
    'blocks nobody placed keep the default order, after the ones that were');
  w.addField(parts, { name: 'Spec', type: 'document' });
  assert.deepEqual(w.bodyBlocks(parts), ['Brief', '@values', 'Description', 'Files', 'Spec'],
    'a document added later appends rather than jumping the queue');
});

test('the default is the field block first, then the documents', () => {
  const { w, parts } = build();
  assert.deepEqual(w.bodyBlocks(parts), ['@values', 'Description', 'Brief', 'Files']);
});

test('a block that is not a block is refused', () => {
  const { w, parts } = build();
  assert.throws(() => w.updateTable(parts, { bodyOrder: ['Vendor'] }), /not a body block/,
    'a value field is part of @values, never a block of its own');
  assert.throws(() => w.updateTable(parts, { bodyOrder: ['@values', '@values'] }), /at most once/);
  assert.throws(() => w.updateTable(parts, { bodyOrder: ['Nope'] }), /not found/);
});

test('an empty body order clears the setting', () => {
  const { w, parts } = build();
  w.updateTable(parts, { bodyOrder: ['Brief', '@values'] });
  w.updateTable(parts, { bodyOrder: [] });
  assert.equal(w.getTable(parts).bodyOrder, undefined);
  assert.deepEqual(w.bodyBlocks(parts), ['@values', 'Description', 'Brief', 'Files']);
});

test('a collection relation is a block of its own', () => {
  const { w, parts } = build();
  const people = w.createTable({ space: 'Showcase', name: 'Person' });
  w.addRelation(parts, { name: 'Peers', targetDb: people, cardinality: 'many-to-many', inverseName: 'Owns' });
  assert.ok(w.bodyBlocks(parts).includes('Peers'), 'a related table is something you can move');
  w.updateTable(parts, { bodyOrder: ['Peers', '@values'] });
  assert.deepEqual(w.bodyBlocks(parts).slice(0, 2), ['Peers', '@values']);
});
