import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';

function buildWorkspace() {
  const w = new Weave();
  const space = w.createSpace({ name: 'Product' });
  const projects = w.createTable({ space: 'Product', name: 'Project' });
  const tasks = w.createTable({ space: 'Product', name: 'Task' });

  w.addField(projects, { name: 'Budget', type: 'number' });
  w.addField(tasks, { name: 'Estimate', type: 'number' });
  w.addField(tasks, { name: 'Due', type: 'date' });
  w.addField(tasks, { name: 'Priority', type: 'select', config: { options: ['Low', 'Medium', 'High'] } });
  w.addField(tasks, { name: 'Tags', type: 'multiselect', config: { options: ['bug', 'feature', 'chore'] } });
  w.addField(tasks, {
    name: 'State', type: 'workflow', config: {
      states: [
        { name: 'Open', category: 'not-started', default: true },
        { name: 'In Progress', category: 'in-progress' },
        { name: 'Done', category: 'done' },
        { name: 'Canceled', category: 'canceled' },
      ],
    },
  });
  w.addRelation(tasks, { name: 'Project', targetDb: projects, cardinality: 'many-to-one', inverseName: 'Tasks' });
  return { w, space, projects, tasks };
}

test('spaces and tables', () => {
  const { w } = buildWorkspace();
  assert.equal(w.listSpaces().length, 1);
  assert.equal(w.listTables().length, 2);
  assert.equal(w.getTable('Product/Task').name, 'Task');
  assert.equal(w.getTable('task').name, 'Task');
  assert.throws(() => w.getTable('Nope'), /not found/);
  assert.throws(() => w.createSpace({ name: 'Product' }), /already exists/);
});

test('entity CRUD, public ids, name field', () => {
  const { w, tasks } = buildWorkspace();
  const t1 = w.createEntity(tasks, { name: 'First task', values: { Estimate: 5 } });
  const t2 = w.createEntity(tasks, { name: 'Second task' });
  assert.equal(t1.publicId, 1);
  assert.equal(t2.publicId, 2);
  const read = w.readEntity(t1.id);
  assert.equal(read.name, 'First task');
  assert.equal(read.fields.Estimate, 5);
  assert.equal(read.fields.State, 'Open'); // default workflow state
  w.updateEntity(t1.id, { Name: 'Renamed', Estimate: 8 });
  assert.equal(w.readEntity(t1.id).name, 'Renamed');
  assert.equal(w.findEntity(tasks, '#2').id, t2.id);
  assert.equal(w.findEntity(tasks, 'Second task').id, t2.id);
  w.deleteEntity(t2.id);
  assert.throws(() => w.getEntity(t2.id), /not found/);
});

test('value validation', () => {
  const { w, tasks } = buildWorkspace();
  const t = w.createEntity(tasks, { name: 'T' });
  assert.throws(() => w.updateEntity(t.id, { Estimate: 'abc' }), /not a number/);
  assert.throws(() => w.updateEntity(t.id, { Due: 'not-a-date' }), /not a valid date/);
  assert.throws(() => w.updateEntity(t.id, { Priority: 'Urgent' }), /not an option/);
  assert.throws(() => w.updateEntity(t.id, { Nope: 1 }), /not found/);
  w.updateEntity(t.id, { Priority: 'High', Tags: ['bug', 'chore'], Due: '2026-09-01' });
  const read = w.readEntity(t.id);
  assert.equal(read.fields.Priority, 'High');
  assert.deepEqual(read.fields.Tags, ['bug', 'chore']);
});

test('workflow multistate transitions', () => {
  const { w, tasks } = buildWorkspace();
  const t = w.createEntity(tasks, { name: 'T' });
  w.setState(t.id, 'State', 'In Progress');
  assert.equal(w.readEntity(t.id).fields.State, 'In Progress');
  assert.throws(() => w.setState(t.id, 'State', 'Bogus'), /not a state/);
  // via updateEntity too
  w.updateEntity(t.id, { State: 'Done' });
  assert.equal(w.readEntity(t.id).fields.State, 'Done');
  const activity = w.getEntity(t.id).activity.filter((a) => a.kind === 'state-changed');
  assert.equal(activity.length, 2);
  assert.equal(activity[1].detail.to, 'Done');
});

