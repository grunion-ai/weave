/* Feature #261: any space can be a template, and a template space copies its
   schema, never its rows, into another workspace. This file holds the engine
   half: the `template` attribute and its registry checkbox, templateDoc(),
   useTemplate(), applySchema's `partial` option, listTemplates(), and the
   CLI and MCP doors onto them. The route and hub half is
   use-template-routes.test.mjs; the dialog is use-template-browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Weave, templateDoc } from '../src/engine.js';
import { dispatchTool } from '../src/mcp.js';
import { normalise } from './lib/fixtures.mjs';

const BIN = fileURLToPath(new URL('../bin/weave.js', import.meta.url));
const spacesRow = (w, name) => {
  const t = w.getTable('Workspace/Spaces');
  return w.listEntities(t.id, { includeDeleted: true }).find((e) => w.entityName(e) === name);
};
const templateCell = (w, name) => w.readEntity(spacesRow(w, name).id).fields.Template;

// ---------------- step 1: the attribute ----------------

test('template is a space attribute: stored when true, absent when false', () => {
  const w = new Weave();
  const made = w.createSpace({ name: 'CRM', template: true });
  assert.equal(made.template, true);
  const plain = w.createSpace({ name: 'Ops' });
  assert.equal('template' in plain, false, 'a space nobody marked carries no key');
  w.updateSpace('Ops', { template: true });
  assert.equal(w.getSpace('Ops').template, true);
  w.updateSpace('Ops', { template: false });
  assert.equal('template' in w.getSpace('Ops'), false, 'unmarking removes the key, like icon');
  w.updateSpace('CRM', { description: 'pipeline' });
  assert.equal(w.getSpace('CRM').template, true, 'a patch that does not name it leaves it');
});

test('the Workspace/Spaces row carries a Template checkbox that mirrors the space both ways', () => {
  const w = new Weave();
  w.createSpace({ name: 'CRM' });
  const field = w.findField(w.getTable('Workspace/Spaces'), 'Template');
  assert.ok(field, 'the registry minted the column');
  assert.equal(field.type, 'checkbox');
  assert.equal(field.system, true);
  assert.equal(templateCell(w, 'CRM'), false);
  w.updateSpace('CRM', { template: true });
  assert.equal(templateCell(w, 'CRM'), true, 'the verb writes the row');
  w.updateEntity(spacesRow(w, 'CRM').id, { Template: false });
  assert.equal('template' in w.getSpace('CRM'), false, 'the row writes the space');
  assert.equal(templateCell(w, 'CRM'), false);
  w.updateEntity(spacesRow(w, 'CRM').id, { Template: true });
  assert.equal(w.getSpace('CRM').template, true);
  // A Spaces row created with the box ticked makes a template space.
  w.createEntity(w.getTable('Workspace/Spaces').id, { name: 'Hiring', values: { Template: true } });
  assert.equal(w.getSpace('Hiring').template, true);
  assert.equal(templateCell(w, 'Hiring'), true);
});

test('a workspace opened without the Template column gets it, and its rows say which spaces are templates', () => {
  const w = new Weave();
  w.createSpace({ name: 'CRM', template: true });
  const dump = w.exportJSON();
  // Strip the column the way a workspace made before Feature #261 lacks it.
  const spaces = Object.values(dump.tables).find((t) => t.system === 'spaces');
  const id = Object.values(spaces.fields).find((f) => f.name === 'Template').id;
  delete spaces.fields[id];
  spaces.fieldOrder = spaces.fieldOrder.filter((x) => x !== id);
  for (const v of spaces.tableViews ?? []) v.fields = v.fields.filter((x) => x !== id);
  for (const e of Object.values(dump.entities)) delete e.values?.[id];
  const dir = mkdtempSync(join(tmpdir(), 'weave-template-'));
  try {
    const path = join(dir, 'old.db');
    const old = new Weave({ path });
    old.importJSON(dump);
    old.store.close?.();
    const reopened = new Weave({ path });
    assert.ok(reopened.findField(reopened.getTable('Workspace/Spaces'), 'Template'), 'the column is there after the open');
    assert.equal(templateCell(reopened, 'CRM'), true, 'and the row carries the space\'s value');
    reopened.store.close?.();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('describeSchema says template only when set, and applySchema applies a change through updateSpace', () => {
  const w = new Weave();
  w.createSpace({ name: 'CRM' });
  const crm = () => w.describeSchema().find((s) => s.space === 'CRM');
  assert.equal('template' in crm(), false);
  const doc = w.describeSchema();
  doc.find((s) => s.space === 'CRM').template = true;
  const plan = w.applySchema(doc);
  assert.deepEqual(plan, [{ action: 'update-space', subject: 'CRM' }]);
  assert.equal(crm().template, true);
  assert.equal(templateCell(w, 'CRM'), true, 'through the verb, so the registry row follows');
  assert.deepEqual(w.applySchema(w.describeSchema()), [], 'a round trip is a no-op');
  const off = w.describeSchema();
  off.find((s) => s.space === 'CRM').template = false;
  w.applySchema(off);
  assert.equal('template' in crm(), false);
  // A document that creates a template space makes it one.
  const fresh = new Weave();
  fresh.applySchema([{ space: 'Hiring', template: true, tables: [] }]);
  assert.equal(fresh.getSpace('Hiring').template, true);
});

test('template survives export and import, and the trash', () => {
  const w = new Weave();
  w.createSpace({ name: 'CRM', template: true });
  const copy = new Weave();
  copy.importJSON(w.exportJSON());
  assert.equal(copy.getSpace('CRM').template, true);
  assert.equal(templateCell(copy, 'CRM'), true);
  w.deleteSpace('CRM');
  const id = Object.values(w.state.spaces).find((s) => s.name === 'CRM').id;
  w.restoreSpace(id);
  assert.equal(w.getSpace('CRM').template, true, 'a restored space is still a template');
  assert.equal(templateCell(w, 'CRM'), true);
});

test('weave_update_space and the CLI take template', () => {
  const w = new Weave();
  w.createSpace({ name: 'CRM' });
  dispatchTool(w, 'weave_update_space', { space: 'CRM', template: true });
  assert.equal(w.getSpace('CRM').template, true);
  dispatchTool(w, 'weave_update_space', { space: 'CRM', template: false });
  assert.equal('template' in w.getSpace('CRM'), false);

  const dir = mkdtempSync(join(tmpdir(), 'weave-template-cli-'));
  try {
    const data = join(dir, 'w.db');
    const cli = (...args) => execFileSync('node', [BIN, ...args, '--data', data], { encoding: 'utf8' });
    cli('space', 'create', 'CRM');
    assert.equal(JSON.parse(cli('space', 'update', 'CRM', '--template', 'true')).template, true);
    assert.equal(JSON.parse(cli('space', 'update', 'CRM', '--template', 'false')).template, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---------------- step 2: the copy ----------------

/* A source workspace whose CRM space wears every costume a schema can carry,
   plus one relation that leaves the space (Deal.Ledger → Accounts/Ledger)
   and a lookup that rides it. */
