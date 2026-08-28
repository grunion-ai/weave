import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';

/* Target-set relations (polymorphic): one relation field whose legal targets
   span several tables — including the Workspace registry, so a row can point
   at a space or a table as easily as at another row. Multi-target fields are
   ONE-WAY (no inverse is minted); singleton target sets keep today's paired
   behaviour exactly. */

function build() {
  const w = new Weave();
  w.createSpace({ name: 'Product' });
  const projects = w.createTable({ space: 'Product', name: 'Project' });
  const tasks = w.createTable({ space: 'Product', name: 'Task' });
  const tickets = w.createTable({ space: 'Product', name: 'Ticket' });
  w.addField(tasks, { name: 'Estimate', type: 'number' });
  return { w, projects, tasks, tickets };
}

test('multi-target relation: created with targetDbs, no inverse anywhere', () => {
  const { w, projects, tasks, tickets } = build();
  const { field, inverse } = w.addRelation(tickets, {
    name: 'Scope', targetDbs: [tasks, projects], cardinality: 'many-to-many',
  });
  assert.equal(field.type, 'relation');
  assert.deepEqual(field.config.targetDbs, [tasks.id, projects.id]);
  assert.equal(field.config.targetDb, undefined);
  assert.equal(field.config.inverseFieldId, undefined);
  assert.equal(field.config.many, true);
  assert.equal(inverse, null);
  // No stray field appeared on either member table.
  for (const t of [tasks, projects]) {
    const names = Object.values(w.getTable(t.id).fields).map((f) => f.name);
    assert.ok(!names.includes('Tickets'), `no inverse on ${t.name}`);
  }
});

test('singleton targetDbs array collapses to the classic paired relation', () => {
  const { w, projects, tickets } = build();
  const { field, inverse } = w.addRelation(tickets, {
    name: 'Project', targetDbs: [projects], cardinality: 'many-to-one', inverseName: 'Tickets',
  });
  assert.equal(field.config.targetDb, projects.id);
  assert.equal(field.config.targetDbs, undefined);
  assert.ok(inverse);
  assert.equal(inverse.config.targetDb, tickets.id);
});

test('multi-target needs at least one target and rejects unknown cardinality reuse', () => {
  const { w, tickets } = build();
  assert.throws(() => w.addRelation(tickets, { name: 'Scope', targetDbs: [] }), /target/i);
});

test('linking across member tables and the registry, chips carry each home table', () => {
  const { w, projects, tasks, tickets } = build();
  w.addRelation(tickets, { name: 'Scope', targetDbs: [tasks, projects, 'Workspace/Spaces'], cardinality: 'many-to-many' });
  const task = w.createEntity(tasks, { values: { Name: 'Fix header' } });
  const proj = w.createEntity(projects, { values: { Name: 'Redesign' } });
  const spaceRow = w.findEntity('Workspace/Spaces', 'Product');
  assert.ok(spaceRow, 'registry row for the Product space exists');

  const t = w.createEntity(tickets, { values: { Name: 'Rendering bug' } });
  w.link(t.id, 'Scope', [task.id, proj.id, spaceRow.id]);

  const read = w.readEntity(t.id);
  const chips = read.fields.Scope;
  assert.equal(chips.length, 3);
  const dbs = chips.map((c) => c.db).sort();
  assert.deepEqual(dbs, ['Product/Project', 'Product/Task', 'Workspace/Spaces'].sort());
});

test('name refs resolve across the target set; outsiders are rejected', () => {
  const { w, projects, tasks, tickets } = build();
  w.addRelation(tickets, { name: 'Scope', targetDbs: [tasks, projects], cardinality: 'many-to-many' });
  w.createEntity(tasks, { values: { Name: 'Alpha' } });
  w.createEntity(projects, { values: { Name: 'Beta' } });
  const outsider = w.createEntity(tickets, { values: { Name: 'Gamma' } });

  const t = w.createEntity(tickets, { values: { Name: 'T', Scope: ['Alpha', 'Beta'] } });
  const read = w.readEntity(t.id);
  assert.equal(read.fields.Scope.length, 2);

  assert.throws(() => w.link(t.id, 'Scope', [outsider.id]), /not in (a|the) related table/i);
  assert.throws(() => w.link(t.id, 'Scope', ['Nope']), /not found/);
});

test('single-cardinality multi-target holds exactly one, replacing on link', () => {
  const { w, projects, tasks, tickets } = build();
  w.addRelation(tickets, { name: 'Applies To', targetDbs: [tasks, projects], cardinality: 'many-to-one' });
  const task = w.createEntity(tasks, { values: { Name: 'A' } });
  const proj = w.createEntity(projects, { values: { Name: 'B' } });
  const t = w.createEntity(tickets, { values: { Name: 'T' } });
  w.link(t.id, 'Applies To', [task.id]);
  w.link(t.id, 'Applies To', [proj.id]); // single: replaces
  const read = w.readEntity(t.id);
  assert.equal(read.fields['Applies To'].id, proj.id); // single relation reads as one summary
});

test('lookup and rollup refuse a multi-target relation', () => {
  const { w, projects, tasks, tickets } = build();
  w.addRelation(tickets, { name: 'Scope', targetDbs: [tasks, projects], cardinality: 'many-to-many' });
  assert.throws(
    () => w.addField(tickets, { name: 'L', type: 'lookup', config: { relationField: 'Scope', targetField: 'Name' } }),
    /single-target/i,
  );
  assert.throws(
    () => w.addField(tickets, { name: 'R', type: 'rollup', config: { relationField: 'Scope', aggregate: 'count' } }),
    /single-target/i,
  );
});

