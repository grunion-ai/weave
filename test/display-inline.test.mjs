import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
await import('../public/field-dialog-core.js');

for (const type of ['document', 'attachments']) test(`${type} inline display survives schema, export and templates without changing field identity`, () => {
  const w = new Weave();
  w.createSpace({ name: 'Example' });
  const table = w.createTable({ space: 'Example', name: 'Task' });
  const field = w.addField(table, { name: 'Content', type, config: { displayInline: true, ...(type === 'document' ? { kind: 'html' } : {}) } });
  const descriptor = () => w.describeSchema().flatMap(s => s.tables).find(t => t.id === table.id).fields.find(f => f.id === field.id);
  assert.equal(descriptor().displayInline, true);
  for (const restore of [t => t.importJSON(w.exportJSON({ fileBlobs: true })), t => t.applySchema(w.describeSchema()), t => w.useTemplate('Example', t)]) {
    const target = new Weave();
    restore(target);
    assert.equal(Object.values(target.getTable('Task').fields).find(f => f.name === 'Content').config.displayInline, true);
  }
  w.updateField(table.id, field.id, { config: { displayInline: false } });
  assert.equal(descriptor().displayInline, undefined);
  assert.equal(descriptor().id, field.id);
  if (type === 'document') assert.equal(descriptor().kind, 'html');
  assert.throws(() => w.updateField(table.id, field.id, { config: { displayInline: 'yes' } }), /boolean/);
});

for (const type of ['document', 'attachments']) test(`${type} inline display round-trips through the field dialog and can be disabled`, () => {
  const core = globalThis.fieldDialogCore;
  const field = { id: 'example', name: 'Content', type, displayInline: true };
  const definition = core.definitionFromFieldView(field);
  const state = core.stateFromDefinition(definition);
  assert.equal(state.displayInline, true);
  assert.equal(core.definitionFromState(state).config.displayInline, true);
  state.displayInline = false;
  assert.equal(core.editPatchConfig(field, core.definitionFromState(state), state).displayInline, false);
});
