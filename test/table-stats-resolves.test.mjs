import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

const N = 12;

function tasks() {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  w.addField('Task', { name: 'Points', type: 'number' });
  w.addField('Task', { name: 'Stage', type: 'select', config: { options: [{ name: 'Todo' }, { name: 'Doing' }, { name: 'Done' }] } });
  w.addField('Task', { name: 'Double', type: 'formula', config: { expression: 'Points * 2' } });
  w.addField('Task', { name: 'Quad', type: 'formula', config: { expression: 'Double * 2' } });
  for (let i = 0; i < N; i++) w.createEntity('Task', { Name: `t${i}`, Points: i, Stage: ['Todo', 'Doing', 'Done'][i % 3] });
  const spacesT = Object.values(w.state.tables).find((x) => x.system === 'spaces');
  w.addField(spacesT.id, { name: 'Task · Points · sum', type: 'rollup', config: { via: 'Task', targetField: 'Points', aggregate: 'sum' } });
  const ids = Object.fromEntries(Object.values(w.getTable('Task').fields).map((f) => [f.name, f.id]));
  const reads = { Points: 0, Stage: 0 };
  for (const e of w.listEntities(w.getTable('Task').id)) {
    const values = e.values;
    e.values = new Proxy(values, {
      get(target, key) {
        if (key === ids.Points) reads.Points++;
        if (key === ids.Stage) reads.Stage++;
        return target[key];
      },
    });
  }
  const count = (opts) => {
    reads.Points = 0;
    reads.Stage = 0;
    w.tableStats('Task', opts);
    return { ...reads };
  };
  return { w, count };
}

test('table stats read a stored value once for its column and once for each formula or rollup over it', () => {
  const { count } = tasks();
  assert.deepEqual(count({}), { Points: 4 * N, Stage: N });
});

test('grouping table stats by a field reads no stored value a second time', () => {
  const { count } = tasks();
  assert.deepEqual(count({ by: 'Stage' }), count({}));
});

test('grouped table stats still answer each group from its own rows', () => {
  const { w } = tasks();
  const out = w.tableStats('Task', { by: 'Stage' });
  const todo = out.groups.find((g) => g.value === 'Todo');
  assert.equal(todo.rows, 4);
  assert.deepEqual(todo.columns.Points, { n: 4, sum: 18, avg: 4.5, median: 4.5, min: 0, max: 9 });
  assert.equal(todo.columns.Quad.sum, 72);
  assert.deepEqual(todo.rollups.find((r) => r.field === 'Points'), { field: 'Points', aggregate: 'sum', value: 18, display: '18' });
});
