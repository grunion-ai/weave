import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

function build() {
  const w = new Weave();
  w.createSpace({ name: 'Product' });
  const projects = w.createTable({ space: 'Product', name: 'Project' });
  const tasks = w.createTable({ space: 'Product', name: 'Task' });
  w.addRelation(tasks, { name: 'Project', targetDb: projects, cardinality: 'many-to-one', inverseName: 'Tasks' });
  return { w, projects, tasks };
}

const rel = (w, id) => w.getEntity(id).activity.filter((a) => a.kind === 'relation-updated');

test('linking logs the change on both rows, the far one tagged inverse', () => {
  const { w, projects, tasks } = build();
  const apollo = w.createEntity(projects, { name: 'Apollo' });
  const task = w.createEntity(tasks, { name: 'Ship the editor' });

  w.link(task.id, 'Project', apollo.id);

  const near = rel(w, task.id);
  assert.equal(near.length, 1);
  assert.deepEqual(near[0].detail, { field: 'Project', added: ['Apollo'], removed: [] });

  const far = rel(w, apollo.id);
  assert.equal(far.length, 1, 'the far row logs the link it received');
  assert.deepEqual(far[0].detail, { field: 'Tasks', added: ['Ship the editor'], removed: [], inverse: true });
});

test('unlinking logs the removal on both rows', () => {
  const { w, projects, tasks } = build();
  const apollo = w.createEntity(projects, { name: 'Apollo' });
  const task = w.createEntity(tasks, { name: 'Ship the editor' });
  w.link(task.id, 'Project', apollo.id);

  w.unlink(task.id, 'Project', apollo.id);

  assert.deepEqual(rel(w, task.id).at(-1).detail, { field: 'Project', added: [], removed: ['Apollo'] });
  assert.deepEqual(rel(w, apollo.id).at(-1).detail,
    { field: 'Tasks', added: [], removed: ['Ship the editor'], inverse: true });
});

test('a stolen single-value inverse logs the loss on the row it was taken from', () => {
  const { w, projects, tasks } = build();
  const apollo = w.createEntity(projects, { name: 'Apollo' });
  const gemini = w.createEntity(projects, { name: 'Gemini' });
  const task = w.createEntity(tasks, { name: 'Ship the editor' });
  w.link(apollo.id, 'Tasks', task.id);

  w.link(gemini.id, 'Tasks', task.id);

  assert.equal(w.getEntity(task.id).values[w.getField(tasks, 'Project').id], gemini.id);
  assert.deepEqual(rel(w, apollo.id).at(-1).detail,
    { field: 'Tasks', added: [], removed: ['Ship the editor'], inverse: true });
  assert.deepEqual(rel(w, gemini.id).at(-1).detail, { field: 'Tasks', added: ['Ship the editor'], removed: [] });
  assert.deepEqual(rel(w, task.id).at(-1).detail,
    { field: 'Project', added: ['Gemini'], removed: [], inverse: true });
});

test('updateEntity through a relation field mirrors the same way', () => {
  const { w, projects, tasks } = build();
  const apollo = w.createEntity(projects, { name: 'Apollo' });
  const task = w.createEntity(tasks, { name: 'Ship the editor' });

  w.updateEntity(task.id, { Project: apollo.id });

  assert.deepEqual(rel(w, apollo.id).at(-1).detail,
    { field: 'Tasks', added: ['Ship the editor'], removed: [], inverse: true });
});

test('the mirrored entry reaches the workspace feed and reads back by its id', () => {
  const { w, projects, tasks } = build();
  const apollo = w.createEntity(projects, { name: 'Apollo' });
  const task = w.createEntity(tasks, { name: 'Ship the editor' });
  w.link(task.id, 'Project', apollo.id);

  const rows = w.activityFeed({ entityId: apollo.id }).items.filter((r) => r.kind === 'relation-updated');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entityName, 'Apollo');
  assert.equal(rows[0].detail.inverse, true);
  assert.equal(w.getActivity(rows[0].id).detail.field, 'Tasks', 'addressable like any other event');
});

test('a one-way target-set relation logs the near row only — there is no inverse field to name', () => {
  const { w, projects, tasks } = build();
  const tickets = w.createTable({ space: 'Product', name: 'Ticket' });
  w.addRelation(tickets, { name: 'Scope', targetDbs: [tasks, projects], cardinality: 'many-to-many' });
  const task = w.createEntity(tasks, { name: 'Ship the editor' });
  const ticket = w.createEntity(tickets, { name: 'Broken export' });

  w.link(ticket.id, 'Scope', task.id);

  assert.deepEqual(rel(w, ticket.id).at(-1).detail, { field: 'Scope', added: ['Ship the editor'], removed: [] });
  assert.equal(rel(w, task.id).length, 0, 'nothing on the target changed, so nothing is logged');
});

test('undoing a link logs the step back on the far row too', () => {
  const { w, projects, tasks } = build();
  const apollo = w.createEntity(projects, { name: 'Apollo' });
  const task = w.createEntity(tasks, { name: 'Ship the editor' });
  w.link(task.id, 'Project', apollo.id);

  w.undo();

  assert.equal(w.getEntity(task.id).values[w.getField(tasks, 'Project').id], null);
  assert.deepEqual(rel(w, apollo.id).at(-1).detail,
    { field: 'Tasks', added: [], removed: ['Ship the editor'], inverse: true });
});

test('hard-deleting a row logs the unlink on the rows it was linked to', () => {
  const { w, projects, tasks } = build();
  const apollo = w.createEntity(projects, { name: 'Apollo' });
  const task = w.createEntity(tasks, { name: 'Ship the editor' });
  w.link(task.id, 'Project', apollo.id);

  w.deleteEntity(task.id, { hard: true });

  assert.deepEqual(rel(w, apollo.id).at(-1).detail,
    { field: 'Tasks', added: [], removed: ['Ship the editor'], inverse: true });
});
