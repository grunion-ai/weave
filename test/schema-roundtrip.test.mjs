/* Issue #59 + #60: the declarative door has to be lossless, and a schema write
   that does nothing has to say so.

   `weave_schema` / `GET /api/schema` is what an agent reads, edits, and applies
   back — the natural way to stand up or amend a whole space. Everything that
   survives describeSchema() must survive applySchema(), or an edit silently
   undoes deliberate configuration. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';

function fixture() {
  const w = new Weave();
  w.createSpace({ name: 'Ops', description: 'how work runs' });
  w.updateSpace('Ops', { icon: 'iconly:work' });
  const t = w.createTable({ space: 'Ops', name: 'Invoice', description: 'one bill' });
  w.updateTable(t.id, { icon: 'iconly:wallet', noun: 'invoice', systemFields: ['Created At'] });
  w.addField(t.id, { name: 'Stage', type: 'select', config: { options: [{ name: 'Draft', color: '#f59f00' }, { name: 'Sent', color: '#2ea043' }], width: 240 } });
  w.addField(t.id, { name: 'Amount', type: 'number', config: { format: 'currency', currency: 'USD', decimals: 2, width: 120 } });
  w.addField(t.id, { name: 'Due', type: 'date', config: { format: 'us', time: true } });
  w.addField(t.id, { name: 'Terms', type: 'document', config: { kind: 'html' } });
  w.addField(t.id, { name: 'Files', type: 'attachments', config: { multiple: false } });
  w.addField(t.id, { name: 'State', type: 'workflow', config: { states: [{ name: 'Open', category: 'in-progress', default: true, icon: 'iconly:timecircle' }, { name: 'Paid', category: 'done' }] } });
  w.updateTable(t.id, { hiddenFields: ['Description'], fieldOrder: ['Name', 'Stage', 'Amount', 'Due', 'State', 'Terms', 'Files', 'Description'] });
  return { w, t };
}

const ops = (w) => w.describeSchema().find((s) => s.space === 'Ops');

test('an untouched schema document applies as a no-op', () => {
  const { w } = fixture();
  const before = JSON.stringify(ops(w));
  assert.deepEqual(w.applySchema(w.describeSchema()), [], 'nothing to do');
  assert.equal(JSON.stringify(ops(w)), before, 'and nothing done');
});

test('editing one option keeps every other choice — colors, width, order, icons', () => {
  const { w } = fixture();
  const before = ops(w);
  const doc = w.describeSchema();
  doc.find((s) => s.space === 'Ops').tables.find((t) => t.name === 'Invoice')
    .fields.find((f) => f.name === 'Stage').options = ['Draft', 'Sent', 'Void'];
  w.applySchema(doc);
  const after = ops(w);
  const stage = after.tables[0].fields.find((f) => f.name === 'Stage');
  assert.deepEqual(stage.options, ['Draft', 'Sent', 'Void'], 'the edit lands');
  assert.equal(stage.optionsFull.find((o) => o.name === 'Draft').color, '#f59f00', 'a surviving option keeps its color');
  assert.equal(stage.optionsFull.find((o) => o.name === 'Void').color, '', 'a new option starts neutral');
  assert.equal(stage.width, 240, 'the column keeps the width someone chose');
  const table = after.tables[0];
  assert.equal(table.icon, before.tables[0].icon, 'the table keeps its icon');
  assert.equal(table.noun, 'invoice', 'and its noun');
  assert.deepEqual(table.hiddenFields, ['Description'], 'and its hidden columns');
  assert.deepEqual(table.fields.map((f) => f.name), before.tables[0].fields.map((f) => f.name), 'and its column order');
});

test('a document carries every costume back onto a field it creates', () => {
  const { w } = fixture();
  const doc = w.describeSchema();
  const fresh = new Weave();
  fresh.applySchema(doc.filter((s) => !s.system));
  const made = ops(fresh).tables.find((t) => t.name === 'Invoice');
  const by = (n) => made.fields.find((f) => f.name === n);
  assert.equal(by('Amount').format, 'currency');
  assert.equal(by('Amount').currency, 'USD');
  assert.equal(by('Amount').decimals, 2);
  assert.equal(by('Amount').width, 120);
  assert.equal(by('Due').format, 'us');
  assert.equal(by('Due').time, true);
  assert.equal(by('Terms').kind, 'html');
  assert.equal(by('Files').multiple, false);
  assert.equal(by('Stage').optionsFull[0].color, '#f59f00');
  assert.equal(by('State').states[0].icon, 'iconly:timecircle');
  assert.equal(made.icon, 'iconly:wallet', 'a created table takes the icon the document names');
  assert.equal(made.noun, 'invoice');
  assert.deepEqual(made.hiddenFields, ['Description']);
  assert.equal(ops(fresh).icon, 'iconly:work', 'and the space takes its icon too');
});

test('a table-level edit applies without touching the fields', () => {
  const { w, t } = fixture();
  const doc = w.describeSchema();
  const table = doc.find((s) => s.space === 'Ops').tables.find((x) => x.name === 'Invoice');
  table.icon = 'iconly:paper';
  table.noun = 'bill';
  table.hiddenFields = [];
  const plan = w.applySchema(doc);
  assert.ok(plan.some((p) => p.action === 'update-table'), `the plan names the table change: ${JSON.stringify(plan)}`);
  const after = ops(w).tables[0];
  assert.equal(after.icon, 'iconly:paper');
  assert.equal(after.noun, 'bill');
  assert.equal(after.hiddenFields, undefined);
  assert.equal(w.getTable(t.id).fields[w.getTable(t.id).nameFieldId].name, 'Name', 'fields are untouched');
});

/* Issue #60 */
test('a Definition written without a config key is refused, not silently dropped', () => {
  const { w, t } = fixture();
  const fields = w.listTables().find((d) => d.system === 'fields');
  const row = w.query(fields.id, {}).items.find((i) => i.fields.Name === 'Stage');
  // The shape describeSchema hands back is flat — accepting it silently as an
  // empty config discarded the caller's intent and returned success.
  assert.throws(() => w.updateEntity(row.id, { Definition: { type: 'select', options: ['A'] } }),
    /config/i, 'a definition with no config must say so');
  const stage = Object.values(w.getTable(t.id).fields).find((f) => f.name === 'Stage');
  assert.equal(stage.config.options.length, 2, 'and must change nothing');
});