function costumed() {
  const w = new Weave();
  w.updateWorkspace({ name: 'source' });
  w.createSpace({ name: 'Accounts' });
  const ledger = w.createTable({ space: 'Accounts', name: 'Ledger' });
  w.addField(ledger.id, { name: 'Code', type: 'text' });

  w.createSpace({ name: 'CRM', description: 'the pipeline', icon: 'lucide:briefcase', template: true });
  const company = w.createTable({ space: 'CRM', name: 'Company', description: 'who we sell to', icon: 'lucide:landmark' });
  const deal = w.createTable({ space: 'CRM', name: 'Deal', description: 'one opportunity', icon: 'lucide:wallet' });
  w.updateTable(deal.id, { noun: 'deal' });
  w.addField(company.id, { name: 'Industry', type: 'multiselect', config: { options: [{ name: 'Retail', hue: 'amber', icon: 'lucide:star' }, { name: 'Health', hue: 'teal' }] } });
  w.addField(deal.id, { name: 'Stage', type: 'select', config: { options: [{ name: 'Lead', hue: 'blue', icon: 'lucide:sparkles' }, { name: 'Won', hue: 'green', icon: 'lucide:check' }], width: 180 } });
  w.addField(deal.id, { name: 'State', type: 'workflow', config: { states: [
    { name: 'Open', category: 'in-progress', default: true, icon: 'lucide:flag' },
    { name: 'Closed', category: 'done', icon: 'lucide:check' },
  ] } });
  w.addField(deal.id, { name: 'Amount', type: 'number', config: { format: 'currency', currency: 'USD', decimals: 2, width: 140 } });
  w.addField(deal.id, { name: 'Close', type: 'date', config: { grain: ['year', 'month'] } });
  w.addField(deal.id, { name: 'Weighted', type: 'formula', config: { expression: 'Amount * 2' } });
  w.addField(deal.id, { name: 'Notes', type: 'document' });
  w.addRelation(deal.id, { name: 'Company', targetDb: company.id, cardinality: 'many-to-one', inverseName: 'Deals' });
  w.addField(deal.id, { name: 'Company Name', type: 'lookup', config: { relationField: 'Company', targetField: 'Name' } });
  w.addField(company.id, { name: 'Pipeline', type: 'rollup', config: { relationField: 'Deals', targetField: 'Amount', aggregate: 'sum' } });
  // A lookup whose target is itself a relation reads the far row's chip
  // (Issue #643): Deal → Contact → the contact's Company.
  const contact = w.createTable({ space: 'CRM', name: 'Contact' });
  w.addRelation(contact.id, { name: 'Employer', targetDb: company.id, cardinality: 'many-to-one', inverseName: 'Staff' });
  w.addRelation(deal.id, { name: 'Contact', targetDb: contact.id, cardinality: 'many-to-one', inverseName: 'Deals' });
  w.addField(deal.id, { name: 'Contact Employer', type: 'lookup', config: { relationField: 'Contact', targetField: 'Employer' } });
  w.addRelation(deal.id, { name: 'Ledger', targetDb: ledger.id, cardinality: 'many-to-one', inverseName: 'Deals' });
  w.addField(deal.id, { name: 'Ledger Code', type: 'lookup', config: { relationField: 'Ledger', targetField: 'Code' } });
  w.addField(w.getTable('Workspace/Spaces').id, { name: 'Deal · Amount · sum', type: 'rollup', config: { via: deal.id, targetField: 'Amount', aggregate: 'sum' } });

  // Field order that differs from creation order, hidden fields, filter and
  // sort on the default view, a second view with widths and a frozen column,
  // and the body blocks moved.
  const order = ['Name', 'Amount', 'Stage', 'State', 'Company', 'Company Name', 'Weighted', 'Close', 'Ledger', 'Ledger Code', 'Notes', 'Description'];
  w.updateTable(deal.id, { fieldOrder: [...order, ...w.getTable(deal.id).fieldOrder.map((id) => w.getTable(deal.id).fields[id].name).filter((n) => !order.includes(n))] });
  w.updateTable(deal.id, { hiddenFields: ['Description', 'Ledger Code'], filters: { State: ['Open'] }, sort: [{ field: 'Amount', dir: 'desc' }] });
  w.tableView('CRM/Deal/Board', { from: w.tableView('CRM/Deal').views[0].name, fields: ['Name', 'Stage', 'Amount', 'Ledger'], widths: { Name: 260, Amount: 120 }, frozen: 1 });
  w.updateTable(deal.id, { bodyOrder: ['Notes', '@values'] });

  // Rows never travel.
  const acme = w.createEntity(company.id, { name: 'Acme' });
  w.createEntity(deal.id, { name: 'Big one', values: { Amount: 1000, Company: acme.id } });
  return w;
}

