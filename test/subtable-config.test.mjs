import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

function workspace() {
  const w = new Weave();
  w.createSpace({ name: 'Work' });
  const project = w.createTable({ space: 'Work', name: 'Project' });
  const task = w.createTable({ space: 'Work', name: 'Task' });
  w.addField(task, {
    name: 'State', type: 'workflow',
    config: { states: [{ name: 'Todo', category: 'not-started', default: true }, { name: 'Doing', category: 'in-progress' }, { name: 'Done', category: 'done' }] },
  });
  w.addField(task, { name: 'Notes', type: 'text' });
  w.addRelation(project, { name: 'Tasks', targetDb: 'Task', cardinality: 'one-to-many', inverseName: 'Project' });
  const tasks = w.getField(project.id, 'Tasks');
  return { w, project, task, tasks };
}

const SUBTABLE = { fields: ['Name', 'State'], filter: [['State', 'in', ['Todo', 'Doing']]], sort: [{ field: 'Name', dir: 'desc' }] };

test('a relation field stores its subtable fields, filter and sort beside target and cardinality', () => {
  const { w, project, tasks } = workspace();
  w.updateField(project.id, tasks.id, { config: { subtable: SUBTABLE } });
  const stored = w.getField(project.id, tasks.id).config;
  assert.deepEqual(stored.subtable, SUBTABLE);
  assert.ok(stored.targetDb, 'the target stays');
  const described = w.describeSchema().find((sp) => sp.space === 'Work').tables.find((t) => t.name === 'Project').fields.find((f) => f.name === 'Tasks');
  assert.deepEqual(described.subtable, SUBTABLE, 'the schema hands the subtable to the client');
});

test('a subtable change records one field-config-updated entry naming subtable', () => {
  const { w, project, tasks } = workspace();
  w.updateField(project.id, tasks.id, { config: { subtable: SUBTABLE } });
  const entries = w.activityFeed({ kinds: ['field-config-updated'] }).items.filter((a) => a.detail?.fieldId === tasks.id);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].detail.changed, ['subtable']);
});

test('null or an empty subtable clears it', () => {
  const { w, project, tasks } = workspace();
  w.updateField(project.id, tasks.id, { config: { subtable: SUBTABLE } });
  w.updateField(project.id, tasks.id, { config: { subtable: null } });
  assert.equal(w.getField(project.id, tasks.id).config.subtable, undefined);
  w.updateField(project.id, tasks.id, { config: { subtable: { fields: null, filter: [], sort: [] } } });
  assert.equal(w.getField(project.id, tasks.id).config.subtable, undefined);
});

test('a filter keeps only the parts it was given', () => {
  const { w, project, tasks } = workspace();
  w.updateField(project.id, tasks.id, { config: { subtable: { filter: [['State', '!=', 'Done']] } } });
  assert.deepEqual(w.getField(project.id, tasks.id).config.subtable, { filter: [['State', '!=', 'Done']] });
});

test('the subtable refuses names the target table does not have', () => {
  const { w, project, tasks } = workspace();
  assert.throws(() => w.updateField(project.id, tasks.id, { config: { subtable: { filter: [['Colour', '=', 'red']] } } }), /Colour/);
  assert.throws(() => w.updateField(project.id, tasks.id, { config: { subtable: { fields: ['Name', 'Colour'] } } }), /Colour/);
  assert.throws(() => w.updateField(project.id, tasks.id, { config: { subtable: { sort: [{ field: 'Colour' }] } } }), /Colour/);
  assert.throws(() => w.updateField(project.id, tasks.id, { config: { subtable: { sort: [{ field: 'Name', dir: 'up' }] } } }), /asc or desc/);
  assert.throws(() => w.updateField(project.id, tasks.id, { config: { subtable: 'open' } }), /subtable/i);
  assert.equal(w.getField(project.id, tasks.id).config.subtable, undefined, 'a refused write stores nothing');
});

test('only a relation field takes a subtable', () => {
  const { w, task } = workspace();
  const notes = w.getField(task.id, 'Notes');
  assert.throws(() => w.updateField(task.id, notes.id, { config: { subtable: SUBTABLE } }), /relation/);
});

test('the entity read still returns the full relation', () => {
  const { w, project, tasks } = workspace();
  const p = w.createEntity(project, { name: 'Apollo' });
  const made = ['a', 'b', 'c'].map((n) => w.createEntity('Task', { name: n }));
  w.setState(made[0].id, 'State', 'Done');
  w.link(p.id, 'Tasks', made.map((t) => t.id));
  w.updateField(project.id, tasks.id, { config: { subtable: { filter: [['State', '!=', 'Done']] } } });
  assert.equal(w.readEntity(p.id).fields.Tasks.length, 3);
});
