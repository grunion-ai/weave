/* The `field` field type — a field whose VALUE is a field definition.

   Requested by Kyle (2026-08-16): "the new field type called field has
   predefined options and its definition also defines the down-hierarchy
   field, in this case we can do pure D and the config becomes the field
   entity page as the control surface."

   The point of the type is that it terminates the meta-model's recursion.
   A space-level `Fields` table needs fields to describe fields; with this
   type the innermost descriptor is an ordinary engine primitive whose
   options come from FIELD_TYPES — a plain array below the entity layer —
   so nothing is circular.

   The load-bearing invariant is that a `field` VALUE and a real field are
   validated by the SAME normalizer. If they can drift, a definition can
   describe a field the engine would refuse to create, and the down-hierarchy
   materialisation (next phase) would fail at write time instead of at
   definition time. */
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

  // The same input through addField must produce the same normalised shape.
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
  // Default depth 1: a definition describes a leaf field, so it may not itself
  // be a `field`.
  assert.throws(
    () => w.createEntity(fields, { name: 'Nested', values: {
      Definition: { type: 'field', config: {} },
    } }),
    /depth/i);

  // depth 2 = workspace → space → table: the definition may define a field
  // that itself defines a field.
  const deep = w.createTable({ space: 'Product', name: 'SpaceFields' });
  w.addField(deep, { name: 'Definition', type: 'field', config: { depth: 2 } });
  const e = w.createEntity(deep, { name: 'Nested', values: {
    Definition: { type: 'field', config: { depth: 1 } },
  } });
  assert.equal(w.readEntity(e.id).raw.Definition.type, 'field');

  // ...but not three levels deep on a depth-2 field.
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

/* ---------- UI contract for the new type ---------- */

test('a field cell is not rendered as an editable text box', async () => {
  const { readFileSync } = await import('node:fs');
  const APP = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(APP, /if \(f\.type === 'field'\) \{/,
    'the grid must special-case `field`, or the text fallback claims it');
  const at = APP.indexOf("if (f.type === 'field') {");
  const body = APP.slice(at, APP.indexOf('// Attachments (Feature #16)', at));
  assert.match(body, /class: 'computed k k-computed'/,
    'a structured value must not look editable in a cell — same treatment as document');
  assert.doesNotMatch(body, /addEventListener\('change'/, 'no free-text patching of a definition');
  assert.match(APP, /field: '⌗'/, 'the type needs its own computed mark');
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

/* Materialisation: a stored definition becomes a real column through the
   same path addField uses — the shared normaliser makes divergence impossible,
   so the verb is thin by design. The binding (how a Fields row names the
   table it lands on) is Feature #52's question, not this one's. */
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

/* ---------- UI half of Feature #85: the entity page is the control surface ---------- */
import { readFileSync as readUi } from 'node:fs';

test('field cells show the engine sentence, and the entity page edits the raw definition', () => {
  const app = readUi(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = app.indexOf("if (f.type === 'field')");
  const branch = app.slice(start, app.indexOf('const input = el(', start));
  // Display is the engine's sentence (item.fields); the editor works on the
  // definition itself (item.raw) — never on the display string.
  assert.ok(branch.includes('item.raw?.[f.name]'), 'the editor reads the raw definition');
  assert.ok(branch.includes('String(val)'), 'the chip prints the engine display sentence');
  // Compact surfaces stay read-only; the entity page opens the editor and its
  // type choices come from config.types, never a hard-coded list.
  assert.ok(branch.includes('if (compact) return chip'));
  assert.ok(branch.includes('f.types'), 'type choices come from the schema payload');
  // Validation failures keep the dialog open: the save path must throw through
  // the modal, not go through patch() which swallows errors into a toast.
  assert.ok(branch.includes("await api('PATCH'"));
});
