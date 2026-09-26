/* A new row's choice is empty unless its field names a default (Issue #421).

   The engine marked the first state `default` on every workflow field that
   marked none — in addField, in the normaliser every states edit goes
   through, and in the seeded four — and type conversion fell back to that
   state for an empty value. So a new row always carried a status, and
   "nobody chose" read the same as "chose the first one". Kyle, 2026-09-26:
   "select fields that don't have a blank or default value should not create
   a value: null (empty) unless otherwise specified".

   Existing workspaces: the engine always STORED the flag it implied, so a
   workflow field made before this change carries `default: true` on its
   first state and keeps starting rows there. Nothing is rewritten; the field
   dialog's Default picker (Issue #422) is how a person clears it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

function ws() {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Task' });
  return { w, t };
}
const read = (w, e) => w.readEntity(e.id).fields;

test('a workflow whose states mark no default starts a row empty', () => {
  const { w, t } = ws();
  const f = w.addField(t, { name: 'Stage', type: 'workflow', config: { states: [{ name: 'A', category: 'not-started' }, { name: 'B', category: 'done' }] } });
  assert.deepEqual(f.config.states.map((s) => s.default), [false, false], 'nothing is marked for the author');
  assert.equal(read(w, w.createEntity(t, { name: 'x' })).Stage, null);
});

test('the seeded four carry no default either', () => {
  const { w, t } = ws();
  const f = w.addField(t, { name: 'Status', type: 'workflow' });
  assert.equal(f.config.states.some((s) => s.default), false);
  assert.equal(read(w, w.createEntity(t, { name: 'x' })).Status, null);
});

test('a state marked default is where a row starts, and a named value wins', () => {
  const { w, t } = ws();
  w.addField(t, { name: 'Stage', type: 'workflow', config: { states: [{ name: 'A', category: 'not-started' }, { name: 'B', category: 'in-progress', default: true }] } });
  assert.equal(read(w, w.createEntity(t, { name: 'x' })).Stage, 'B');
  assert.equal(read(w, w.createEntity(t, { name: 'y', values: { Stage: 'A' } })).Stage, 'A');
  assert.equal(read(w, w.createEntity(t, { name: 'z', values: { Stage: null } })).Stage, null, 'naming it empty is a choice');
});

test('one default at most: the first marked wins', () => {
  const { w, t } = ws();
  const f = w.addField(t, { name: 'Stage', type: 'workflow', config: { states: [{ name: 'A', category: 'not-started', default: true }, { name: 'B', category: 'done', default: true }] } });
  assert.deepEqual(f.config.states.map((s) => s.default), [true, false]);
});

test('an edit that marks no state clears the default; one that marks one sets it', () => {
  const { w, t } = ws();
  const f = w.addField(t, { name: 'Stage', type: 'workflow', config: { states: [{ name: 'A', category: 'not-started', default: true }, { name: 'B', category: 'done' }] } });
  w.updateField(t, f.id, { config: { states: [{ id: 'a', name: 'A', category: 'not-started' }, { id: 'b', name: 'B', category: 'done' }] } });
  assert.equal(read(w, w.createEntity(t, { name: 'x' })).Stage, null);
  w.updateField(t, f.id, { config: { states: [{ id: 'a', name: 'A', category: 'not-started' }, { id: 'b', name: 'B', category: 'done', default: true }] } });
  assert.equal(read(w, w.createEntity(t, { name: 'y' })).Stage, 'B');
});

test('a state can be cleared back to empty, and the activity says so', () => {
  const { w, t } = ws();
  w.addField(t, { name: 'Stage', type: 'workflow', config: { states: [{ name: 'A', category: 'not-started', default: true }, { name: 'B', category: 'done' }] } });
  const e = w.createEntity(t, { name: 'x' });
  w.updateEntity(e.id, { Stage: null });
  assert.equal(read(w, e).Stage, null);
  w.setState(e.id, 'Stage', 'B');
  w.setState(e.id, 'Stage', '');
  assert.equal(read(w, e).Stage, null);
  const last = w.readEntity(e.id).activity.filter((a) => a.kind === 'state-changed').at(-1);
  assert.deepEqual([last.detail.from, last.detail.to], ['B', null]);
});

test('a select or multi-select starts empty unless it names a default', () => {
  const { w, t } = ws();
  w.addField(t, { name: 'Kind', type: 'select', config: { options: ['Bug', 'Chore'] } });
  w.addField(t, { name: 'Tags', type: 'multiselect', config: { options: ['a', 'b'] } });
  w.addField(t, { name: 'Size', type: 'select', config: { options: ['S', 'M'], default: 'M' } });
  const f = read(w, w.createEntity(t, { name: 'x' }));
  assert.equal(f.Kind, null);
  assert.deepEqual(f.Tags ?? [], []);
  assert.equal(f.Size, 'M');
});

test('a select default follows a rename sent with it, and leaves with its option', () => {
  const { w, t } = ws();
  const f = w.addField(t, { name: 'Size', type: 'select', config: { options: ['S', 'M'], default: 'M' } });
  // The dialog sends the options and the default in one save; the default
  // names the option by its new name.
  w.updateField(t, f.id, { config: { options: [{ id: 's', name: 'S' }, { id: 'm', name: 'Medium' }], default: 'Medium' } });
  assert.equal(read(w, w.createEntity(t, { name: 'x' })).Size, 'Medium');
  // An option removed takes the default with it rather than leaving an id nothing names.
  w.updateField(t, f.id, { config: { options: [{ id: 's', name: 'S' }] } });
  assert.equal(w.getField(t, f.id).config.default, undefined);
  assert.equal(read(w, w.createEntity(t, { name: 'y' })).Size, null);
});

test('converting to a workflow keeps empty cells empty and carries a select default across', () => {
  const { w, t } = ws();
  const f = w.addField(t, { name: 'Pri', type: 'select', config: { options: ['Low', 'High'], default: 'High' } });
  const a = w.createEntity(t, { name: 'a', values: { Pri: 'Low' } });
  const b = w.createEntity(t, { name: 'b', values: { Pri: null } });
  w.updateField(t, f.id, { type: 'workflow' });
  const wf = w.getField(t, f.id);
  assert.deepEqual(wf.config.states.map((s) => s.default), [false, true], 'High stays the default');
  assert.equal(read(w, a).Pri, 'Low');
  assert.equal(read(w, b).Pri, null, 'an empty cell does not become the default state');
  // Text with no default in play: an empty cell stays empty.
  const g = w.addField(t, { name: 'Note', type: 'text' });
  const c = w.createEntity(t, { name: 'c' });
  w.updateField(t, g.id, { type: 'select' });
  w.updateField(t, g.id, { type: 'workflow' });
  assert.equal(read(w, c).Note, null);
});

test('a workspace stored before the change keeps the default it stored', () => {
  const { w, t } = ws();
  w.addField(t, { name: 'Stage', type: 'workflow', config: { states: [{ name: 'Open', category: 'not-started', default: true }, { name: 'Done', category: 'done' }] } });
  const copy = new Weave();
  copy.importJSON(w.exportJSON());
  const ct = copy.getTable('Ops/Task');
  assert.equal(copy.readEntity(copy.createEntity(ct.id, { name: 'x' }).id).fields.Stage, 'Open');
});

test('the REST create route leaves an unset choice empty', async () => {
  const { w, t } = ws();
  w.addField(t, { name: 'Status', type: 'workflow' });
  w.addField(t, { name: 'Kind', type: 'select', config: { options: ['Bug'] } });
  const { server } = await startServer(w, { port: 0 });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/tables/${t.id}/entities`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ values: { Name: 'x' } }),
    });
    assert.equal(res.status, 201);
    const row = await res.json();
    assert.equal(row.fields.Status, null);
    assert.equal(row.fields.Kind, null);
  } finally {
    server.close();
  }
});
