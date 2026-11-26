import test from 'node:test';
import assert from 'node:assert/strict';
import { fresh } from './lib/fixtures.mjs';

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

function retyped(w, name, type) {
  const doc = w.describeSchema();
  doc.find((s) => s.space === 'Dev').tables[0].fields.find((f) => f.name === name).type = type;
  return doc;
}

test('a type change TYPE_MIGRATIONS allows plans migrate-field and needs allowDestructive (Issue #1633)', () => {
  const w = fresh();
  w.addField('Task', { name: 'Estimate', type: 'number' });
  const row = w.createEntity('Task', { name: 'one', values: { Estimate: 5 } });
  const doc = retyped(w, 'Estimate', 'text');

  assert.throws(() => w.applySchema(doc, { dryRun: true }), (err) => /allowDestructive/.test(err.message)
    && /weave_update_field/.test(err.message) && /weave field update/.test(err.message) && !/delete the field/.test(err.message));
  const plan = w.applySchema(doc, { dryRun: true, allowDestructive: true });
  assert.deepEqual(plan, [{ action: 'migrate-field', subject: 'Dev/Task.Estimate' }]);
  assert.equal(w.getField('Task', 'Estimate').type, 'number', 'the dry run wrote nothing');

  w.applySchema(doc, { allowDestructive: true });
  assert.equal(w.getField('Task', 'Estimate').type, 'text');
  assert.equal(w.readEntity(row.id).fields.Estimate, '5', 'values convert the way updateField converts them');
  assert.deepEqual(w.applySchema(w.describeSchema(), { dryRun: true }), [], 'the migrated schema round-trips');

  const [entry] = w.activityFeed({ kinds: ['field-config-updated'] }).items.filter((a) => a.detail?.changed?.includes('type'));
  assert.equal(entry.detail.lossy, true, 'recorded as lossy, the way updateField records it');
  w.rollbackFieldConfig(entry.id);
  assert.equal(w.getField('Task', 'Estimate').type, 'number');
  assert.equal(w.readEntity(row.id).fields.Estimate, 5, 'the rollback brings the values back');
});

test('a type change TYPE_MIGRATIONS refuses still throws and names what the field can become (Issue #1633)', () => {
  const w = fresh();
  w.addField('Task', { name: 'Done', type: 'checkbox' });
  assert.throws(() => w.applySchema(retyped(w, 'Done', 'number'), { allowDestructive: true }),
    (err) => /cannot change type/.test(err.message) && /toggle, text/.test(err.message) && /weave_update_field/.test(err.message));
  w.createTable({ space: 'Dev', name: 'Project' });
  w.addRelation('Task', { name: 'Project', targetDb: 'Project' });
  assert.throws(() => w.applySchema(retyped(w, 'Project', 'number'), { allowDestructive: true }), /cannot change type/);
});

test('the system registry is not the document business', () => {
  const w = fresh();
  const doc = w.describeSchema().filter((s) => !s.system);
  const plan = w.applySchema(doc, { dryRun: true });
  assert.deepEqual(plan, [], 'omitting system spaces deletes nothing');
});

test('a refused apply writes nothing (Issue #996)', () => {
  const w = fresh();
  const before = w.listSpaces().map((s) => s.name);
  assert.throws(() => w.applySchema([{ space: 'Design', tables: [] }]), /would delete space/);
  assert.deepEqual(w.listSpaces().map((s) => s.name), before, 'the refused document created no space');
});
