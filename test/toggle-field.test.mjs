/* The `toggle` field type (Feature #202): a boolean that wears two named
   states. Same storage as checkbox — true/false is what a formula, a filter,
   a CSV cell and the API read — but the config names the states (`on`,
   `off`) and picks which one a new row starts in (`default`), and the chip
   and the card say the label, not the boolean. checkbox ⇄ toggle is a
   lossless migration both ways. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave, FIELD_TYPES, TYPE_MIGRATIONS } from '../src/engine.js';
import { VOCABULARY } from '../src/vocabulary.js';

function ws(config = {}) {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Feed' });
  const f = w.addField(t, { name: 'Active', type: 'toggle', config });
  return { w, t, f };
}

test('toggle is a field type: registered, definable, defaultable, in the vocabulary', () => {
  assert.ok(FIELD_TYPES.includes('toggle'));
  const { w, t, f } = ws();
  assert.equal(f.type, 'toggle');
  assert.deepEqual(f.config, { on: 'On', off: 'Off' }, 'the labels default to On / Off');
  const vocab = VOCABULARY.fieldTypes.find((x) => x.type === 'toggle');
  assert.ok(vocab, 'weave_vocabulary lists it');
  assert.deepEqual(vocab.config, ['on', 'off', 'default']);
  const desc = w.describeSchema().find((x) => x.space === 'Ops').tables.find((x) => x.name === 'Feed').fields.find((x) => x.name === 'Active');
  assert.equal(desc.on, 'On');
  assert.equal(desc.off, 'Off');
});

test('a new row starts off unless the default says on; null normalises to false', () => {
  const { w, t } = ws();
  const e = w.createEntity(t, { name: 'A' });
  assert.equal(w.readEntity(e.id).fields.Active, false);
  w.updateEntity(e.id, { Active: null });
  assert.equal(w.readEntity(e.id).fields.Active, false, 'a toggle is never empty');

  const on = ws({ default: true });
  const e2 = on.w.createEntity(on.t, { name: 'B' });
  assert.equal(on.w.readEntity(e2.id).fields.Active, true);
  assert.equal(on.f.config.default, true);
});

test('the labels are renameable, and each label is a way to write the value', () => {
  const { w, t, f } = ws({ on: 'Live', off: 'Paused' });
  assert.deepEqual(f.config, { on: 'Live', off: 'Paused' });
  const e = w.createEntity(t, { name: 'A', values: { Active: 'Live' } });
  assert.equal(w.readEntity(e.id).fields.Active, true, 'the on label writes true');
  w.updateEntity(e.id, { Active: 'paused' });
  assert.equal(w.readEntity(e.id).fields.Active, false, 'the off label writes false, case-blind');
  w.updateEntity(e.id, { Active: 'true' });
  assert.equal(w.readEntity(e.id).fields.Active, true);
  assert.throws(() => w.updateEntity(e.id, { Active: 'maybe' }), /Live, Paused/);

  w.updateField(t, 'Active', { config: { on: 'Enabled' } });
  assert.deepEqual(w.getField(t, 'Active').config, { on: 'Enabled', off: 'Paused' }, 'one label at a time');
  assert.throws(() => w.updateField(t, 'Active', { config: { off: 'Enabled' } }), /two different/);
  assert.throws(() => w.addField(t, { name: 'Blank', type: 'toggle', config: { on: '  ' } }), /label/);
});

test('checkbox → toggle → checkbox is lossless, and the default rides along', () => {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  const t = w.createTable({ space: 'Ops', name: 'Task' });
  w.addField(t, { name: 'Done', type: 'checkbox', config: { default: true } });
  const a = w.createEntity(t, { name: 'a', values: { Done: true } });
  const b = w.createEntity(t, { name: 'b', values: { Done: false } });
  assert.ok(TYPE_MIGRATIONS.checkbox.includes('toggle'));
  assert.ok(TYPE_MIGRATIONS.toggle.includes('checkbox'));

  w.updateField(t, 'Done', { type: 'toggle', config: { on: 'Finished', off: 'Open' } });
  let f = w.getField(t, 'Done');
  assert.equal(f.type, 'toggle');
  assert.deepEqual(f.config, { on: 'Finished', off: 'Open', default: true });
  assert.equal(w.readEntity(a.id).fields.Done, true);
  assert.equal(w.readEntity(b.id).fields.Done, false);

  w.updateField(t, 'Done', { type: 'checkbox' });
  f = w.getField(t, 'Done');
  assert.equal(f.type, 'checkbox');
  assert.deepEqual(f.config, { default: true });
  assert.equal(w.readEntity(a.id).fields.Done, true);
  assert.equal(w.readEntity(b.id).fields.Done, false);

  w.updateField(t, 'Done', { type: 'toggle' });
  w.updateField(t, 'Done', { type: 'text' });
  assert.equal(w.readEntity(a.id).fields.Done, 'On', 'to text, a toggle freezes the label the reader saw');
  assert.equal(w.readEntity(b.id).fields.Done, 'Off');
});

test('formulas, filters, CSV and the chip: the value is a boolean, the chip says the label', () => {
  const { w, t } = ws({ on: 'Live', off: 'Paused' });
  w.addField(t, { name: 'Say', type: 'formula', config: { expression: 'if(Active, "yes", "no")' } });
  const a = w.createEntity(t, { name: 'a', values: { Active: true } });
  const b = w.createEntity(t, { name: 'b' });
  assert.equal(w.readEntity(a.id).fields.Say, 'yes');
  assert.equal(w.readEntity(b.id).fields.Say, 'no');

  const live = w.query(t, { where: [['Active', '=', true]] }).items.map((e) => e.name);
  assert.deepEqual(live, ['a']);
  assert.deepEqual(w.query(t, { where: [['Active', '=', false]] }).items.map((e) => e.name), ['b']);
  assert.deepEqual(w.query(t, { where: [['Active', 'is-empty']] }).items, [], 'false is a value, not a hole');

  const csv = w.exportCSV(t);
  assert.match(csv, /\n1,a,,true,yes,/);
  assert.match(csv, /\n2,b,,false,no,/);
  const imported = w.importCSV(t, 'Name,Active\nc,Live\nd,Paused\ne,yes\n');
  assert.equal(imported.created, 3);
  assert.deepEqual(w.query(t, { where: [['Active', '=', true]] }).items.map((e) => e.name).sort(), ['a', 'c', 'e']);

  const chip = w.renderView(a.id, 'chip', { config: { shape: 'chip', link: false, state: true, description: 'none', fields: ['Active'] } });
  assert.deepEqual(chip.fields, [{ label: 'Active', value: 'Live' }]);
  const card = w.renderView(b.id, 'card', { config: { shape: 'card', link: true, state: true, description: 'none', fields: ['Active'] } });
  assert.deepEqual(card.fields, [{ label: 'Active', value: 'Paused' }]);
  assert.equal(w.tableStats(t).columns.find((c) => c.name === 'Active').kind, 'category');
});

test('a table filter can rest on a toggle: its labels are the states', () => {
  const { w, t } = ws({ on: 'Live', off: 'Paused' });
  w.createEntity(t, { name: 'a', values: { Active: true } });
  w.createEntity(t, { name: 'b' });
  w.updateTable(t, { filters: { Active: ['Live'] } });
  assert.deepEqual(w.getTable(t).filters, { Active: ['Live'] });
  assert.throws(() => w.updateTable(t, { filters: { Active: ['Maybe'] } }), /not a state/);
  assert.deepEqual(w.query(t, { where: [['Active', 'in', [true]]] }).items.map((e) => e.name), ['a']);
});
