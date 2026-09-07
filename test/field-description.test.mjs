/* Every field carries its own description (Issue #209, Kyle, 2026-09-07:
   "each field needs its own description that is prominently visible to the
   agent giving full context of what the field represents and how it is
   formatted"). It is config on every field type — like width, it rides its
   own lane so no other edit clobbers it — and the schema emits it as the
   field's `description`, which is where an agent reads it.

   The one exception is the pair of view fields: on Chip and Card the
   `description` key has meant the description SIZE since Feature #175, and
   that contract holds. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { VOCABULARY } from '../src/vocabulary.js';
import { TOOLS } from '../src/mcp.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOTE = 'Who we bought from — the legal name on the invoice';

function fresh() {
  const w = new Weave();
  w.createSpace({ name: 'Ops' });
  const orders = w.createTable({ space: 'Ops', name: 'Order' });
  w.addField(orders, { name: 'Vendor', type: 'text' });
  w.addField(orders, { name: 'Stage', type: 'select', config: { options: ['Draft', 'Sent'] } });
  return { w, orders };
}
const fieldOf = (w, name) => w.describeSchema().find((sp) => !sp.system).tables.find((t) => t.name === 'Order').fields.find((f) => f.name === name);

test('a field takes a description on create and on update, and the schema emits it', () => {
  const { w, orders } = fresh();
  assert.equal(fieldOf(w, 'Vendor').description, undefined, 'none until one is written');
  w.updateField(orders, 'Vendor', { config: { description: `  ${NOTE}  ` } });
  assert.equal(fieldOf(w, 'Vendor').description, NOTE, 'trimmed');
  w.addField(orders, { name: 'Due', type: 'date', config: { description: 'When the invoice falls due; ISO date' } });
  assert.equal(fieldOf(w, 'Due').description, 'When the invoice falls due; ISO date', 'a create carries it, so standing a column up is one call');
});

test('the description rides its own lane: no other edit clobbers it, and null clears it', () => {
  const { w, orders } = fresh();
  w.updateField(orders, 'Stage', { config: { description: 'Where the order is in its life' } });
  w.updateField(orders, 'Stage', { config: { options: ['Draft', 'Sent', 'Paid'] } });
  assert.equal(fieldOf(w, 'Stage').description, 'Where the order is in its life', 'an options edit keeps it');
  assert.deepEqual(fieldOf(w, 'Stage').options, ['Draft', 'Sent', 'Paid']);
  w.updateField(orders, 'Stage', { config: { width: 140 } });
  assert.equal(fieldOf(w, 'Stage').description, 'Where the order is in its life', 'a resize keeps it');
  w.updateField(orders, 'Stage', { config: { description: null } });
  assert.equal(fieldOf(w, 'Stage').description, undefined, 'null clears it');
  w.updateField(orders, 'Stage', { config: { description: NOTE } });
  w.updateField(orders, 'Stage', { config: { description: '   ' } });
  assert.equal(fieldOf(w, 'Stage').description, undefined, 'blank clears it too');
  assert.throws(() => w.updateField(orders, 'Stage', { config: { description: 42 } }), /plain text/, 'anything but a string is refused');
  assert.throws(() => w.addField(orders, { name: 'Bad', type: 'text', config: { description: ['x'] } }), /plain text/);
});

test('a type migration keeps the description', () => {
  const { w, orders } = fresh();
  w.updateField(orders, 'Vendor', { config: { description: NOTE } });
  w.updateField(orders, 'Vendor', { type: 'select', config: { options: ['Nordic'] } });
  assert.equal(fieldOf(w, 'Vendor').type, 'select');
  assert.equal(fieldOf(w, 'Vendor').description, NOTE, 'what the column means survives its shape');
});

test('a view field keeps its own meaning of description — the size', () => {
  const { w, orders } = fresh();
  const chip = fieldOf(w, 'Chip');
  assert.ok(chip && chip.type === 'view');
  assert.ok(['none', 'small', 'medium', 'large'].includes(chip.description), 'a view emits a size, as before');
  w.updateField(orders, 'Chip', { config: { description: 'small' } });
  assert.equal(fieldOf(w, 'Chip').description, 'small', 'the view lane still takes the size');
  assert.throws(() => w.updateField(orders, 'Chip', { config: { description: NOTE } }), /description/, 'a note is not a size');
});

test('the description round-trips through a schema document and a JSON export', () => {
  const { w, orders } = fresh();
  w.updateField(orders, 'Vendor', { config: { description: NOTE } });
  const doc = w.describeSchema();
  assert.deepEqual(w.applySchema(doc, { dryRun: true }), [], 'an untouched document is a no-op');
  const copy = new Weave();
  copy.applySchema(doc.filter((s) => !s.system));
  assert.equal(fieldOf(copy, 'Vendor').description, NOTE, 'a fresh workspace takes the note from the document');
  const edited = JSON.parse(JSON.stringify(doc));
  edited.find((s) => !s.system).tables[0].fields.find((f) => f.name === 'Vendor').description = 'Supplier';
  w.applySchema(edited);
  assert.equal(fieldOf(w, 'Vendor').description, 'Supplier', 'an edited document writes it back');
  const again = new Weave();
  again.importJSON(w.exportJSON());
  assert.equal(fieldOf(again, 'Vendor').description, 'Supplier', 'and the export carries it');
});

test('a Fields registry row edit does not drop the description', () => {
  const { w, orders } = fresh();
  w.updateField(orders, 'Stage', { config: { description: NOTE } });
  const row = w.listEntities(w.getTable('Fields').id).find((e) => w.entityName(e) === 'Stage');
  w.updateEntity(row.id, { Definition: { type: 'select', config: { options: ['Draft', 'Sent', 'Paid'] } } });
  assert.deepEqual(fieldOf(w, 'Stage').options, ['Draft', 'Sent', 'Paid'], 'the Definition edit landed');
  assert.equal(fieldOf(w, 'Stage').description, NOTE, 'and the note, absent from the Definition, is kept');
});

test('the agent surface names it: vocabulary, MCP tool descriptions, CLI usage, AGENTS.md, Handbook', async () => {
  assert.equal(VOCABULARY.fieldDescription.key, 'description');
  assert.match(VOCABULARY.fieldDescription.note, /view/, 'the vocabulary says the views are the exception');
  for (const name of ['weave_add_field', 'weave_update_field']) {
    assert.match(TOOLS.find((t) => t.name === name).description, /description/, `${name} says the key exists`);
  }
  const cli = readFileSync(join(ROOT, 'bin/weave.js'), 'utf8');
  assert.match(cli, /field add <table> <name> <type> \[--config '\{json\}'\] \[--description/, 'the CLI usage names the flag on add');
  assert.match(cli, /--description "what it holds"\|null/, 'and on update, with null to clear');
  assert.match(readFileSync(join(ROOT, 'AGENTS.md'), 'utf8'), /Every field can say what it means/, 'AGENTS.md tells an agent to read and write it');
  const { GUIDES } = await import('../src/handbook.js');
  assert.match(GUIDES.find((g) => g.name === 'Making a workspace your own').doc, /## What a field means/, 'the customization guide has the section');
});
