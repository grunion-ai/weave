/* A choice field's Default is picked from its own options (Issue #422).

   Select and multi-select fell through to the generic Default text box, so a
   typo wrote a default that matched no option; a workflow had no Default at
   all, only the note "the first state is the default". Kyle, 2026-09-26:
   "Default config should be a drop down selection of available options".

   The default now rides the option or state it names, as a `default` flag on
   that entry in the dialog state. A rename carries it and a removal takes it,
   with no bookkeeping; the definition turns the flag back into the stored
   shape (an option name for select, names for multi-select, the state's own
   `default: true` for a workflow). The browser half is
   choice-default-browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
await import('../public/date-grain.js');
await import('../public/field-dialog-core.js');
const core = globalThis.fieldDialogCore;
const APP = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

const sel = (options, dflt) => core.stateFromDefinition({ type: 'select', config: { options, ...(dflt !== undefined ? { default: dflt } : {}) } });

test('a stored select default marks its option, by id or by name', () => {
  const byId = sel([{ id: 's', name: 'S' }, { id: 'm', name: 'M' }], 'm');
  assert.deepEqual(core.choiceItems(byId, 'select').map((x) => x.default), [false, true]);
  const byName = sel(['S', 'M'], 'M');
  assert.deepEqual(core.choiceItems(byName, 'select').map((x) => x.default), [false, true]);
  assert.equal(core.definitionFromState(byId).config.default, 'M', 'the definition names the option');
});

test('no default is no config.default at all', () => {
  const st = sel(['S', 'M']);
  assert.equal('default' in core.definitionFromState(st).config, false);
  core.setChoiceDefault(st, 'select', ['1']);
  core.setChoiceDefault(st, 'select', []);
  assert.equal('default' in core.definitionFromState(st).config, false, 'picking No default clears it');
});

test('a rename carries the default and a removal takes it', () => {
  const st = sel([{ id: 's', name: 'S' }, { id: 'm', name: 'M' }], 'm');
  st.options[1].name = 'Medium';
  assert.equal(core.definitionFromState(st).config.default, 'Medium');
  st.options.splice(1, 1);
  assert.equal(core.definitionFromState(st).config.default, undefined);
  assert.deepEqual(core.definitionFromState(st).config.options, [{ id: 's', name: 'S', color: '' }], 'the flag never leaks into the options');
});

test('a single select keeps one default; a multi-select keeps several', () => {
  const st = sel(['A', 'B', 'C']);
  core.setChoiceDefault(st, 'select', ['0', '2']);
  assert.equal(core.definitionFromState(st).config.default, 'A');
  const ms = core.stateFromDefinition({ type: 'multiselect', config: { options: ['A', 'B', 'C'], default: ['a', 'C'] } });
  assert.deepEqual(core.choiceItems(ms, 'multiselect').map((x) => x.default), [true, false, true]);
  core.setChoiceDefault(ms, 'multiselect', ['1', '2']);
  assert.deepEqual(core.definitionFromState(ms).config.default, ['B', 'C']);
});

test('a workflow default is the state flag, round-tripped, and at most one', () => {
  const wf = core.stateFromDefinition({ type: 'workflow', config: { states: [{ id: 'a', name: 'A', category: 'not-started' }, { id: 'b', name: 'B', category: 'done', default: true }] } });
  assert.deepEqual(core.choiceItems(wf, 'workflow').map((x) => x.default), [false, true]);
  assert.deepEqual(core.definitionFromState(wf).config.states.map((s) => !!s.default), [false, true]);
  core.setChoiceDefault(wf, 'workflow', ['0']);
  assert.deepEqual(core.definitionFromState(wf).config.states.map((s) => !!s.default), [true, false]);
  core.setChoiceDefault(wf, 'workflow', []);
  assert.equal(core.definitionFromState(wf).config.states.some((s) => s.default), false);
  assert.equal(core.blankState('workflow').states.some((s) => s.default), false, 'a new workflow starts with no default');
});

test('the edit patch sends the default after the options it names, and null to clear', () => {
  const st = sel([{ id: 'm', name: 'M' }], 'm');
  st.options[0].name = 'Medium';
  const patch = core.editPatchConfig({ type: 'select' }, core.definitionFromState(st), st);
  assert.deepEqual(patch.options, [{ id: 'm', name: 'Medium', color: '' }]);
  assert.equal(patch.default, 'Medium');
  core.setChoiceDefault(st, 'select', []);
  assert.equal(core.editPatchConfig({ type: 'select' }, core.definitionFromState(st), st).default, null);
});

test('a type change carries the default across options and states', () => {
  const st = sel(['Low', 'High'], 'High');
  const wf = core.migrateState(st, 'workflow');
  assert.deepEqual(wf.states.map((s) => !!s.default), [false, true]);
  assert.deepEqual(core.migrateState(wf, 'select').options.map((o) => !!o.default), [false, true]);
});

test('the dialog draws the picker for choice fields, never the free-text box', () => {
  const draw = APP.slice(APP.indexOf('function drawCfg()'), APP.indexOf("tray(isEdit ? `Edit ${existing.name}`"));
  assert.match(draw, /choiceDefaultControl\(state, t\)/, 'select, multi-select and workflow get the picker');
  assert.match(APP, /label: 'No default'/, 'No default is a choice in the list');
  assert.doesNotMatch(APP, /the first state is the default/, 'the implicit-first-state note is gone');
});
