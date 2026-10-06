import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave, FIELD_TYPES, DEFINABLE_TYPES } from '../src/engine.js';

function ws() {
  const w = new Weave();
  w.createSpace({ name: 'Product' });
  const fields = w.createTable({ space: 'Product', name: 'Fields' });
  w.addField(fields, { name: 'Definition', type: 'field' });
  return { w, fields };
}

test('`field` is a field type the engine accepts', () => {
  assert.ok(FIELD_TYPES.includes('field'), 'field must be registered like any other primitive');
  const { w, fields } = ws();
  const f = w.getField(fields, 'Definition');
  assert.equal(f.type, 'field');
});

test('the predefined options are engine-supplied, not stored per field', () => {
  const { w, fields } = ws();
  const f = w.getField(fields, 'Definition');
  assert.deepEqual(f.config.types, DEFINABLE_TYPES,
    'a UI must be able to render the picker without hard-coding a type list');
  assert.ok(!DEFINABLE_TYPES.includes('lookup'), 'computed types need a resolved target table');
  assert.ok(!DEFINABLE_TYPES.includes('relation'), 'relations need a resolved target table');
});

test('a value is a whole field definition, read back intact', () => {
  const { w, fields } = ws();
  const e = w.createEntity(fields, { name: 'Priority', values: {
    Definition: { type: 'select', config: { options: ['P0', 'P1'] } },
  } });
  const got = w.readEntity(e.id).raw.Definition;
  assert.equal(got.type, 'select');
  assert.deepEqual(got.config.options.map((o) => o.name), ['P0', 'P1']);
});

test('a definition is normalised by the SAME rules as a real field', () => {
  const { w, fields } = ws();
  const e = w.createEntity(fields, { name: 'Priority', values: {
    Definition: { type: 'select', config: { options: ['P0', 'P1'] } },
  } });
  const defined = w.readEntity(e.id).raw.Definition.config.options;

  const real = w.createTable({ space: 'Product', name: 'Task' });
  w.addField(real, { name: 'Priority', type: 'select', config: { options: ['P0', 'P1'] } });
  const actual = w.getField(real, 'Priority').config.options;

  assert.deepEqual(defined, actual,
    'a definition that normalises differently from a real field can describe an uncreatable field');
});

test('an unknown type in a definition is rejected', () => {
  const { w, fields } = ws();
  assert.throws(
    () => w.createEntity(fields, { name: 'Bad', values: { Definition: { type: 'nonsense', config: {} } } }),
    /not a definable field type/i);
});

test('types needing a resolved target table are rejected with a clear reason', () => {
  const { w, fields } = ws();
  for (const type of ['relation', 'lookup', 'rollup', 'formula']) {
    assert.throws(
      () => w.createEntity(fields, { name: type, values: { Definition: { type, config: {} } } }),
      /not a definable field type/i, `${type} must be refused, not silently stored`);
  }
});

test('an invalid config fails at definition time, not at materialisation time', () => {
  const { w, fields } = ws();
  assert.throws(
    () => w.createEntity(fields, { name: 'Bad', values: { Definition: { type: 'workflow', config: { states: [] } } } }),
    /at least one state/i, 'the same error addField raises for the same config');
});

test('recursion is bounded, and the bound is the down-hierarchy depth', () => {
  const { w, fields } = ws();
  assert.throws(
    () => w.createEntity(fields, { name: 'Nested', values: {
      Definition: { type: 'field', config: {} },
    } }),
    /depth/i);

  const deep = w.createTable({ space: 'Product', name: 'SpaceFields' });
  w.addField(deep, { name: 'Definition', type: 'field', config: { depth: 2 } });
  const e = w.createEntity(deep, { name: 'Nested', values: {
    Definition: { type: 'field', config: { depth: 1 } },
  } });
  assert.equal(w.readEntity(e.id).raw.Definition.type, 'field');

  assert.throws(
    () => w.createEntity(deep, { name: 'TooDeep', values: {
      Definition: { type: 'field', config: { depth: 2 } },
    } }),
    /depth/i);
});

test('a definition reads as a human sentence, not a JSON blob', () => {
  const { w, fields } = ws();
  const e = w.createEntity(fields, { name: 'Priority', values: {
    Definition: { type: 'select', config: { options: ['P0', 'P1', 'P2'] } },
  } });
  assert.equal(w.readEntity(e.id).fields.Definition, 'select · 3 options');

  const n = w.createEntity(fields, { name: 'Estimate', values: { Definition: { type: 'number', config: {} } } });
  assert.equal(w.readEntity(n.id).fields.Definition, 'number');
});

test('an unset definition is null, and clearing one works', () => {
  const { w, fields } = ws();
  const e = w.createEntity(fields, { name: 'Empty' });
  assert.equal(w.readEntity(e.id).raw.Definition, null);
  w.updateEntity(e.id, { Definition: { type: 'number', config: {} } });
  assert.equal(w.readEntity(e.id).raw.Definition.type, 'number');
  w.updateEntity(e.id, { Definition: null });
  assert.equal(w.readEntity(e.id).raw.Definition, null);
});

