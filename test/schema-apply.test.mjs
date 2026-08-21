import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

/* Feature #13 — the schema as an editable document. describeSchema() was
   already the read half; applySchema() closes the loop: hand back an edited
   copy of that JSON and the workspace grows to match. Additive by design —
   creations and config updates apply; deletions and type changes are refused
   unless explicitly allowed (and type changes always are refused: delete and
   recreate is the honest spelling). Names are identity in the document, so a
   rename cannot be expressed here — that is what the registry rows (#12/#52)
   are for. */

function fresh() {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  return w;
}

test('a round-trip is a no-op', () => {
  const w = fresh();
  const plan = w.applySchema(w.describeSchema(), { dryRun: true });
  assert.deepEqual(plan, [], 'nothing to change');
});

test('additions in the document become real structure', () => {
  const w = fresh();
  const doc = w.describeSchema();
  const dev = doc.find((s) => s.space === 'Dev');
  dev.tables.find((t) => t.name === 'Task').fields.push({ name: 'Estimate', type: 'number' });
  dev.tables.push({ name: 'Project', description: 'What we ship', fields: [{ name: 'Budget', type: 'number' }] });
  doc.push({ space: 'Ops', description: 'Operations', tables: [] });

  const plan = w.applySchema(doc, { dryRun: true });
  const kinds = plan.map((p) => p.action).sort();
  assert.deepEqual(kinds, ['create-field', 'create-space', 'create-table']);

  const applied = w.applySchema(doc);
  assert.equal(applied.length, 3);
  assert.ok(w.getSpace('Ops'));
  assert.ok(w.getTable('Dev/Project'));
  assert.ok(Object.values(w.getTable('Task').fields).find((f) => f.name === 'Estimate'));
  assert.equal(w.getTable('Dev/Project').description, 'What we ship');
});

test('select options and workflow states update in place; descriptions too', () => {
  const w = fresh();
  w.addField('Task', { name: 'Kind', type: 'select', config: { options: [{ name: 'bug' }] } });
  const doc = w.describeSchema();
  const task = doc.find((s) => s.space === 'Dev').tables[0];
  task.fields.find((f) => f.name === 'Kind').options.push('feature');
  task.description = 'The work';

  w.applySchema(doc);
  const kind = Object.values(w.getTable('Task').fields).find((f) => f.name === 'Kind');
  assert.deepEqual(kind.config.options.map((o) => o.name), ['bug', 'feature']);
  assert.equal(w.getTable('Task').description, 'The work');
});

test('a formula field can be authored in the document', () => {
  const w = fresh();
  w.addField('Task', { name: 'Estimate', type: 'number' });
  const doc = w.describeSchema();
  doc.find((s) => s.space === 'Dev').tables[0].fields.push({ name: 'Double', type: 'formula', expression: 'Estimate * 2' });
  w.applySchema(doc);
  const t = w.createEntity('Task', { name: 'T', values: { Estimate: 4 } });
  assert.equal(w.readEntity(t.id).fields.Double, 8);
});

test('omissions are deletions — refused unless allowed, and audited when done', () => {
  const w = fresh();
  w.addField('Task', { name: 'Old', type: 'text' });
  const doc = w.describeSchema();
  const task = doc.find((s) => s.space === 'Dev').tables[0];
  task.fields = task.fields.filter((f) => f.name !== 'Old');

  assert.throws(() => w.applySchema(doc), /destructive|delete/i);
  const plan = w.applySchema(doc, { allowDestructive: true });
  assert.deepEqual(plan.map((p) => p.action), ['delete-field']);
  assert.equal(Object.values(w.getTable('Task').fields).find((f) => f.name === 'Old'), undefined);
});

test('a type change is never applied — the document cannot mean that', () => {
  const w = fresh();
  w.addField('Task', { name: 'Estimate', type: 'number' });
  const doc = w.describeSchema();
  doc.find((s) => s.space === 'Dev').tables[0].fields.find((f) => f.name === 'Estimate').type = 'text';
  assert.throws(() => w.applySchema(doc, { allowDestructive: true }), /type/i);
});

test('the system registry is not the document business', () => {
  const w = fresh();
  const doc = w.describeSchema().filter((s) => !s.system);
  const plan = w.applySchema(doc, { dryRun: true });
  assert.deepEqual(plan, [], 'omitting system spaces deletes nothing');
});
