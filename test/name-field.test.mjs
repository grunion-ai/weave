/* Feature #168 — the Name field is configurable: rename it, make it a formula
   (a computed name), never delete it. Kyle, 2026-09-02: "why can't the name
   field be renamed or retyped? doesn't make sense". The role (`nameFieldId`)
   already existed; these tests pin that every consumer now reads the role, so
   the literal 'Name' is an alias rather than a load-bearing string. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';

function deals() {
  const w = new Weave();
  w.createSpace({ name: 'Sales' });
  const db = w.createTable({ space: 'Sales', name: 'Deal' });
  w.addField(db.id, { name: 'Company', type: 'text' });
  w.addField(db.id, { name: 'Amount', type: 'number' });
  const nameField = db.fields[db.nameFieldId];
  return { w, db, nameField };
}

test('the Name field can be renamed; the role, the alias and the row identity all hold', () => {
  const { w, db, nameField } = deals();
  const e = w.createEntity(db.id, { name: 'Acme renewal' });
  w.updateField(db.id, nameField.id, { name: 'Title' });
  assert.equal(w.getTable(db.id).fields[nameField.id].name, 'Title');
  assert.equal(w.entityName(w.state.entities[e.id]), 'Acme renewal', 'identity is the role, not the label');
  assert.equal(w.readEntity(e.id).name, 'Acme renewal');
  // 'Name' stays an alias for the name-role field, so every existing caller —
  // MCP weave_create_entity {name}, CSV import, `values: { Name }` — keeps working.
  w.updateEntity(e.id, { Name: 'Acme renewal 2027' });
  assert.equal(w.readEntity(e.id).name, 'Acme renewal 2027');
  const made = w.createEntity(db.id, { name: 'Globex' });
  assert.equal(w.readEntity(made.id).name, 'Globex', 'createEntity({name}) lands on the renamed field');
  assert.equal(w.findField(db, 'Name').id, nameField.id, 'findField resolves the alias');
  assert.equal(w.findField(db, 'Title').id, nameField.id);
  const doc = w.describeSchema().find((s) => s.space === 'Sales').tables[0];
  const described = doc.fields.find((f) => f.id === nameField.id);
  assert.equal(described.name, 'Title');
  assert.equal(described.role, 'name', 'the schema marks the role, as it does for description');
  assert.throws(() => w.deleteField(db.id, nameField.id), /Cannot delete the Name field/, 'delete stays blocked');
});

test('a renamed Name field survives the declarative door into a fresh workspace', () => {
  const { w, db, nameField } = deals();
  w.updateField(db.id, nameField.id, { name: 'Title', config: { term: { singular: 'deal' } } });
  const doc = w.describeSchema().filter((s) => !s.system);
  assert.deepEqual(w.applySchema(doc, { dryRun: true }), [], 'no-op against itself');
  const fresh = new Weave();
  fresh.applySchema(doc);
  const t = fresh.getTable('Sales/Deal');
  assert.equal(t.fields[t.nameFieldId].name, 'Title', 'the minted Name field was renamed, not duplicated');
  assert.equal(Object.values(t.fields).filter((f) => f.name === 'Title' || f.name === 'Name').length, 1);
  assert.equal(fresh.termOf(t).singular, 'deal', 'and the term rode along');
  // Applying a rename onto an existing workspace is an update, not a create.
  const again = new Weave();
  again.applySchema(w.describeSchema().filter((s) => !s.system).map((s) => ({ ...s, tables: s.tables.map((tb) => ({ ...tb, fields: tb.fields.map((f) => (f.role === 'name' ? { ...f, name: 'Name' } : f)) })) })));
  const plan = again.applySchema(doc);
  assert.ok(plan.some((p) => p.action === 'update-field' && /Title|Name/.test(p.subject)), JSON.stringify(plan));
  const t2 = again.getTable('Sales/Deal');
  assert.equal(t2.fields[t2.nameFieldId].name, 'Title');
});

test('the Name field can become a formula: the name is computed, the term survives, writes are tolerated', () => {
  const { w, db, nameField } = deals();
  w.updateField(db.id, nameField.id, { config: { term: { singular: 'deal' } } });
  const e = w.createEntity(db.id, { name: 'ignored soon', values: { Company: 'Acme', Amount: 1200 } });
  w.updateField(db.id, nameField.id, { type: 'formula', config: { expression: 'Company + " · " + Amount' } });
  const f = w.getTable(db.id).fields[nameField.id];
  assert.equal(f.type, 'formula');
  assert.equal(f.config.expression, 'Company + " · " + Amount');
  assert.deepEqual(w.termOf(db.id), { singular: 'deal', plural: 'deals', set: true }, 'the row term survives the migration');
  assert.equal(w.entityName(w.state.entities[e.id]), 'Acme · 1200', 'the identity is computed live');
  assert.equal(w.readEntity(e.id).name, 'Acme · 1200');
  w.updateEntity(e.id, { Company: 'Acme Corp' });
  assert.equal(w.readEntity(e.id).name, 'Acme Corp · 1200', 'follows its inputs');
  // Creating with a name is the shape every caller reaches for; a computed
  // name ignores it instead of failing the create.
  const made = w.createEntity(db.id, { name: 'typed by a human', values: { Company: 'Globex', Amount: 5 } });
  assert.equal(w.readEntity(made.id).name, 'Globex · 5');
  const inline = w.createEntity(db.id, { name: '' });
  assert.ok(w.readEntity(inline.id), 'the grid\'s inline add (name: "") still creates a row');
  assert.throws(() => w.updateEntity(e.id, { Name: 'nope' }), /computed/, 'a direct write to a computed name is refused');
  const doc = w.describeSchema().find((s) => s.space === 'Sales').tables[0];
  const described = doc.fields.find((f) => f.role === 'name');
  assert.equal(described.type, 'formula');
  assert.equal(described.expression, 'Company + " · " + Amount');
});

test('a computed name is what search finds, and turning it back into text freezes it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-name-'));
  try {
    const w = new Weave({ path: join(dir, 'w.db') });
    w.createSpace({ name: 'Sales' });
    const db = w.createTable({ space: 'Sales', name: 'Deal' });
    w.addField(db.id, { name: 'Company', type: 'text' });
    const nameField = db.fields[db.nameFieldId];
    const e = w.createEntity(db.id, { values: { Company: 'Initech' } });
    w.updateField(db.id, nameField.id, { type: 'formula', config: { expression: 'Company + " pilot"' } });
    const hits = w.search('Initech pilot');
    assert.ok(hits.some((h) => (h.entityId ?? h.id) === e.id), `the computed name is indexed: ${JSON.stringify(hits).slice(0, 200)}`);
    w.updateEntity(e.id, { Company: 'Umbrella' });
    assert.ok(w.search('Umbrella pilot').some((h) => (h.entityId ?? h.id) === e.id), 're-indexed on the row\'s own write');
    // formula -> text: the computed value is frozen into every row, so
    // nothing a reader saw disappears when the computation stops.
    w.updateField(db.id, nameField.id, { type: 'text' });
    assert.equal(w.getTable(db.id).fields[nameField.id].type, 'text');
    assert.equal(w.readEntity(e.id).name, 'Umbrella pilot');
    w.updateEntity(e.id, { Name: 'Umbrella pilot (renamed)' });
    assert.equal(w.readEntity(e.id).name, 'Umbrella pilot (renamed)', 'and it is writable again');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('only text and formula are legal shapes for a name', () => {
  const { w, db, nameField } = deals();
  assert.throws(() => w.updateField(db.id, nameField.id, { type: 'number' }), /name/i);
  assert.throws(() => w.updateField(db.id, nameField.id, { type: 'formula', config: {} }), /expression/i);
  // Any other text field can become a formula too — the door is the same.
  const company = w.getTable(db.id).fields;
  const c = Object.values(company).find((f) => f.name === 'Company');
  w.updateField(db.id, c.id, { type: 'formula', config: { expression: 'Amount * 2' } });
  assert.equal(w.getTable(db.id).fields[c.id].type, 'formula');
});
