import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

function jobs() {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  const owner = w.createTable({ space: 'Ops', name: 'Owner' });
  w.addField(owner.id, { name: 'Tier', type: 'select', config: { options: ['Gold', 'Silver'] } });
  const job = w.createTable({ space: 'Ops', name: 'Job' });
  w.addField(job.id, { name: 'Stage', type: 'select', config: { options: ['Open', 'Done', 'Lost'] } });
  w.addField(job.id, { name: 'Hours', type: 'number' });
  w.addRelation(job.id, { name: 'Owner', targetDb: owner.id, cardinality: 'many-to-one', inverseName: 'Jobs' });
  const gold = w.createEntity(owner.id, { name: 'Maya', values: { Tier: 'Gold' } });
  const silver = w.createEntity(owner.id, { name: 'Ari', values: { Tier: 'Silver' } });
  w.createEntity(job.id, { name: 'a', values: { Stage: 'Done', Hours: 3, Owner: gold.id } });
  w.createEntity(job.id, { name: 'b', values: { Stage: 'Open', Hours: 4, Owner: silver.id } });
  w.createEntity(job.id, { name: 'c', values: { Stage: 'Done', Hours: 5, Owner: silver.id } });
  const spaces = Object.values(w.state.tables).find((t) => t.system === 'spaces');
  w.addField(spaces.id, { name: 'Done hours', type: 'rollup', config: { via: job.id, targetField: 'Hours', aggregate: 'sum', where: [['Stage', '=', 'Done']] } });
  w.addField(spaces.id, { name: 'Gold hours', type: 'rollup', config: { via: job.id, targetField: 'Hours', aggregate: 'sum', where: { or: [['Owner.Tier', '=', 'Gold']] } } });
  w.updateField(owner.id, 'Jobs', { config: { subtable: { fields: ['Stage', 'Hours'], filter: [['Stage', '!=', 'Lost']], sort: [{ field: 'Stage', dir: 'asc' }, { field: 'Created By', dir: 'desc' }] } } });
  const opsRow = w.listEntities(spaces.id).find((r) => w.entityName(r) === 'Ops');
  return { w, owner, job, spaces, opsRow };
}

const rollup = (w, row, name) => w.readEntity(row.id).fields[name];
const config = (w, table, name) => w.getField(table.id, name).config;

test('renaming a field rewrites the table rollup filters that name it, through a relation too (Issue #1734)', () => {
  const { w, owner, job, spaces, opsRow } = jobs();
  assert.equal(rollup(w, opsRow, 'Done hours'), 8);
  assert.equal(rollup(w, opsRow, 'Gold hours'), 3);
  w.updateField(job.id, 'Stage', { name: 'Phase' });
  w.updateField(owner.id, 'Tier', { name: 'Level' });
  assert.deepEqual(config(w, spaces, 'Done hours').where, [['Phase', '=', 'Done']]);
  assert.deepEqual(config(w, spaces, 'Gold hours').where, { or: [['Owner.Level', '=', 'Gold']] });
  assert.equal(rollup(w, opsRow, 'Done hours'), 8);
  assert.equal(rollup(w, opsRow, 'Gold hours'), 3);
});

test('renaming a field rewrites a relation subtable that shows, filters or sorts by it (Issue #1734)', () => {
  const { w, owner, job } = jobs();
  w.updateField(job.id, 'Stage', { name: 'Phase' });
  assert.deepEqual(config(w, owner, 'Jobs').subtable, {
    fields: ['Phase', 'Hours'],
    filter: [['Phase', '!=', 'Lost']],
    sort: [{ field: 'Phase', dir: 'asc' }, { field: 'Created By', dir: 'desc' }],
  });
  const described = w.describeSchema().flatMap((s) => s.tables).find((t) => t.id === owner.id).fields.find((f) => f.name === 'Jobs');
  assert.deepEqual(described.subtable.fields, ['Phase', 'Hours']);
});

