/* Issue #110: import has to be a faithful move.

   Every surface that lists a table's columns — the grid, describeSchema()
   (and so `GET /api/schema`), the CSV export, the phone applet — walks
   `db.fieldOrder`, not `db.fields`. A field the order forgets is still in
   the workspace and still invisible, which is how a plain `number` column
   went missing after `GET /api/export` → `POST /api/import` while the far
   side reported the same table and entity counts. importJSON took the
   incoming order verbatim, so it carried the hole across. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';

function source() {
  const w = new Weave();
  w.createSpace({ name: 'Product' });
  const projects = w.createTable({ space: 'Product', name: 'Project' });
  const tasks = w.createTable({ space: 'Product', name: 'Task' });
  w.addField(projects, { name: 'Budget', type: 'number' });
  w.addField(tasks, { name: 'Estimate', type: 'number' });
  w.addField(tasks, { name: 'Due', type: 'date' });
  w.addRelation(tasks, { name: 'Project', targetDb: projects, cardinality: 'many-to-one', inverseName: 'Tasks' });
  w.addField(tasks, { name: 'Project Budget', type: 'lookup', config: { relationField: 'Project', targetField: 'Budget' } });
  w.addField(tasks, { name: 'Size', type: 'formula', config: { expression: 'Estimate * 2' } });
  const p = w.createEntity(projects, { name: 'Apollo', values: { Budget: 100 } });
  w.createEntity(tasks, { name: 'T1', values: { Estimate: 5, Project: p.id } });
  return w;
}

const columns = (w, ref) => {
  const db = w.getTable(ref);
  return db.fieldOrder.map((id) => db.fields[id]?.name);
};

test('an untouched export imports column for column', () => {
  const w = source();
  const before = columns(w, 'Product/Task');
  const far = new Weave();
  far.importJSON(JSON.parse(JSON.stringify(w.exportJSON())));
  assert.deepEqual(columns(far, 'Product/Task'), before);
});

test('import restores a column the incoming field order forgot', () => {
  const w = source();
  const dump = JSON.parse(JSON.stringify(w.exportJSON()));
  const task = Object.values(dump.tables).find((t) => t.name === 'Task');
  const forgotten = ['Estimate', 'Project Budget', 'Size'];
  task.fieldOrder = task.fieldOrder.filter((id) => !forgotten.includes(task.fields[id].name));

  const far = new Weave();
  far.importJSON(dump);
  const cols = columns(far, 'Product/Task');
  for (const name of forgotten) {
    assert.ok(cols.includes(name), `${name} is a column on the far side, not just a key in fields`);
  }
  const db = far.getTable('Product/Task');
  assert.equal(db.fieldOrder.length, Object.keys(db.fields).length, 'the order names every field exactly once');
  assert.equal(new Set(db.fieldOrder).size, db.fieldOrder.length, 'and names none of them twice');

  // The surfaces that read the order agree, because they read the same order.
  const schema = far.describeSchema().find((s) => s.space === 'Product').tables.find((t) => t.name === 'Task');
  for (const name of forgotten) assert.ok(schema.fields.some((f) => f.name === name), `${name} survives into describeSchema`);
  const header = far.exportCSV('Product/Task').split('\n')[0];
  for (const name of forgotten) assert.ok(header.includes(name), `${name} survives into the CSV header`);

  // And the value came with it.
  const row = far.findEntity(db.id, 'T1');
  assert.equal(far.readEntity(row.id).fields.Estimate, 5);
});

test('import drops an order entry that names no field, and keeps the rest in place', () => {
  const w = source();
  const dump = JSON.parse(JSON.stringify(w.exportJSON()));
  const task = Object.values(dump.tables).find((t) => t.name === 'Task');
  const kept = task.fieldOrder.map((id) => task.fields[id].name);
  task.fieldOrder = [...task.fieldOrder, 'a-field-id-that-was-deleted'];

  const far = new Weave();
  far.importJSON(dump);
  assert.deepEqual(columns(far, 'Product/Task'), kept, 'the dangling id is gone and nothing else moved');
});

test('a workspace already carrying the hole heals when it is opened', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-import-'));
  const file = join(dir, 'damaged.db');
  try {
    const w = source();
    const held = new Weave({ path: file });
    held.importJSON(JSON.parse(JSON.stringify(w.exportJSON())));
    // Damage it the way a stray writer would: the field stays, the order forgets it.
    const db = held.getTable('Product/Task');
    const estimate = Object.values(db.fields).find((f) => f.name === 'Estimate');
    db.fieldOrder = db.fieldOrder.filter((id) => id !== estimate.id);
    held.store.save(held.state, { all: true });

    // Opening it is the repair — the same pass import runs.
    const reopened = new Weave({ path: file });
    assert.ok(columns(reopened, 'Product/Task').includes('Estimate'));
    // And the repair is written back, not re-derived on every open.
    const again = new Weave({ path: file });
    assert.ok(again.getTable('Product/Task').fieldOrder.includes(estimate.id));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the repair resurrects nothing: a deleted column stays deleted across export and import', () => {
  const w = source();
  const tasks = w.getTable('Product/Task');
  const estimate = Object.values(tasks.fields).find((f) => f.name === 'Estimate');
  w.deleteField(tasks.id, estimate.id);

  const far = new Weave();
  far.importJSON(JSON.parse(JSON.stringify(w.exportJSON())));
  const db = far.getTable('Product/Task');
  assert.ok(!db.fields[estimate.id], 'the field is gone from the table');
  assert.ok(!columns(far, 'Product/Task').includes('Estimate'), 'and gone from the columns');
});

test('a table in the trash keeps its columns through the move', () => {
  const w = source();
  const tasks = w.getTable('Product/Task');
  const before = columns(w, 'Product/Task');
  w.deleteTable(tasks.id);

  const far = new Weave();
  far.importJSON(JSON.parse(JSON.stringify(w.exportJSON())));
  const held = far.state.tables[tasks.id];
  assert.ok(held.deletedAt, 'still in the trash on the far side');
  assert.deepEqual(held.fieldOrder.map((id) => held.fields[id].name), before, 'with every column it went in with');
});