test('many-to-one relation with bidirectional consistency', () => {
  const { w, projects, tasks } = buildWorkspace();
  const p1 = w.createEntity(projects, { name: 'Alpha' });
  const p2 = w.createEntity(projects, { name: 'Beta' });
  const t = w.createEntity(tasks, { name: 'T', values: { Project: 'Alpha' } });

  assert.equal(w.readEntity(t.id).fields.Project.name, 'Alpha');
  assert.deepEqual(w.readEntity(p1.id).fields.Tasks.map((s) => s.name), ['T']);

  // Reassign: p1 must lose the task, p2 must gain it.
  w.updateEntity(t.id, { Project: 'Beta' });
  assert.deepEqual(w.readEntity(p1.id).fields.Tasks, []);
  assert.deepEqual(w.readEntity(p2.id).fields.Tasks.map((s) => s.name), ['T']);

  // Link from the collection side steals it back.
  w.link(p1.id, 'Tasks', ['T']);
  assert.equal(w.readEntity(t.id).fields.Project.name, 'Alpha');
  assert.deepEqual(w.readEntity(p2.id).fields.Tasks, []);

  // Deleting the task cleans the collection.
  w.deleteEntity(t.id);
  assert.deepEqual(w.readEntity(p1.id).fields.Tasks, []);
});

test('many-to-many relation', () => {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  const a = w.createTable({ space: 'S', name: 'Doc' });
  const b = w.createTable({ space: 'S', name: 'Tag' });
  w.addRelation(a, { name: 'Tags', targetDb: b, cardinality: 'many-to-many', inverseName: 'Docs' });
  const d1 = w.createEntity(a, { name: 'D1' });
  const d2 = w.createEntity(a, { name: 'D2' });
  const t1 = w.createEntity(b, { name: 'red' });
  w.link(d1.id, 'Tags', ['red']);
  w.link(d2.id, 'Tags', ['red']);
  assert.deepEqual(w.readEntity(t1.id).fields.Docs.map((s) => s.name).sort(), ['D1', 'D2']);
  w.unlink(d1.id, 'Tags', ['red']);
  assert.deepEqual(w.readEntity(t1.id).fields.Docs.map((s) => s.name), ['D2']);
  assert.deepEqual(w.readEntity(d1.id).fields.Tags, []);
});

test('lookup and rollup fields', () => {
  const { w, projects, tasks } = buildWorkspace();
  w.addField(tasks, { name: 'Project Budget', type: 'lookup', config: { relationField: 'Project', targetField: 'Budget' } });
  w.addField(projects, { name: 'Task Count', type: 'rollup', config: { relationField: 'Tasks', aggregate: 'count' } });
  w.addField(projects, { name: 'Total Estimate', type: 'rollup', config: { relationField: 'Tasks', targetField: 'Estimate', aggregate: 'sum' } });
  w.addField(projects, { name: 'Avg Estimate', type: 'rollup', config: { relationField: 'Tasks', targetField: 'Estimate', aggregate: 'avg' } });
  w.addField(projects, { name: 'Task Names', type: 'rollup', config: { relationField: 'Tasks', targetField: 'Name', aggregate: 'join' } });
  w.addField(projects, { name: 'Task States', type: 'rollup', config: { relationField: 'Tasks', targetField: 'State', aggregate: 'join' } });

  const p = w.createEntity(projects, { name: 'Alpha', values: { Budget: 1000 } });
  w.createEntity(tasks, { name: 'T1', values: { Estimate: 3, Project: 'Alpha' } });
  const t2 = w.createEntity(tasks, { name: 'T2', values: { Estimate: 5, Project: 'Alpha' } });
  w.setState(t2.id, 'State', 'Done');

  const read = w.readEntity(p.id);
  assert.equal(read.fields['Task Count'], 2);
  assert.equal(read.fields['Total Estimate'], 8);
  assert.equal(read.fields['Avg Estimate'], 4);
  assert.equal(read.fields['Task Names'], 'T1, T2');
  assert.equal(read.fields['Task States'], 'Open, Done'); // display values, not ids

  const tread = w.readEntity(t2.id);
  assert.equal(tread.fields['Project Budget'], 1000);

  // Rollup over lookup chains: rollup of a computed field on targets.
  w.addField(tasks, { name: 'Padded', type: 'formula', config: { expression: 'Estimate * 2' } });
  w.addField(projects, { name: 'Padded Sum', type: 'rollup', config: { relationField: 'Tasks', targetField: 'Padded', aggregate: 'sum' } });
  assert.equal(w.readEntity(p.id).fields['Padded Sum'], 16);

  // Computed fields reject writes.
  assert.throws(() => w.updateEntity(p.id, { 'Task Count': 5 }), /computed/);
});