const entryOf = (w, name) => w.describeSchema().find((s) => s.space === name);
const spacesRollups = (w) => (w.describeSchema().find((s) => s.system === 'workspace')?.tables.find((t) => t.system === 'spaces')?.fields ?? [])
  .filter((f) => f.type === 'rollup' && f.viaTable);

test('templateDoc renames the space, drops source ids and the template mark, and skips what leaves the space', () => {
  const w = costumed();
  const entry = entryOf(w, 'CRM');
  const before = JSON.stringify(entry);
  const { doc, skipped } = templateDoc(entry, { name: 'Sales' });
  assert.equal(JSON.stringify(entry), before, 'the source entry is untouched');
  assert.equal(doc.space, 'Sales');
  for (const k of ['spaceId', 'url', 'template']) assert.equal(k in doc, false, `no ${k}`);
  const deal = doc.tables.find((t) => t.name === 'Deal');
  assert.equal(deal.qualified, 'Sales/Deal');
  for (const k of ['id', 'url', 'entityCount']) assert.equal(k in deal, false, `no table ${k}`);
  const byName = (n) => deal.fields.find((f) => f.name === n);
  assert.equal(byName('Company').targetDb, 'Sales/Company', 'an inside relation points at the copy');
  assert.equal('targetDbId' in byName('Company'), false);
  assert.equal('inverseFieldId' in byName('Company'), false);
  assert.ok(deal.fields.every((f) => !('id' in f)), 'no field ids');
  assert.ok(byName('Stage').optionsFull.every((o) => !('id' in o)), 'no option ids');
  assert.ok(byName('State').states.every((s) => !('id' in s)), 'no state ids');
  assert.ok(deal.views.every((v) => !('id' in v)), 'no view ids');
  assert.equal(byName('Ledger'), undefined, 'the outside relation is left out');
  assert.equal(byName('Ledger Code'), undefined, 'and the lookup that rides it');
  assert.deepEqual(skipped, [
    { table: 'Deal', field: 'Ledger', targetDb: 'Accounts/Ledger' },
    { table: 'Deal', field: 'Ledger Code', via: 'Ledger' },
  ]);
  assert.ok(deal.views.every((v) => !v.fields.includes('Ledger') && !v.fields.includes('Ledger Code')), 'views stop naming them');
  assert.ok(!deal.hiddenFields.includes('Ledger Code'));
  assert.ok(!(deal.views.find((v) => v.name === 'Board').widths ?? {}).Ledger);
  assert.equal(templateDoc(entry).doc.space, 'CRM', 'the name defaults to the source\'s');
  assert.throws(() => templateDoc(entryOf(w, 'Workspace')), /system space/);
});

