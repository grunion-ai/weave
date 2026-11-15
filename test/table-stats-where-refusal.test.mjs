import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

function tasks() {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  w.addField('Task', { name: 'Points', type: 'number' });
  w.createEntity('Task', { Name: 'a', Points: 1 });
  w.createEntity('Task', { Name: 'b', Points: 5 });
  return w;
}

test('table stats refuse a where clause that names an unknown field', () => {
  const w = tasks();
  assert.throws(() => w.tableStats('Task', { where: [['Nope', '=', 1]] }), (err) => err.code === 'not-found' && /Field 'Nope' not found in table 'Task'/.test(err.message));
});

test('table stats count only the rows a valid where clause keeps', () => {
  const w = tasks();
  assert.equal(w.tableStats('Task', { where: [['Points', '>', 2]] }).rows, 1);
});

test('table stats refuse an unknown field even when the table has no rows to test it against', () => {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  assert.throws(() => w.tableStats('Task', { where: [['Nope', '=', 1]] }), (err) => err.code === 'not-found' && /Field 'Nope' not found/.test(err.message));
  assert.throws(() => w.tableStats('Task', { where: { and: [['Nope', '=', 1]] } }), /Field 'Nope' not found/);
});