test('formula fields over entity values', () => {
  const { w, tasks } = buildWorkspace();
  w.addField(tasks, { name: 'Label', type: 'formula', config: { expression: 'concat(Name, " (", Priority, ")")' } });
  const t = w.createEntity(tasks, { name: 'Fix bug', values: { Priority: 'High' } });
  assert.equal(w.readEntity(t.id).fields.Label, 'Fix bug (High)');
});

test('query: filters, dotted paths, sort, pagination, select', () => {
  const { w, projects, tasks } = buildWorkspace();
  w.createEntity(projects, { name: 'Alpha', values: { Budget: 100 } });
  w.createEntity(projects, { name: 'Beta', values: { Budget: 900 } });
  w.createEntity(tasks, { name: 'A', values: { Estimate: 1, Priority: 'Low', Project: 'Alpha' } });
  w.createEntity(tasks, { name: 'B', values: { Estimate: 5, Priority: 'High', Project: 'Alpha' } });
  const c = w.createEntity(tasks, { name: 'C', values: { Estimate: 9, Priority: 'High', Project: 'Beta' } });
  w.setState(c.id, 'State', 'Done');

  assert.equal(w.query(tasks, { where: [['Priority', '=', 'High']] }).total, 2);
  assert.equal(w.query(tasks, { where: [['Estimate', '>', 4]] }).total, 2);
  assert.equal(w.query(tasks, { where: [['State', '!=', 'Done']] }).total, 2);
  assert.equal(w.query(tasks, { where: [['Project.Name', '=', 'Alpha']] }).total, 2);
  assert.equal(w.query(tasks, { where: [['Project.Budget', '>', 500]] }).total, 1);
  assert.equal(w.query(tasks, { where: { or: [['Name', '=', 'A'], ['Name', '=', 'C']] } }).total, 2);
  assert.equal(w.query(tasks, { where: [['Name', 'contains', 'a']] }).total, 1);
  assert.equal(w.query(tasks, { where: [['Priority', 'in', ['Low', 'High']]] }).total, 3);
  assert.equal(w.query(projects, { where: [['Tasks', 'not-empty']] }).total, 2);

  const sorted = w.query(tasks, { sort: [{ field: 'Estimate', dir: 'desc' }] });
  assert.deepEqual(sorted.items.map((i) => i.name), ['C', 'B', 'A']);

  const page = w.query(tasks, { sort: ['Name'], limit: 2, offset: 1 });
  assert.equal(page.total, 3);
  assert.deepEqual(page.items.map((i) => i.name), ['B', 'C']);

  const sel = w.query(tasks, { where: [['Name', '=', 'C']], select: ['Estimate', 'Project.Name'] });
  assert.equal(sel.items[0].Estimate, 9);
  assert.equal(sel.items[0]['Project.Name'], 'Beta');
});

test('documents: set, append, get', () => {
  const { w, tasks } = buildWorkspace();
  const t = w.createEntity(tasks, { name: 'T', doc: '# Hello' });
  assert.equal(w.getDoc(t.id), '# Hello');
  w.appendDoc(t.id, 'More text.');
  assert.equal(w.getDoc(t.id), '# Hello\n\nMore text.');
  w.setDoc(t.id, 'Replaced');
  assert.equal(w.getDoc(t.id), 'Replaced');
});

test('comments and activity', () => {
  const { w, tasks } = buildWorkspace();
  const t = w.createEntity(tasks, { name: 'T' });
  const c = w.addComment(t.id, { author: 'kyle', text: 'Looks good' });
  assert.equal(w.readEntity(t.id).comments.length, 1);
  w.deleteComment(t.id, c.id);
  assert.equal(w.readEntity(t.id).comments.length, 0);
  assert.ok(w.getEntity(t.id).activity.some((a) => a.kind === 'created'));
});

