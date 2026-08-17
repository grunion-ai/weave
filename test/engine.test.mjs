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
  // Deleting is recoverable by default (see soft-delete.test.mjs): the row
  // leaves the table but is still addressable. Purging is the opt-in.
  w.deleteEntity(t2.id);
  assert.equal(w.findEntity(tasks, '#2'), undefined);
  assert.equal(w.getEntity(t2.id).id, t2.id);
  w.deleteEntity(t2.id, { hard: true });
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

/* ---------- column order (Feature #41) ----------
   describeSchema() emits fields in fieldOrder, so the grid's column order IS
   fieldOrder. Reordering columns therefore has to be a schema write, not a
   client-side sort, or the order dies with the page. */

test('a table reorders its fields', () => {
  const { w, tasks } = buildWorkspace();
  const before = w.getTable(tasks).fieldOrder.slice();
  const names = () => w.describeSchema()[0].tables.find((t) => t.name === 'Task').fields.map((f) => f.name);
  const original = names();

  // Accepts names, not just ids — the UI holds column labels.
  const moved = [original[0], original[2], original[1], ...original.slice(3)];
  w.updateTable(tasks, { fieldOrder: moved });
  assert.deepEqual(names(), moved, 'describeSchema must follow the new order');
  assert.equal(w.getTable(tasks).fieldOrder.length, before.length, 'reorder must not add or drop fields');

  // A partial or padded order is a bug in the caller, not a silent field drop.
  assert.throws(() => w.updateTable(tasks, { fieldOrder: [original[0]] }), /every field/i);
  assert.throws(() => w.updateTable(tasks, { fieldOrder: [...original, original[0]] }), /every field/i);
  assert.throws(() => w.updateTable(tasks, { fieldOrder: [...original.slice(1), 'Nope'] }), /not found/i);
  assert.deepEqual(names(), moved, 'a rejected reorder leaves the order untouched');
});