test('templateDoc removes a formula that reads a skipped field, and rewrites a space rollup', () => {
  const w = costumed();
  w.addField('CRM/Deal', { name: 'Code Upper', type: 'formula', config: { expression: 'UPPER([Ledger Code])' } });
  const rollups = spacesRollups(w);
  const { skipped, rollups: carried } = templateDoc(entryOf(w, 'CRM'), { name: 'Sales', rollups });
  assert.deepEqual(skipped.at(-1), { table: 'Deal', field: 'Code Upper', reads: 'Ledger Code' });
  assert.deepEqual(carried.map((r) => [r.name, r.viaTable]), [['Deal · Amount · sum', 'Sales/Deal']]);
});

test('fidelity: a template used into a fresh workspace describes exactly as its templateDoc, rows left home', () => {
  const src = costumed();
  const before = JSON.stringify(src.describeSchema());
  const target = new Weave();
  target.updateWorkspace({ name: 'acme' });
  const used = src.useTemplate('CRM', target, { name: 'Sales' });
  assert.equal(JSON.stringify(src.describeSchema()), before, 'the source is untouched');
  assert.equal(used.space.name, 'Sales');
  assert.equal('template' in used.space, false, 'the copy is never itself a template');
  assert.ok(used.plan.some((p) => p.action === 'create-space' && p.subject === 'Sales'), JSON.stringify(used.plan));
  assert.deepEqual(used.skipped, [
    { table: 'Deal', field: 'Ledger', targetDb: 'Accounts/Ledger' },
    { table: 'Deal', field: 'Ledger Code', via: 'Ledger' },
  ], 'the outside relation is the one named difference');

  const want = templateDoc(entryOf(src, 'CRM'), { name: 'Sales', rollups: spacesRollups(src) });
  assert.deepEqual(normalise(entryOf(target, 'Sales')), normalise(want.doc));
  assert.deepEqual(normalise(spacesRollups(target)), normalise(want.rollups), 'the space rollup travels');
  for (const t of target.listTables(used.space.id)) assert.equal(target.listEntities(t.id).length, 0, `${t.name} carries no rows`);
  assert.equal(target.listTemplates().length, 0);

  // The copy behaves: its lookup of a relation reads the far row's chip (Issue #643).
  const globex = target.createEntity('Sales/Company', { name: 'Globex' });
  target.createEntity('Sales/Contact', { name: 'Hank', values: { Employer: globex.id } });
  const deal = target.createEntity('Sales/Deal', { name: 'Small one', values: { Contact: 'Hank' } });
  const chip = target.readEntity(deal.id).fields['Contact Employer'];
  assert.deepEqual({ id: chip.id, name: chip.name, db: chip.db }, { id: globex.id, name: 'Globex', db: 'Sales/Company' });
  assert.deepEqual(src.listTemplates().map((s) => s.name), ['CRM']);
});