test('automations: state-changed trigger with templated actions', () => {
  const { w, tasks } = buildWorkspace();
  w.addField(tasks, { name: 'Completed On', type: 'date' });
  w.createAutomation(tasks, {
    name: 'On done',
    trigger: { type: 'state-changed', field: 'State', toState: 'Done' },
    actions: [
      { type: 'set-field', field: 'Completed On', value: new Date().toISOString().slice(0, 10) },
      { type: 'append-doc', text: 'Completed {{Name}} on {{Today}}' },
      { type: 'add-comment', text: 'Done: {{Name}}' },
    ],
  });
  const t = w.createEntity(tasks, { name: 'Ship it' });
  w.setState(t.id, 'State', 'Done');
  const read = w.readEntity(t.id);
  assert.ok(read.fields['Completed On']);
  assert.match(read.doc, /Completed Ship it on \d{4}-\d{2}-\d{2}/);
  assert.equal(read.comments[0].text, 'Done: Ship it');
});

test('automations: entity-created trigger', () => {
  const { w, tasks } = buildWorkspace();
  w.createAutomation(tasks, {
    name: 'Welcome',
    trigger: { type: 'entity-created' },
    actions: [{ type: 'append-doc', text: 'Created task #{{PublicId}}' }],
  });
  const t = w.createEntity(tasks, { name: 'New' });
  assert.match(w.getDoc(t.id), /Created task #\d+/);
});

test('search across names and docs', () => {
  const { w, tasks } = buildWorkspace();
  w.createEntity(tasks, { name: 'Fix the login flow' });
  const t2 = w.createEntity(tasks, { name: 'Other' });
  w.setDoc(t2.id, 'Notes about the login page redirect');
  const results = w.search('login');
  assert.equal(results.length, 2);
  assert.equal(results[0].name, 'Fix the login flow'); // name match ranks higher
  assert.ok(results[1].snippet.includes('login'));
});

test('field deletion cascades: relation pairs and dependent computeds', () => {
  const { w, projects, tasks } = buildWorkspace();
  w.addField(projects, { name: 'Task Count', type: 'rollup', config: { relationField: 'Tasks', aggregate: 'count' } });
  w.createEntity(projects, { name: 'P' });
  w.createEntity(tasks, { name: 'T', values: { Project: 'P' } });
  w.deleteField(projects, 'Tasks');
  assert.equal(w.findField(w.getTable(projects.id), 'Task Count'), undefined); // dependent rollup dropped
  assert.equal(w.findField(w.getTable(tasks.id), 'Project'), undefined); // paired end dropped
});

test('CSV export and schema description', () => {
  const { w, tasks } = buildWorkspace();
  w.createEntity(tasks, { name: 'Comma, task', values: { Estimate: 2 } });
  const csv = w.exportCSV(tasks);
  assert.match(csv, /^Public Id,Name,Description,Estimate/);
  assert.match(csv, /"Comma, task"/);
  const schema = w.describeSchema();
  assert.equal(schema[0].space, 'Product');
  const taskDb = schema[0].tables.find((d) => d.name === 'Task');
  assert.ok(taskDb.fields.some((f) => f.type === 'workflow' && f.states.length === 4));
});

test('persistence roundtrip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-'));
  const path = join(dir, 'weave.json');
  try {
    const w1 = new Weave({ path });
    w1.createSpace({ name: 'S' });
    const db = w1.createTable({ space: 'S', name: 'Item' });
    w1.createEntity(db, { name: 'Persisted', doc: 'body' });

    const w2 = new Weave({ path });
    const items = w2.query('Item', {});
    assert.equal(items.total, 1);
    assert.equal(items.items[0].name, 'Persisted');
    assert.equal(items.items[0].doc, 'body');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('import/export JSON roundtrip', () => {
  const { w, tasks } = buildWorkspace();
  w.createEntity(tasks, { name: 'X' });
  const dump = w.exportJSON();
  const w2 = new Weave();
  w2.importJSON(dump);
  assert.equal(w2.query('Task', {}).total, 1);
});
