import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

const spaceRollups = () => {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  w.addField('Dev/Task', { name: 'Cost', type: 'number' });
  const spaces = w.getTable('System/Spaces');
  w.addField(spaces.id, { name: 'Task count', type: 'rollup', config: { via: 'Dev/Task', aggregate: 'count' } });
  w.addField(spaces.id, { name: 'Cost sum', type: 'rollup', config: { via: 'Dev/Task', aggregate: 'sum', targetField: 'Cost' } });
  const named = (n) => Object.values(w.getTable('System/Spaces').fields).find((f) => f.name === n);
  return { w, spaces, named };
};

test('sending a count space rollup its own empty target again is not a repoint', () => {
  const { w, spaces, named } = spaceRollups();
  const count = named('Task count');
  assert.equal(count.config.targetField, null);
  assert.doesNotThrow(() => w.updateField(spaces.id, count.id, { config: { aggregate: 'count', targetField: null } }));
  assert.equal(named('Task count').config.targetField, null);
});

test('sending a sum space rollup the target it already reads is accepted by name or by id', () => {
  const { w, spaces, named } = spaceRollups();
  const sum = named('Cost sum');
  const cost = Object.values(w.getTable('Dev/Task').fields).find((f) => f.name === 'Cost');
  assert.doesNotThrow(() => w.updateField(spaces.id, sum.id, { config: { targetField: 'Cost' } }));
  assert.doesNotThrow(() => w.updateField(spaces.id, sum.id, { config: { targetField: cost.id } }));
  assert.equal(named('Cost sum').config.targetField, cost.id);
});

test('pointing a space rollup at another target is refused', () => {
  const { w, spaces, named } = spaceRollups();
  const sum = named('Cost sum');
  assert.throws(() => w.updateField(spaces.id, sum.id, { config: { targetField: 'Name' } }), (err) => {
    assert.equal(err.code, 'invalid');
    assert.match(err.message, /Cost sum is a space rollup: its recipe is set from the grid's Σ row/);
    return true;
  });
  assert.throws(() => w.updateField(spaces.id, named('Task count').id, { config: { aggregate: 'sum', targetField: 'Cost' } }), /space rollup/);
});

test('a text field cannot become a relation without a target table', () => {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  const task = w.createTable({ space: 'Dev', name: 'Task' });
  w.createTable({ space: 'Dev', name: 'Other' });
  w.addField(task.id, { name: 'Tag', type: 'text' });
  for (const config of [{ targetDb: '' }, {}, { targetDb: null }]) {
    assert.throws(() => w.updateField(task.id, 'Tag', { type: 'relation', config }), (err) => {
      assert.equal(err.code, 'invalid');
      assert.match(err.message, /pass config\.targetDb, the table its values name/);
      return true;
    });
  }
  assert.equal(Object.values(w.getTable('Dev/Task').fields).find((f) => f.name === 'Tag').type, 'text');
});

test('a formula edit walks past a formula that has no expression stored', () => {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  const task = w.createTable({ space: 'Dev', name: 'Task' });
  w.addField(task.id, { name: 'Base', type: 'formula', config: { expression: '1' } });
  w.addField(task.id, { name: 'Stryker', type: 'formula', config: { expression: 'Base + 1' } });
  const base = Object.values(w.getTable('Dev/Task').fields).find((f) => f.name === 'Base');
  delete base.config.expression;
  assert.doesNotThrow(() => w.updateField(task.id, 'Stryker', { config: { expression: 'Base + 2' } }));
  assert.equal(Object.values(w.getTable('Dev/Task').fields).find((f) => f.name === 'Stryker').config.expression, 'Base + 2');
});

test('a formula edit that closes a reference cycle is still refused', () => {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  const task = w.createTable({ space: 'Dev', name: 'Task' });
  w.addField(task.id, { name: 'Base', type: 'formula', config: { expression: '1' } });
  w.addField(task.id, { name: 'Total', type: 'formula', config: { expression: 'Base + 1' } });
  assert.throws(() => w.updateField(task.id, 'Base', { config: { expression: 'Total + 1' } }), /cycle/i);
});
