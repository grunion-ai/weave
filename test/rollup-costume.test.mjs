import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

function trips() {
  const w = new Weave();
  w.createSpace({ name: 'Plans' });
  const trip = w.createTable({ space: 'Plans', name: 'Trip' });
  const todo = w.createTable({ space: 'Plans', name: 'To-do' });
  w.addField(todo.id, { name: 'Done', type: 'checkbox' });
  w.addField(todo.id, { name: 'Hours', type: 'number' });
  w.addRelation(todo.id, { name: 'Trip', targetDb: trip.id, cardinality: 'many-to-one', inverseName: 'To-dos' });
  const japan = w.createEntity(trip.id, { name: 'Japan' });
  for (const [name, Done] of [['Passports', true], ['Rail pass', false], ['Hotel', true], ['Adapters', false]]) {
    w.createEntity(todo.id, { name, values: { Done, Trip: japan.id, Hours: 1 } });
  }
  return { w, trip, todo, japan };
}

test('a numeric rollup over a checkbox counts a tick as 1 and an empty box as 0', () => {
  const { w, trip, japan } = trips();
  w.addField(trip.id, { name: 'Ticked', type: 'rollup', config: { relationField: 'To-dos', targetField: 'Done', aggregate: 'sum' } });
  w.addField(trip.id, { name: 'Share', type: 'rollup', config: { relationField: 'To-dos', targetField: 'Done', aggregate: 'avg' } });
  const row = w.readEntity(japan.id);
  assert.equal(row.raw.Ticked, 2);
  assert.equal(row.raw.Share, 0.5);
});

test('a rollup wears the number costume: percent, bar, a fixed scale, and the chip draws the bar', () => {
  const { w, trip, japan } = trips();
  w.addField(trip.id, { name: '% Done', type: 'rollup', config: { relationField: 'To-dos', targetField: 'Done', aggregate: 'avg', format: 'percent', display: 'bar', scale: 1 } });
  const row = w.readEntity(japan.id);
  assert.equal(row.fields['% Done'], '50%');
  assert.equal(row.scales['% Done'], 1);
  const seg = w.renderView(japan.id, 'chip', { config: { fields: ['% Done'] } }).fields[0];
  assert.deepEqual(seg.meter, { display: 'bar', value: 0.5, scale: 1, color: 'ink' });
  assert.equal(seg.value, '50%');
  const listed = w.describeSchema().flatMap((s) => s.tables).find((t) => t.name === 'Trip').fields.find((f) => f.name === '% Done');
  assert.equal(listed.display, 'bar');
  assert.equal(listed.format, 'percent');
  assert.equal(listed.scale, 1);
});

test('the costume is set and cleared through update_field, and a join keeps its text separator', () => {
  const { w, trip, japan } = trips();
  const f = w.addField(trip.id, { name: 'Share', type: 'rollup', config: { relationField: 'To-dos', targetField: 'Done', aggregate: 'avg' } });
  w.updateField(trip.id, f.id, { config: { display: 'ring', format: 'percent' } });
  assert.equal(w.getField(trip.id, 'Share').config.display, 'ring');
  assert.equal(w.readEntity(japan.id).fields.Share, '50%');
  w.updateField(trip.id, f.id, { config: { display: null, format: null } });
  assert.equal(w.getField(trip.id, 'Share').config.display, undefined);
  assert.throws(() => w.updateField(trip.id, f.id, { config: { display: 'pie' } }), /number display/);
  w.addField(trip.id, { name: 'Names', type: 'rollup', config: { relationField: 'To-dos', targetField: 'Name', aggregate: 'join', separator: ' / ' } });
  assert.match(w.readEntity(japan.id).fields.Names, / \/ /);
});

test('a rollup without its own costume still borrows the target number field\'s', () => {
  const { w, trip, todo, japan } = trips();
  w.updateField(todo.id, 'Hours', { config: { display: 'bar', unit: 'h' } });
  w.addField(trip.id, { name: 'Hours', type: 'rollup', config: { relationField: 'To-dos', targetField: 'Hours', aggregate: 'sum' } });
  const seg = w.renderView(japan.id, 'chip', { config: { fields: ['Hours'] } }).fields[0];
  assert.equal(seg.meter.display, 'bar');
});

test('the costume survives a schema round trip into a fresh workspace', () => {
  const { w, trip } = trips();
  w.addField(trip.id, { name: '% Done', type: 'rollup', config: { relationField: 'To-dos', targetField: 'Done', aggregate: 'avg', format: 'percent', display: 'bar', scale: 1 } });
  const w2 = new Weave();
  w2.applySchema(w.describeSchema());
  const f = w2.getField('Trip', '% Done');
  assert.equal(f.config.display, 'bar');
  assert.equal(f.config.format, 'percent');
  assert.equal(f.config.scale, 1);
});