test('query traversal walks a heterogeneous target set by each target\'s own table', () => {
  const { w, projects, tasks, tickets } = build();
  w.addRelation(tickets, { name: 'Scope', targetDbs: [tasks, projects], cardinality: 'many-to-many' });
  const task = w.createEntity(tasks, { values: { Name: 'Alpha' } });
  const proj = w.createEntity(projects, { values: { Name: 'Beta' } });
  const t = w.createEntity(tickets, { values: { Name: 'T' } });
  w.link(t.id, 'Scope', [task.id, proj.id]);
  const hit = w.query(tickets, { where: [['Scope.Name', '=', 'Beta']] });
  assert.equal(hit.items.length, 1);
  const miss = w.query(tickets, { where: [['Scope.Name', '=', 'Nope']] });
  assert.equal(miss.items.length, 0);
});

test('unlink and undo work on a multi-target field', () => {
  const { w, projects, tasks, tickets } = build();
  w.addRelation(tickets, { name: 'Scope', targetDbs: [tasks, projects], cardinality: 'many-to-many' });
  const task = w.createEntity(tasks, { values: { Name: 'A' } });
  const t = w.createEntity(tickets, { values: { Name: 'T' } });
  w.link(t.id, 'Scope', [task.id]);
  w.unlink(t.id, 'Scope', [task.id]);
  assert.equal(w.readEntity(t.id).fields.Scope.length, 0);
  w.undo();
  assert.equal(w.readEntity(t.id).fields.Scope.length, 1);
});

test('deleting a multi-target field leaves the member tables untouched', () => {
  const { w, projects, tasks, tickets } = build();
  const { field } = w.addRelation(tickets, { name: 'Scope', targetDbs: [tasks, projects], cardinality: 'many-to-many' });
  const before = Object.keys(w.getTable(tasks.id).fields).length;
  w.deleteField(tickets, field.id);
  assert.equal(Object.keys(w.getTable(tasks.id).fields).length, before);
  assert.ok(!w.getTable(tickets.id).fields[field.id]);
});

test('deleting a member table prunes it from the target set; the last member takes the field with it', () => {
  const { w, projects, tasks, tickets } = build();
  const { field } = w.addRelation(tickets, { name: 'Scope', targetDbs: [tasks, projects], cardinality: 'many-to-many' });
  w.deleteTable(tasks.id);
  const f = w.getTable(tickets.id).fields[field.id];
  assert.deepEqual(f.config.targetDbs, [projects.id]);
  w.deleteTable(projects.id);
  assert.ok(!w.getTable(tickets.id).fields[field.id], 'field gone with its last target');
});

test('deleted targets drop out of reads but keep their stored link', () => {
  const { w, projects, tasks, tickets } = build();
  w.addRelation(tickets, { name: 'Scope', targetDbs: [tasks, projects], cardinality: 'many-to-many' });
  const task = w.createEntity(tasks, { values: { Name: 'A' } });
  const t = w.createEntity(tickets, { values: { Name: 'T' } });
  w.link(t.id, 'Scope', [task.id]);
  w.deleteEntity(task.id);
  assert.equal(w.readEntity(t.id).fields.Scope.length, 0);
  w.restoreEntity(task.id);
  assert.equal(w.readEntity(t.id).fields.Scope.length, 1);
});

test('relation map draws one edge per member table', () => {
  const { w, projects, tasks, tickets } = build();
  w.addRelation(tickets, { name: 'Scope', targetDbs: [tasks, projects], cardinality: 'many-to-many' });
  const mmd = w.relationMapMmd();
  const edges = mmd.split('\n').filter((l) => l.includes('"Scope"'));
  assert.equal(edges.length, 2);
});

test('describeSchema names every member of the target set', () => {
  const { w, projects, tasks, tickets } = build();
  w.addRelation(tickets, { name: 'Scope', targetDbs: [tasks, projects], cardinality: 'many-to-many' });
  const desc = w.describeSchema();
  const table = desc.flatMap((sp) => sp.tables).find((d) => d.name === 'Ticket');
  const f = table.fields.find((x) => x.name === 'Scope');
  assert.deepEqual(f.targetDbIds, [tasks.id, projects.id]);
  assert.deepEqual(f.targetDbs, ['Product/Task', 'Product/Project']);
  assert.equal(f.targetDbId, undefined);
  assert.equal(f.many, true);
  assert.equal(f.inverseFieldId, undefined);
});

test('persistence round-trip: a multi-target field survives save/load', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-poly-'));
  const path = join(dir, 'w.json');
  try {
    const w1 = new Weave({ path });
    w1.createSpace({ name: 'Product' });
    const projects = w1.createTable({ space: 'Product', name: 'Project' });
    const tasks = w1.createTable({ space: 'Product', name: 'Task' });
    const tickets = w1.createTable({ space: 'Product', name: 'Ticket' });
    w1.addRelation(tickets, { name: 'Scope', targetDbs: [tasks, projects], cardinality: 'many-to-many' });
    const task = w1.createEntity(tasks, { values: { Name: 'A' } });
    const t = w1.createEntity(tickets, { values: { Name: 'T', Scope: [task.id] } });

    const w2 = new Weave({ path });
    assert.equal(w2.readEntity(t.id).fields.Scope.length, 1);
    const scope = Object.values(w2.getTable('Product/Ticket').fields).find((f) => f.name === 'Scope');
    assert.deepEqual(scope.config.targetDbs, [tasks.id, projects.id]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
