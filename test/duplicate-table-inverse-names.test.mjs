import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

const build = () => {
  const w = new Weave();
  w.createSpace({ name: 'Product' });
  const project = w.createTable({ space: 'Product', name: 'Project' });
  const task = w.createTable({ space: 'Product', name: 'Task' });
  const rel = w.addRelation(task.id, { name: 'Owner project', targetDb: project.id, cardinality: 'many-to-one', inverseName: 'Tasks' });
  return { w, project, task, rel };
};
const names = (w, ref) => Object.values(w.getTable(ref).fields).map((f) => f.name);

test('duplicating a table three times numbers the inverse relation on its target Copy, Copy 2, Copy 3', () => {
  const { w, task } = build();
  for (let n = 0; n < 3; n++) w.duplicateTable(task.id);
  const inverses = names(w, 'Product/Project').filter((n) => n.startsWith('Tasks Copy'));
  assert.deepEqual(inverses, ['Tasks Copy', 'Tasks Copy 2', 'Tasks Copy 3']);
});

test('each duplicate keeps the relation pointed at its own inverse', () => {
  const { w, task } = build();
  const copies = [w.duplicateTable(task.id), w.duplicateTable(task.id), w.duplicateTable(task.id)];
  assert.deepEqual(copies.map((c) => c.name), ['Task Copy', 'Task Copy 2', 'Task Copy 3']);
  const project = w.getTable('Product/Project');
  for (const [i, copy] of copies.entries()) {
    const own = Object.values(copy.fields).find((f) => f.type === 'relation');
    const back = project.fields[own.config.inverseFieldId];
    assert.equal(back.name, ['Tasks Copy', 'Tasks Copy 2', 'Tasks Copy 3'][i]);
    assert.equal(back.config.targetDb, copy.id);
  }
});
