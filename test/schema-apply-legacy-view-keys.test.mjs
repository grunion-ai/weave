import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

const build = () => {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  w.addField('Dev/Task', { name: 'Status', type: 'text' });
  return w;
};
const taskOf = (doc) => doc.find((s) => s.space === 'Dev').tables.find((t) => t.name === 'Task');
const edited = (w, edit) => {
  const doc = w.describeSchema();
  edit(taskOf(doc));
  return doc;
};
const allNames = (t) => t.fields.map((f) => f.name);

test('a null hiddenFields over a view that shows every field changes nothing', () => {
  const w = build();
  const doc = edited(w, (t) => {
    t.hiddenFields = null;
    t.views[0].fields = allNames(t);
  });
  const plan = w.applySchema(doc, { dryRun: true });
  assert.ok(!plan.some((p) => p.action === 'update-table'), JSON.stringify(plan));
});

test('a null hiddenFields over a view that hides fields clears the hidden list', () => {
  const w = build();
  const before = taskOf(w.describeSchema()).hiddenFields;
  assert.ok(before.length > 0, 'the table starts with hidden fields');
  const plan = w.applySchema(edited(w, (t) => { t.hiddenFields = null; }));
  assert.deepEqual(plan, [{ action: 'update-table', subject: 'Dev/Task' }]);
  assert.deepEqual(taskOf(w.describeSchema()).hiddenFields ?? [], []);
});

test('a null sort over a view with no sort changes nothing', () => {
  const w = build();
  const plan = w.applySchema(edited(w, (t) => { t.sort = null; }), { dryRun: true });
  assert.deepEqual(plan, []);
});

test('a null sort over a view with a sort clears it', () => {
  const w = build();
  w.tableView('Dev/Task/Standard', { sort: [{ field: 'Status', dir: 'asc' }] });
  assert.deepEqual(taskOf(w.describeSchema()).views[0].sort, [{ field: 'Status', dir: 'asc' }]);
  const plan = w.applySchema(edited(w, (t) => { t.sort = null; }));
  assert.deepEqual(plan, [{ action: 'update-table', subject: 'Dev/Task' }]);
  assert.deepEqual(taskOf(w.describeSchema()).views[0].sort ?? [], []);
});

test('a sort in the document that matches the view changes nothing', () => {
  const w = build();
  w.tableView('Dev/Task/Standard', { sort: [{ field: 'Status', dir: 'asc' }] });
  const plan = w.applySchema(w.describeSchema(), { dryRun: true });
  assert.deepEqual(plan, []);
});