test('the rename activity lists the settings it rewrote, and rolling it back puts them back (Issue #1734)', () => {
  const { w, owner, job, spaces } = jobs();
  const stage = w.getField(job.id, 'Stage');
  const seq = w.state.meta.activitySeq;
  w.updateField(job.id, 'Stage', { name: 'Phase' });
  const entry = w.fieldChangeSince(job.id, stage.id, seq);
  assert.deepEqual(entry.detail.rewritten.map((r) => [r.field, r.setting]).sort(), [['Owner.Jobs', 'subtable'], ['Spaces.Done hours', 'where']]);
  w.rollbackFieldConfig(entry.id);
  assert.deepEqual(config(w, spaces, 'Done hours').where, [['Stage', '=', 'Done']]);
  assert.deepEqual(config(w, owner, 'Jobs').subtable.fields, ['Stage', 'Hours']);
});

test('a name with a dot is refused while a filter path names the field, and nothing changes (Issue #1734)', () => {
  const { w, job, spaces } = jobs();
  assert.throws(() => w.updateField(job.id, 'Stage', { name: 'St.age' }), (err) => /Spaces\.Done hours/.test(err.message) && /Owner\.Jobs/.test(err.message));
  assert.equal(w.getField(job.id, 'Stage').name, 'Stage');
  assert.deepEqual(config(w, spaces, 'Done hours').where, [['Stage', '=', 'Done']]);
});

test('deleting a field a formula reads is refused and names the formula, by name or by id (Issue #1738)', () => {
  const w = new Weave();
  w.createSpace({ name: 'Sales' });
  const t = w.createTable({ space: 'Sales', name: 'Deal' });
  const amount = w.addField(t.id, { name: 'Amount', type: 'number' });
  w.addField(t.id, { name: 'Twice', type: 'formula', config: { expression: 'Amount * 2' } });
  const d = w.createEntity(t.id, { name: 'd1', values: { Amount: 5 } });
  assert.throws(() => w.deleteField(t.id, 'Amount'), /Cannot delete 'Amount': Deal\.Twice reads it/);
  assert.throws(() => w.deleteField(t.id, 'Amount', { hard: true }), /Deal\.Twice/);
  assert.equal(w.readEntity(d.id).fields.Twice, 10);
  w.getField(t.id, 'Twice').config.expression = `[${amount.id}] * 3`;
  assert.equal(w.readEntity(d.id).fields.Twice, 15, 'a stored reference by id reads the field');
  assert.throws(() => w.deleteField(t.id, 'Amount'), /Deal\.Twice/, 'and blocks its delete too');
  w.deleteField(t.id, 'Twice');
  assert.equal(w.deleteField(t.id, 'Amount').deleted, true, 'with no reader left the delete goes through');
});

test('deleting a field a table rollup filter or a subtable names is refused, naming each reader (Issue #1738)', () => {
  const { w, owner, job } = jobs();
  assert.throws(() => w.deleteField(job.id, 'Stage'), (err) => /Spaces\.Done hours/.test(err.message) && /Owner\.Jobs/.test(err.message));
  assert.throws(() => w.deleteField(owner.id, 'Tier'), /Spaces\.Gold hours/);
  assert.equal(w.getField(job.id, 'Stage').name, 'Stage');
  w.addField(job.id, { name: 'Note', type: 'text' });
  assert.equal(w.deleteField(job.id, 'Note').deleted, true, 'a field nothing reads deletes as before');
});

test('a destructive schema apply removes a formula together with the field it reads (Issue #1738)', () => {
  const w = new Weave();
  w.createSpace({ name: 'Sales' });
  const t = w.createTable({ space: 'Sales', name: 'Deal' });
  w.addField(t.id, { name: 'Amount', type: 'number' });
  w.addField(t.id, { name: 'Twice', type: 'formula', config: { expression: 'Amount * 2' } });
  const doc = w.describeSchema().filter((s) => s.space === 'Sales');
  const deal = doc[0].tables.find((x) => x.name === 'Deal');
  deal.fields = deal.fields.filter((f) => f.name !== 'Amount' && f.name !== 'Twice');
  w.applySchema(doc, { allowDestructive: true, partial: true });
  assert.deepEqual(Object.values(w.getTable(t.id).fields).map((f) => f.name).filter((n) => n === 'Amount' || n === 'Twice'), []);
});