test('a reordered table survives a reload', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-order-'));
  try {
    const path = join(dir, 'ws.db');
    const w1 = new Weave({ path });
    w1.createSpace({ name: 'S' });
    const db = w1.createTable({ space: 'S', name: 'Item' });
    w1.addField(db, { name: 'A', type: 'text' });
    w1.addField(db, { name: 'B', type: 'text' });
    // Derived, not hard-coded: a fresh table ships with its own fields
    // (Name, Description) and the order must stay a full permutation.
    const start = w1.describeSchema()[0].tables[0].fields.map((f) => f.name);
    const want = ['B', 'A', ...start.filter((n) => n !== 'A' && n !== 'B')];
    w1.updateTable(db, { fieldOrder: want });

    const w2 = new Weave({ path });
    assert.deepEqual(
      w2.describeSchema()[0].tables[0].fields.map((f) => f.name),
      want,
      'fieldOrder is persisted schema, not view state');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ---------- column widths (Feature #42) ----------
   A dragged column width is per-field, not per-viewer: the grid is the shared
   surface, so the width rides on the field like its name does. It is config on
   every field type, not a new column type, and clearing it returns the column
   to auto sizing. */

test('a field carries a column width', () => {
  const { w, tasks } = buildWorkspace();
  const fieldOf = (name) => w.describeSchema()[0].tables.find((t) => t.name === 'Task').fields.find((f) => f.name === name);
  assert.equal(fieldOf('Due').width, undefined, 'no width until one is set');

  w.updateField(tasks, 'Due', { config: { width: 180 } });
  assert.equal(fieldOf('Due').width, 180);

  // Width is orthogonal to the type config — setting one must not wipe the other.
  w.updateField(tasks, 'Priority', { config: { width: 120 } });
  assert.deepEqual(fieldOf('Priority').options, ['Low', 'Medium', 'High'], 'options survive a resize');
  w.updateField(tasks, 'Priority', { config: { options: ['Low', 'High'] } });
  assert.equal(fieldOf('Priority').width, 120, 'the width survives an options edit');

  // Auto-fit resets to auto sizing rather than writing a computed number.
  w.updateField(tasks, 'Due', { config: { width: null } });
  assert.equal(fieldOf('Due').width, undefined, 'null clears the width');

  // A width narrower than a usable column is a bug upstream, not a new default.
  assert.throws(() => w.updateField(tasks, 'Due', { config: { width: 4 } }), /width/i);
  assert.throws(() => w.updateField(tasks, 'Due', { config: { width: 'wide' } }), /width/i);
});

/* A width the grid forgets on reload is not a width — it is a 300ms animation.
   The in-memory case above passes without the field config ever reaching the
   store, so the round-trip needs its own reopen, exactly like fieldOrder. */
test('a resized column survives a reload', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-width-'));
  try {
    const path = join(dir, 'ws.db');
    const w1 = new Weave({ path });
    w1.createSpace({ name: 'S' });
    const db = w1.createTable({ space: 'S', name: 'Item' });
    w1.addField(db, { name: 'A', type: 'text' });
    w1.updateField(db, 'A', { config: { width: 173 } });

    const widthOf = (w) => w.describeSchema()[0].tables[0].fields.find((f) => f.name === 'A').width;
    assert.equal(widthOf(w1), 173, 'the width is set in memory');
    assert.equal(widthOf(new Weave({ path })), 173, 'width is persisted schema, not view state');

    // And clearing it must persist too, or auto-fit silently re-widens on reload.
    w1.updateField(db, 'A', { config: { width: null } });
    assert.equal(widthOf(new Weave({ path })), undefined, 'auto-fit persists as auto');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* Every document write is an event in its own right: "Description updated"
   says nothing about whether a word or a chapter changed, so the entry carries
   the shape of the edit — where it landed, how much came and went, and the
   first line that differs. */
test('a document change is logged with what actually changed', () => {
  const { w, tasks } = buildWorkspace();
  const t = w.createEntity(tasks, { name: 'T', doc: 'alpha\nbeta\n' });
  const docs = () => w.getEntity(t.id).activity.filter((a) => a.kind.startsWith('doc-'));

  w.setDoc(t.id, 'alpha\nBETA rewritten\ngamma\n');
  const [first] = docs();
  assert.equal(docs().length, 1, 'creating the entity with a doc is not a separate change');
  assert.equal(first.detail.field, 'Description');
  assert.equal(first.detail.prevLength, 'alpha\nbeta\n'.length);
  assert.equal(first.detail.length, 'alpha\nBETA rewritten\ngamma\n'.length);
  assert.equal(first.detail.delta, first.detail.length - first.detail.prevLength);
  assert.equal(first.detail.linesRemoved, 1, 'the beta line went');
  assert.equal(first.detail.linesAdded, 2, 'two lines took its place');
  assert.equal(first.detail.line, 2, '1-based line where the edit starts');
  assert.match(first.detail.preview, /BETA rewritten/, 'the first changed line is quoted');

  // Writing the same markdown back is not a change, so it is not an event.
  w.setDoc(t.id, 'alpha\nBETA rewritten\ngamma\n');
  assert.equal(docs().length, 1, 'an identical write logs nothing');

  w.appendDoc(t.id, 'delta');
  const appended = docs().at(-1);
  assert.equal(appended.kind, 'doc-appended');
  assert.equal(appended.detail.linesRemoved, 0, 'an append takes nothing away');
  assert.equal(appended.detail.linesAdded, 1, 'one new line of text arrived');
  assert.ok(appended.detail.delta > 0);
  assert.match(appended.detail.preview, /delta/);

  // The same enrichment when a document is written through the values path.
  w.updateEntity(t.id, { Description: 'wholly new\n' });
  const patched = docs().at(-1);
  assert.equal(patched.kind, 'doc-updated');
  assert.equal(patched.detail.line, 1);
  assert.ok(patched.detail.delta < 0, 'a shorter document reports a negative delta');
});

/* The workspace-level Activity table: one protected, non-user-definable feed
   of everything that happened anywhere, newest first. */
test('activityFeed reads every event across the workspace', () => {
  const { w, tasks } = buildWorkspace();
  const a = w.createEntity(tasks, { name: 'A' });
  const b = w.createEntity(tasks, { name: 'B' });
  w.setDoc(a.id, 'hello');
  w.addComment(b.id, { author: 'kyle', text: 'hi' });

  const feed = w.activityFeed();
  assert.ok(feed.total >= 4, 'created ×2, doc-updated, comment-added');
  assert.equal(feed.items.length, feed.total);
  const ts = feed.items.map((i) => i.ts);
  assert.deepEqual([...ts].sort().reverse(), ts, 'newest first');

  const one = feed.items.find((i) => i.kind === 'doc-updated');
  assert.equal(one.entityId, a.id);
  assert.equal(one.entityName, 'A');
  assert.equal(one.db, 'Product/Task');
  assert.equal(one.space, 'Product', 'the row names its space, not an internal id');
  assert.ok(one.id.startsWith(a.id), 'a stable per-event id, addressable from a link');
  assert.equal(w.getActivity(one.id).kind, 'doc-updated', 'and readable back by that id');

  // Filters: one entity's own feed is the same rows, narrowed.
  assert.ok(w.activityFeed({ entityId: b.id }).items.every((i) => i.entityId === b.id));
  assert.deepEqual(w.activityFeed({ kinds: ['comment-added'] }).items.map((i) => i.entityId), [b.id]);
  assert.equal(w.activityFeed({ limit: 2 }).items.length, 2);
  assert.equal(w.activityFeed({ limit: 2 }).total, feed.total, 'total counts the feed, not the page');
});

/* ---------- create is as forgiving as update (Issue #33) ----------
   updateEntity takes values by name, and the REST layer hands it `body.values
   ?? body`, so a flat {Name, Status} object is the shape callers reach for
   first. createEntity read only `input.values`, so the same flat object
   produced a row with nothing in it — and a 201 saying it worked. */

test('createEntity accepts values at the top level', () => {
  const { w, tasks } = buildWorkspace();

  const flat = w.createEntity(tasks, { Name: 'Flat', Estimate: 5, Priority: 'High' });
  const read = w.readEntity(flat.id);
  assert.equal(read.name, 'Flat', 'a top-level Name is a value, not a discarded key');
  assert.equal(read.fields.Estimate, 5);
  assert.equal(read.fields.Priority, 'High');

  // The documented shapes keep working, and `values` stays authoritative when
  // both are present — same precedence as `input.name` losing to values.Name.
  const nested = w.createEntity(tasks, { name: 'Nested', values: { Estimate: 1 } });
  assert.equal(w.readEntity(nested.id).fields.Estimate, 1);
  const both = w.createEntity(tasks, { Estimate: 9, values: { Estimate: 2 } });
  assert.equal(w.readEntity(both.id).fields.Estimate, 2, 'explicit values win over flat keys');

  // Reserved keys are still reserved, not mistaken for fields.
  const doc = w.createEntity(tasks, { name: 'Doc', doc: '# hi' });
  assert.match(w.getDoc(doc.id), /# hi/);

  // A misspelled field is now loud instead of silently dropped.
  assert.throws(() => w.createEntity(tasks, { Nmae: 'typo' }), /not found/);
});

/* A field definition can carry the value a new row starts with. Validated when
   the field is defined, so a definition can never hold a value the same field
   would reject on a row. */
test('field defaults: defined once, applied to every new row', () => {
  const { w, tasks } = buildWorkspace();
  w.addField(tasks, { name: 'Effort', type: 'number', config: { default: 3 } });
  w.addField(tasks, { name: 'Lane', type: 'select', config: { options: ['Now', 'Next'], default: 'Next' } });
  w.addField(tasks, { name: 'Blocked', type: 'checkbox', config: { default: true } });

  const fresh = w.readEntity(w.createEntity(tasks, { name: 'Fresh' }).id);
  assert.equal(fresh.fields.Effort, 3);
  assert.equal(fresh.fields.Lane, 'Next');
  assert.equal(fresh.fields.Blocked, true);

  // Naming the field wins, including naming it empty.
  const named = w.readEntity(w.createEntity(tasks, { name: 'Named', values: { Effort: 8, Lane: 'Now' } }).id);
  assert.equal(named.fields.Effort, 8);
  assert.equal(named.fields.Lane, 'Now');
  const cleared = w.readEntity(w.createEntity(tasks, { name: 'Cleared', values: { Effort: null } }).id);
  assert.equal(cleared.fields.Effort, null, 'an explicit empty is a choice, not an omission');

  // Existing rows are untouched by a default added later.
  w.addField(tasks, { name: 'Later', type: 'text', config: { default: 'x' } });
  assert.equal(w.readEntity(fresh.id).fields.Later, null);

  // The default is validated against its own field.
  assert.throws(() => w.addField(tasks, { name: 'Bad', type: 'number', config: { default: 'nope' } }), /number/i);
  assert.throws(() => w.addField(tasks, { name: 'BadPick', type: 'select', config: { options: ['a'], default: 'z' } }), /option/i);
  // Types with nothing to default say so rather than silently dropping it.
  assert.throws(() => w.addField(tasks, { name: 'Doc2', type: 'document', config: { default: 'hi' } }), /cannot carry a default/);
  assert.throws(() => w.addField(tasks, { name: 'Calc', type: 'formula', config: { expression: '1 + 1', default: 2 } }), /cannot carry a default/);

  // Editing a field can set or clear the default.
  w.updateField(tasks, 'Effort', { config: { default: 5 } });
  assert.equal(w.readEntity(w.createEntity(tasks, { name: 'After' }).id).fields.Effort, 5);
  w.updateField(tasks, 'Effort', { config: { default: null } });
  assert.equal(w.readEntity(w.createEntity(tasks, { name: 'Cleared default' }).id).fields.Effort, null);
  assert.throws(() => w.updateField(tasks, 'Effort', { config: { default: 'nope' } }), /number/i);

  // A workflow keeps its default state — one default mechanism per field.
  assert.equal(w.readEntity(w.createEntity(tasks, { name: 'State check' }).id).fields.State, 'Open');
  assert.throws(() => w.addField(tasks, {
    name: 'Stage', type: 'workflow',
    config: { states: [{ name: 'A', category: 'not-started' }], default: 'A' },
  }), /cannot carry a default/);

  // Defaults survive an export/import round trip.
  const copy = new Weave();
  copy.importJSON(w.exportJSON());
  const copied = copy.getField(copy.getTable('Product/Task').id, 'Lane');
  assert.equal(copied.config.default, w.getField(tasks.id ?? tasks, 'Lane').config.default);
});
