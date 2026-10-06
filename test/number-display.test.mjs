import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

function fresh(config) {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Deal' });
  w.addField('Deal', { name: 'Score', type: 'number', config });
  return w;
}
const field = (w, name, table = 'Deal') => w.describeSchema().find((s) => s.space === 'Dev').tables.find((t) => t.name === table).fields.find((f) => f.name === name);

test('display and scale are costume keys: validated, stored canonically, described', () => {
  const w = fresh({ display: 'bar' });
  assert.equal(field(w, 'Score').display, 'bar');
  assert.equal(field(w, 'Score').scale, undefined, 'column is the default scale and is not written down');
  w.addField('Deal', { name: 'Fixed', type: 'number', config: { display: 'ring', scale: 10 } });
  assert.equal(field(w, 'Fixed').scale, 10);
  w.addField('Deal', { name: 'Plain', type: 'number', config: { display: 'text' } });
  assert.equal(field(w, 'Plain').display, undefined, 'text is the default and is not written down');
  w.addField('Deal', { name: 'Col', type: 'number', config: { display: 'heat', scale: 'column' } });
  assert.equal(field(w, 'Col').display, 'heat');
  assert.equal(field(w, 'Col').scale, undefined);
  assert.throws(() => w.addField('Deal', { name: 'Stars', type: 'number', config: { display: 'stars' } }), /Invalid number display 'stars' \(text, bar, ring, heat\)/);
  assert.throws(() => w.addField('Deal', { name: 'Neg', type: 'number', config: { display: 'bar', scale: -4 } }), /Scale is 'column' or a number above 0/);
  assert.throws(() => w.addField('Deal', { name: 'Word', type: 'number', config: { display: 'bar', scale: 'row' } }), /Scale is 'column' or a number above 0/);
});

test('a scale without a graphic display is dropped, never stored', () => {
  const w = fresh({ scale: 50 });
  assert.equal(field(w, 'Score').scale, undefined);
  const w2 = fresh({ display: 'bar', scale: 50 });
  w2.updateField('Deal', 'Score', { config: { display: 'text' } });
  const f = w2.getTable('Deal').fields[w2.getField('Deal', 'Score').id];
  assert.equal(f.config.display, undefined);
  assert.equal(f.config.scale, undefined, 'going back to text takes the fixed scale with it');
});

test('the API returns the raw number and the dressed text; scales name the column max', () => {
  const w = fresh({ display: 'bar', format: 'percent' });
  const a = w.createEntity('Deal', { name: 'a', values: { Score: 0.25 } });
  w.createEntity('Deal', { name: 'b', values: { Score: 0.8 } });
  w.createEntity('Deal', { name: 'c', values: { Score: null } });
  const read = w.readEntity(a.id);
  assert.equal(read.raw.Score, 0.25);
  assert.equal(read.fields.Score, '25%', 'the text costume still dresses the value');
  assert.deepEqual(read.scales, { Score: 0.8 });
  const q = w.query('Deal', { limit: 1 });
  assert.deepEqual(q.items[0].scales, { Score: 0.8 }, 'a page of rows is drawn against the whole column');
});

test('a fixed scale is reported as itself, and a plain number column adds no scales at all', () => {
  const w = fresh({ display: 'ring', scale: 5 });
  const a = w.createEntity('Deal', { name: 'a', values: { Score: 3 } });
  assert.deepEqual(w.readEntity(a.id).scales, { Score: 5 });
  const plain = fresh({});
  const b = plain.createEntity('Deal', { name: 'b', values: { Score: 3 } });
  assert.equal('scales' in plain.readEntity(b.id), false, 'no graphic column, no key');
});

test('the column scale follows the data: a new maximum redraws every row against it', () => {
  const w = fresh({ display: 'bar' });
  const a = w.createEntity('Deal', { name: 'a', values: { Score: 4 } });
  assert.equal(w.readEntity(a.id).scales.Score, 4);
  const b = w.createEntity('Deal', { name: 'b', values: { Score: 10 } });
  assert.equal(w.readEntity(a.id).scales.Score, 10);
  w.updateEntity(b.id, { Score: 6 });
  assert.equal(w.readEntity(a.id).scales.Score, 6);
  w.deleteEntity(b.id);
  assert.equal(w.readEntity(a.id).scales.Score, 4, 'a trashed row stops counting');
});

test('a numeric formula wears the display too', () => {
  const w = fresh({});
  w.addField('Deal', { name: 'Double', type: 'formula', config: { expression: '[Score] * 2', display: 'bar' } });
  const a = w.createEntity('Deal', { name: 'a', values: { Score: 2 } });
  w.createEntity('Deal', { name: 'b', values: { Score: 5 } });
  assert.equal(field(w, 'Double').display, 'bar');
  const read = w.readEntity(a.id);
  assert.equal(read.raw.Double, 4);
  assert.equal(read.scales.Double, 10);
  w.updateField('Deal', 'Double', { config: { display: 'heat', scale: 20 } });
  assert.equal(w.readEntity(a.id).scales.Double, 20);
});

test('a rollup over a graphic column wears the display it summarises', () => {
  const w = fresh({ display: 'bar', scale: 100 });
  w.createTable({ space: 'Dev', name: 'Account' });
  w.addRelation('Deal', { name: 'Account', targetDb: 'Account', cardinality: 'many-to-one', inverseName: 'Deals' });
  w.addField('Account', { name: 'Avg score', type: 'rollup', config: { relationField: 'Deals', targetField: 'Score', aggregate: 'avg' } });
  w.addField('Account', { name: 'Deal count', type: 'rollup', config: { relationField: 'Deals', aggregate: 'count' } });
  const acct = w.createEntity('Account', { name: 'Acme' });
  w.createEntity('Deal', { name: 'a', values: { Score: 40, Account: acct.id } });
  w.createEntity('Deal', { name: 'b', values: { Score: 60, Account: acct.id } });
  assert.equal(field(w, 'Avg score', 'Account').display, 'bar');
  assert.equal(field(w, 'Avg score', 'Account').scale, 100);
  assert.equal(field(w, 'Deal count', 'Account').display, undefined, 'a count wears no costume');
  const read = w.readEntity(acct.id);
  assert.equal(read.raw['Avg score'], 50);
  assert.deepEqual(read.scales, { 'Avg score': 100 });
});

test('a chip and a card carry the meter a segment draws', () => {
  const w = fresh({ display: 'ring', scale: 10 });
  const a = w.createEntity('Deal', { name: 'a', values: { Score: 7 } });
  const chip = w.renderView(a.id, 'chip');
  const seg = chip.fields.find((f) => f.label === 'Score');
  assert.equal(seg.value, '7', 'the text is still there for a reader with no graphics');
  assert.deepEqual(seg.meter, { display: 'ring', value: 7, scale: 10, color: 'ink' });
});

test('the column max is the same figure a Space-level via max rollup reads', () => {
  const w = fresh({ display: 'bar' });
  for (const v of [3, 9, 1]) w.createEntity('Deal', { name: String(v), values: { Score: v } });
  const spaces = Object.values(w.state.tables).find((t) => t.system === 'spaces');
  w.addField(spaces.id, { name: 'Deal · Score · max', type: 'rollup', config: { via: 'Dev/Deal', targetField: 'Score', aggregate: 'max' } });
  const row = w.query(spaces.id, {}).items.find((r) => r.name === 'Dev');
  const any = w.query('Deal', {}).items[0];
  assert.equal(any.scales.Score, row.raw['Deal · Score · max']);
});