test('useTemplate refuses a name the target already holds and leaves the target\'s other spaces alone', () => {
  const src = costumed();
  const target = new Weave();
  target.createSpace({ name: 'Ops' });
  const run = target.createTable({ space: 'Ops', name: 'Run' });
  target.addField(run.id, { name: 'Cost', type: 'number' });
  target.addField(target.getTable('Workspace/Spaces').id, { name: 'Deal · Amount · sum', type: 'rollup', config: { via: run.id, targetField: 'Cost', aggregate: 'sum' } });
  const theirs = JSON.stringify(entryOf(target, 'Ops'));

  const first = src.useTemplate('CRM', target);
  assert.equal(first.space.name, 'CRM');
  assert.equal(JSON.stringify(entryOf(target, 'Ops')), theirs, 'a partial apply leaves Ops as it was');
  const rollups = spacesRollups(target);
  assert.equal(rollups.find((f) => f.name === 'Deal · Amount · sum').viaTable, 'Ops/Run', 'the target\'s own rollup is kept');
  assert.equal(rollups.find((f) => f.name === 'Deal · Amount · sum (CRM)').viaTable, 'CRM/Deal', 'the copy\'s takes the space\'s name');

  const schema = JSON.stringify(target.describeSchema());
  assert.throws(() => src.useTemplate('CRM', target), (err) => err.code === 'conflict' && /already has a space named 'CRM'/.test(err.message));
  assert.throws(() => src.useTemplate('CRM', target, { name: 'crm' }), (err) => err.code === 'conflict', 'case does not dodge it');
  assert.equal(JSON.stringify(target.describeSchema()), schema, 'a refusal writes nothing');
  // The same workspace is a legal target under a new name.
  assert.equal(src.useTemplate('CRM', src, { name: 'CRM copy' }).space.name, 'CRM copy');
});

// ---------------- step 5: CLI and MCP parity ----------------

test('weave template list and weave template use --into copy the schema into another file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-template-cli-'));
  try {
    const src = join(dir, 'src.db');
    const other = join(dir, 'other.db');
    const cli = (...args) => execFileSync('node', [BIN, ...args], { encoding: 'utf8' });
    cli('space', 'create', 'CRM', '--template', 'true', '--data', src);
    cli('space', 'create', 'Ops', '--data', src);
    cli('table', 'create', 'CRM', 'Deal', '--data', src);
    cli('field', 'add', 'Deal', 'Amount', 'number', '--data', src);
    cli('create', 'Deal', 'Big one', '--data', src);
    assert.deepEqual(JSON.parse(cli('template', 'list', '--data', src)).map((s) => s.name), ['CRM']);
    const used = JSON.parse(cli('template', 'use', 'CRM', '--into', other, '--name', 'Sales', '--data', src));
    assert.equal(used.space.name, 'Sales');
    assert.deepEqual(used.skipped, []);
    const target = new Weave({ path: other });
    assert.deepEqual(target.getTable('Sales/Deal').fieldOrder.map((id) => target.getTable('Sales/Deal').fields[id].name).slice(0, 3), ['Name', 'Description', 'Amount']);
    assert.equal(target.listEntities(target.getTable('Sales/Deal').id).length, 0, 'no rows travel');
    target.store.close?.();
    assert.throws(() => execFileSync('node', [BIN, 'template', 'use', 'CRM', '--into', other, '--name', 'Sales', '--data', src], { encoding: 'utf8', stdio: 'pipe' }),
      /already has a space named 'Sales'/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('MCP: weave_template_list answers, and the stdio server refuses weave_template_use by naming the HTTP door', () => {
  const w = costumed();
  assert.deepEqual(dispatchTool(w, 'weave_template_list').templates.map((s) => s.name), ['CRM']);
  assert.throws(() => dispatchTool(w, 'weave_template_use', { space: 'CRM', workspace: 'acme' }), /HTTP door \(POST \/api\/mcp/);
  dispatchTool(w, 'weave_create_space', { name: 'Hiring', template: true });
  assert.equal(w.getSpace('Hiring').template, true, 'weave_create_space takes template');
});