test('workspace name and description are engine verbs, not server-only', () => {
  const w = new Weave();
  assert.equal(typeof w.updateWorkspace, 'function', 'the engine owns the workspace record');
  const got = w.updateWorkspace({ name: 'ops-hub', description: 'the hub' });
  assert.equal(got.name, 'ops-hub');
  assert.equal(w.getWorkspace().description, 'the hub');
  assert.throws(() => w.updateWorkspace({ name: 'not a name' }), /alphanumeric/i);
});

/* ---------- the description survives the round trip (Kyle, 2026-08-27) ----
   Losing it was the same bug twice. The create path skipped any descriptor
   literally named 'Description' on the assumption createTable had already made
   one, so a table whose description had been RENAMED to 'Notes' came back as
   Name + Notes + a spurious second Description, and a table whose description
   had been DELETED came back with one anyway. A descriptor now carries
   `role: 'description'` and applying it renames the minted field. */

function described() {
  const w = new Weave();
  w.createSpace({ name: 'Product' });
  const tasks = w.createTable({ space: 'Product', name: 'Task' });
  w.addField(tasks, { name: 'Estimate', type: 'number' });
  return { w, tasks };
}
const names = (w, qualified) => {
  const db = w.getTable(qualified);
  return db.fieldOrder.map((id) => db.fields[id].name);
};

test('a renamed description round-trips without duplicating', () => {
  const { w, tasks } = described();
  w.updateField(tasks, 'Description', { name: 'Notes' });

  const fresh = new Weave();
  fresh.applySchema(w.describeSchema().filter((s) => !s.system));
  assert.deepEqual(names(fresh, 'Product/Task'), ['Name', 'Notes', 'Estimate']);
  assert.equal(fresh.descriptionField(fresh.getTable('Product/Task')).name, 'Notes');
});

test('a schema document says which field is the description', () => {
  const { w } = described();
  for (const sp of w.describeSchema()) {
    for (const db of sp.tables) {
      const roles = db.fields.filter((f) => f.role === 'description');
      assert.equal(roles.length, db.system ? 0 : 1, `${db.qualified} claims ${roles.length} descriptions`);
      if (!db.system) assert.equal(roles[0].type, 'document');
    }
  }
});

test('applying a schema with no description leaves none', () => {
  const { w, tasks } = described();
  w.deleteField(tasks, 'Description');

  const fresh = new Weave();
  fresh.applySchema(w.describeSchema().filter((s) => !s.system));
  assert.deepEqual(names(fresh, 'Product/Task'), ['Name', 'Estimate']);
  assert.equal(fresh.getTable('Product/Task').descriptionFieldId, null,
    'absence is expressible, not always re-minted');
});

test('a schema written before roles is still understood', () => {
  const { w } = described();
  const doc = w.describeSchema().filter((s) => !s.system);
  for (const sp of doc) for (const db of sp.tables) for (const f of db.fields) delete f.role;

  const fresh = new Weave();
  fresh.applySchema(doc);
  assert.deepEqual(names(fresh, 'Product/Task'), ['Name', 'Description', 'Estimate'], 'adopted, not duplicated');
  assert.equal(fresh.descriptionField(fresh.getTable('Product/Task')).name, 'Description');
});
