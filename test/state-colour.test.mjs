import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

await import('../public/field-dialog-core.js');
const FDC = globalThis.weaveFieldDialogCore ?? globalThis.fieldDialogCore;
const CC = globalThis.chipCore;

function ws() {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  return { w, t: w.createTable({ space: 'Ops', name: 'Task' }) };
}

const SEED = () => [
  { name: 'Open', category: 'not-started' },
  { name: 'In progress', category: 'in-progress' },
  { name: 'Review', category: 'in-progress', hue: 'purple' },
  { name: 'Done', category: 'done' },
];

const fieldInSchema = (doc, name) => doc
  .flatMap((sp) => sp.tables).flatMap((db) => db.fields).find((f) => f.name === name);

test('a state keeps the hue it was given; one without a hue keeps no key', () => {
  const { w, t } = ws();
  const f = w.addField(t, { name: 'Status', type: 'workflow', config: { states: SEED() } });
  assert.equal(f.config.states[2].hue, 'purple', 'Review wears the colour it was given');
  assert.equal('hue' in f.config.states[1], false, 'In progress still reads its colour from the category');
  assert.equal(f.config.states[1].category, 'in-progress', 'the category is untouched either way');
});

test('a hex colour on a state resolves to a hue name, the way an option does', () => {
  const { w, t } = ws();
  const f = w.addField(t, {
    name: 'Status',
    type: 'workflow',
    config: { states: [{ name: 'Review', category: 'in-progress', color: CC.HUE_HEX.teal }] },
  });
  assert.equal(f.config.states[0].hue, 'teal');
});

test('an empty hue means the category, not slate', () => {
  const { w, t } = ws();
  const f = w.addField(t, {
    name: 'Status',
    type: 'workflow',
    config: { states: [{ name: 'Review', category: 'done', hue: '' }] },
  });
  assert.equal('hue' in f.config.states[0], false, 'clearing the override restores the category colour');
});

test('the hue survives describeSchema and applySchema (the Issue #59 guard)', () => {
  const { w, t } = ws();
  w.addField(t, { name: 'Status', type: 'workflow', config: { states: SEED() } });
  const doc = w.describeSchema();
  const described = fieldInSchema(doc, 'Status');
  assert.equal(described.states[2].hue, 'purple', 'the schema document carries the hue');
  assert.equal('hue' in described.states[1], false, 'and leaves an inherited colour out');
  w.applySchema(doc);
  const states = Object.values(w.getTable(t.id).fields).find((f) => f.name === 'Status').config.states;
  assert.equal(states[2].hue, 'purple', 'a schema round trip keeps it');
});

test('the hue survives a field rename and a states update', () => {
  const { w, t } = ws();
  const f = w.addField(t, { name: 'Status', type: 'workflow', config: { states: SEED() } });
  w.updateField(t, f.id, { name: 'Stage' });
  assert.equal(w.getField(t, f.id).config.states[2].hue, 'purple', 'renaming the column keeps the colours');
  const renamed = w.getField(t, f.id).config.states
    .map((s) => ({ ...s, name: s.name === 'Review' ? 'Checking' : s.name }));
  w.updateField(t, f.id, { config: { states: renamed } });
  const after = w.getField(t, f.id).config.states;
  assert.equal(after.find((s) => s.name === 'Checking').hue, 'purple', 'renaming a state keeps its colour');
});

test('the state chip reads the state colour and falls back to the category', () => {
  assert.equal(CC.stateHue({ category: 'in-progress' }, 'in-progress'), CC.categoryHue('in-progress'));
  assert.equal(CC.stateHue({ category: 'in-progress', hue: 'purple' }, 'in-progress'), 'purple');
  assert.equal(CC.stateHue({ category: 'done', hue: '' }, 'done'), CC.categoryHue('done'));
  assert.equal(CC.stateHue({ category: 'done', hue: 'not-a-hue' }, 'done'), CC.categoryHue('done'),
    'a hue nobody recognises is the category colour, never a broken class');
  assert.notEqual(CC.stateHue({ category: 'in-progress', hue: 'purple' }, 'in-progress'),
    CC.stateHue({ category: 'in-progress' }, 'in-progress'),
    'two states in one category can be told apart');
});

test('the field tray carries a state colour both ways', () => {
  const state = FDC.stateFromDefinition({ type: 'workflow', config: { states: SEED() } });
  assert.equal(state.states[2].hue, 'purple', 'the tray loads the colour');
  const def = FDC.definitionFromState({ ...state, name: 'Status' });
  assert.equal(def.config.states[2].hue, 'purple', 'and sends it back');
  assert.equal('hue' in def.config.states[1], false, 'an inherited colour is still not a stored one');
  const { w, t } = ws();
  const f = w.addField(t, { name: 'Status', ...def });
  assert.equal(f.config.states[2].hue, 'purple');
});