test('definitions survive an export/import round-trip', () => {
  const { w, fields } = ws();
  w.createEntity(fields, { name: 'Priority', values: {
    Definition: { type: 'select', config: { options: ['P0', 'P1'] } },
  } });
  const w2 = new Weave();
  w2.importJSON(JSON.parse(JSON.stringify(w.exportJSON())));
  const row = w2.listEntities(w2.getTable('Product/Fields').id).find((e) => w2.entityName(e) === 'Priority');
  const back = w2.readEntity(row.id).raw.Definition;
  assert.equal(back.type, 'select');
  assert.deepEqual(back.config.options.map((o) => o.name), ['P0', 'P1']);
});

test('a field cell is not rendered as an editable text box', async () => {
  const { readFileSync } = await import('node:fs');
  const APP = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(APP, /if \(f\.type === 'field'\) \{/,
    'the grid must special-case `field`, or the text fallback claims it');
  const at = APP.indexOf("if (f.type === 'field') {");
  const body = APP.slice(at, APP.indexOf("if (f.type === 'attachments') {", at));
  assert.match(body, /class: 'computed k k-computed'/,
    'a structured value must not look editable in a cell — same treatment as document');
  assert.doesNotMatch(body, /addEventListener\('change'/, 'no free-text patching of a definition');
  assert.match(APP, /field: 'lucide:sliders-horizontal'/, 'the type needs its own computed mark, drawn from the inventory');
});

test('describeSchema exposes the definable types on a field field', () => {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  w.createTable({ space: 'S', name: 'Fields' });
  w.addField('S/Fields', { name: 'Definition', type: 'field' });
  const f = w.describeSchema().find((sp) => !sp.system).tables[0].fields.find((x) => x.name === 'Definition');
  assert.ok(Array.isArray(f.types) && f.types.includes('select'), 'a UI must never hard-code the type list');
  assert.equal(f.depth, 1);
});

test('materializeField turns a definition value into a working column', () => {
  const w = new Weave();
  w.createSpace({ name: 'S' });
  w.createTable({ space: 'S', name: 'Fields' });
  w.createTable({ space: 'S', name: 'Task' });
  w.addField('S/Fields', { name: 'Definition', type: 'field' });
  const row = w.createEntity('S/Fields', {
    name: 'Priority',
    values: { Definition: { type: 'select', config: { options: [{ name: 'P0' }, { name: 'P1' }] } } },
  });
  const def = w.getEntity(row.id).values[Object.values(w.getTable('S/Fields').fields).find((f) => f.name === 'Definition').id];
  const made = w.materializeField('Task', 'Priority', def);
  assert.equal(made.type, 'select');
  const t = w.createEntity('Task', { name: 'T', values: { Priority: 'P1' } });
  assert.equal(w.getEntity(t.id).values[made.id], 'p1');
  assert.throws(() => w.materializeField('Task', 'Empty', null), /definition/i);
});

import { readFileSync as readUi } from 'node:fs';

test('field cells show the engine sentence, and the entity page edits the raw definition', () => {
  const app = readUi(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = app.indexOf("if (f.type === 'field')");
  const branch = app.slice(start, app.indexOf('const input = el(', start));
  assert.ok(branch.includes('item.raw?.[f.name]'), 'the editor reads the raw definition');
  assert.ok(branch.includes('String(val)'), 'the chip prints the engine display sentence');
  assert.ok(branch.includes('if (compact) return chip'));
  assert.ok(branch.includes('f.types'), 'type choices come from the schema payload');
  assert.ok(branch.includes("await api('PATCH'"));
});

test('a costume is part of the sentence, so a clear can name what it takes', () => {
  const { w, fields } = ws();
  const say = (definition) =>
    w.readEntity(w.createEntity(fields, { name: 'F', values: { Definition: definition } }).id).fields.Definition;

  assert.equal(say({ type: 'number', config: { format: 'currency', currency: 'EUR', decimals: 2 } }), 'number · currency EUR');
  assert.equal(say({ type: 'number', config: { unit: 'days' } }), 'number · days');
  assert.equal(say({ type: 'number', config: { format: 'percent' } }), 'number · percent');
  assert.equal(say({ type: 'date', config: { format: 'us' } }), 'date · us');
  assert.equal(say({ type: 'date', config: { format: 'long' } }), 'date', 'long is the default and says nothing');
  assert.equal(say({ type: 'date', config: { time: true } }), 'date · with time');
  assert.equal(say({ type: 'document', config: { kind: 'code' } }), 'document · code');
  const deep = ws();
  deep.w.addField(deep.fields, { name: 'Nested', type: 'field', config: { depth: 2 } });
  const nested = deep.w.createEntity(deep.fields, { name: 'N', values: { Nested: { type: 'field', config: { depth: 1 } } } });
  assert.equal(deep.w.readEntity(nested.id).fields.Nested, 'field · depth 1');
  assert.equal(say({ type: 'checkbox', config: {} }), 'checkbox');
});
