/* Issue #386 — the first-run empty state, the pure half and its engine side.
   Every root workspace carries the registry (the system Workspace space and
   its tables) from birth, so a count that includes it is never zero and the
   empty state never showed. The user-table count reads the engine's system
   flag; the templates are weave_build specs, so each one is built here on a
   fresh engine exactly as the browser and the onboarding welcome build it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Weave } from '../src/engine.js';
import { VOCABULARY } from '../src/vocabulary.js';

await import('../public/starter-core.js');
const S = globalThis.WeaveStarters;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('a fresh root counts no user tables, though the registry holds six', () => {
  const w = new Weave();
  assert.ok(w.listTables().length >= 6, 'the registry is there');
  assert.ok(w.listTables().every((t) => t.system), 'and it is all system tables');
  assert.equal(w.userTables().length, 0);
  assert.equal(S.userTables(w.describeSchema()).length, 0, 'the browser half agrees');
});

test('the count sees a person\'s table and still ignores the registry', () => {
  const w = new Weave();
  w.createSpace({ name: 'Product' });
  const t = w.createTable({ space: 'Product', name: 'Tasks' });
  assert.deepEqual(w.userTables().map((d) => d.id), [t.id]);
  assert.deepEqual(S.userTables(w.describeSchema()).map((d) => d.id), [t.id]);
});

test('the count goes by the system flag, never the name', () => {
  const w = new Weave();
  // A person may call their own space "Workspace"-ish and their table "Tables".
  w.createSpace({ name: 'Workspace2' });
  w.createTable({ space: 'Workspace2', name: 'Tables' });
  assert.equal(w.userTables().length, 1);
  assert.equal(S.userTables(w.describeSchema()).length, 1);
  // A trashed table is not counted: the empty state should come back.
  w.deleteTable('Workspace2/Tables');
  assert.equal(w.userTables().length, 0);
  assert.equal(S.userTables(w.describeSchema()).length, 0);
});

test('userTables tolerates an empty or missing schema', () => {
  assert.deepEqual(S.userTables([]), []);
  assert.deepEqual(S.userTables(undefined), []);
  assert.deepEqual(S.userTables([{ space: 'X', tables: [] }]), []);
});

/* A template is a weave_build spec (Feature #253), so the engine builds it
   in one call: the same POST /api/build the empty state sends, and the same
   build the onboarding welcome runs server side. */
const NOW = new Date(2026, 9, 3);
function build(w, template, now = NOW) {
  const r = w.build(S.spec(template, { now }));
  assert.deepEqual(r.errors, [], `${template.id} builds without errors`);
  assert.deepEqual(r.ignored, [], `${template.id}: every icon and key is taken`);
  return r;
}
const byId = (id) => S.TEMPLATES.find((t) => t.id === id);
// Stored values (raw), not the display strings readEntity's fields carry.
const rows = (w, ref) => w.listEntities(w.getTable(ref).id).map((e) => { const r = w.readEntity(e.id); return { id: r.id, name: r.raw.Name, fields: r.raw }; });

test('three templates: personal finance, tasks and a CRM, each titled for its space', () => {
  assert.deepEqual(S.TEMPLATES.map((t) => t.id), ['finance', 'tasks', 'crm']);
  assert.deepEqual(S.TEMPLATES.map((t) => t.title), ['Money', 'Work', 'People']);
  for (const t of S.TEMPLATES) {
    assert.ok(t.title && t.blurb && t.space, t.id);
    assert.equal(t.title, t.space, 'the card and the sidebar call it one thing');
    for (const s of [t.title, t.blurb, t.space]) assert.ok(!/\u2014/.test(s), `no em dash in user copy: ${s}`);
    assert.ok(!/\brecords?\b/i.test(t.blurb), 'row, never record (Issue #605)');
  }
});

for (const template of S.TEMPLATES) {
  test(`the ${template.title} template builds on a fresh engine in one build call`, () => {
    const w = new Weave();
    const spec = S.spec(template, { now: NOW });
    assert.equal(spec.spaces.length, 1);
    assert.equal(spec.spaces[0].name, template.space);
    build(w, template);
    const tables = spec.spaces[0].tables;
    assert.deepEqual(w.userTables().map((d) => d.name).sort(), tables.map((t) => t.name).sort());
    assert.equal(S.firstTable(template), tables[0].name, 'the table a build opens on');
    const known = new Set(VOCABULARY.fieldTypes.map((f) => f.type));
    for (const t of tables) {
      const db = w.getTable(`${template.space}/${t.name}`);
      for (const f of t.fields ?? []) {
        assert.ok(known.has(f.type), `${f.type} is a field type`);
        assert.equal(w.findField(db, f.name)?.type, f.type, `${t.name}.${f.name}`);
        if (f.type === 'relation') {
          assert.equal(w.findField(w.getTable(`${template.space}/${f.to}`), f.inverseName)?.type, 'relation', `${t.name}.${f.name}: the inverse lands too`);
        }
      }
      assert.equal(rows(w, `${template.space}/${t.name}`).length, (t.rows ?? []).length, `${t.name}: its sample rows`);
    }
  });
}

test('Personal finance: Months rolls up spent and income and nets them', () => {
  const w = new Weave();
  build(w, byId('finance'));
  const months = rows(w, 'Money/Months');
  assert.deepEqual(months.map((m) => m.name), ['October 2026'], 'one row per month, named for this month');
  const [m] = months;
  const spent = rows(w, 'Money/Transactions').reduce((sum, t) => sum + t.fields.Amount, 0);
  assert.ok(spent > 0, 'the sample transactions carry amounts');
  assert.equal(m.fields.Spent, spent);
  assert.equal(m.fields.Earned, rows(w, 'Money/Income').reduce((sum, t) => sum + t.fields.Amount, 0));
  assert.equal(Math.round(m.fields.Net * 100), Math.round((m.fields.Earned - spent) * 100));
  assert.equal(w.findField(w.getTable('Money/Transactions'), 'Amount').config.format, 'currency');
});

test('Personal finance: two transactions and one income linked to a month compute its rollups and net', () => {
  const w = new Weave();
  // Structure only: the rows here are the test's own.
  const spec = S.spec(byId('finance'), { now: NOW });
  for (const t of spec.spaces[0].tables) delete t.rows;
  assert.deepEqual(w.build(spec).errors, []);
  const month = w.createEntity('Money/Months', { name: 'March 2026' });
  w.createEntity('Money/Transactions', { name: 'Rent', Amount: 1500, Month: [month.id] });
  w.createEntity('Money/Transactions', { name: 'Groceries', Amount: 120.5, Month: [month.id] });
  w.createEntity('Money/Income', { name: 'Paycheck', Amount: 4000, Month: [month.id] });
  const f = w.readEntity(month.id).raw;
  assert.equal(f.Spent, 1620.5);
  assert.equal(f.Earned, 4000);
  assert.equal(f.Net, 2379.5);
  // Moving a transaction out of the month moves its figures.
  const groceries = rows(w, 'Money/Transactions').find((t) => t.name === 'Groceries');
  w.updateEntity(groceries.id, { Month: [] });
  assert.equal(w.readEntity(month.id).raw.Spent, 1500);
  assert.equal(w.readEntity(month.id).raw.Net, 2500);
});

test('Personal finance: a recurring bill links to the transactions that paid it', () => {
  const w = new Weave();
  build(w, byId('finance'));
  const linked = rows(w, 'Money/Recurring').filter((r) => (r.fields.Transactions ?? []).length);
  assert.ok(linked.length >= 1, 'a sample recurring row carries its transaction');
});

test('the sample rows date to the month they are built in', () => {
  const w = new Weave();
  build(w, byId('finance'), new Date(2027, 1, 20));
  assert.deepEqual(rows(w, 'Money/Months').map((m) => m.name), ['February 2027']);
  for (const t of rows(w, 'Money/Transactions')) assert.match(String(t.fields.Date), /^2027-02-/);
});

test('Tasks carries a workflow with a default state', () => {
  const w = new Weave();
  build(w, byId('tasks'));
  const status = w.findField(w.getTable(`${byId('tasks').space}/Tasks`), 'Status');
  assert.equal(status.type, 'workflow');
  const e = w.createEntity(`${byId('tasks').space}/Tasks`, { name: 'First' });
  assert.equal(w.readEntity(e.id).fields.Status, 'To do');
});

test('CRM links each sample contact to its company', () => {
  const w = new Weave();
  const crm = byId('crm');
  build(w, crm);
  const [contact] = rows(w, `${crm.space}/Contacts`);
  assert.equal((contact.fields.Company ?? []).length, 1);
});

test('a space the person already made is reused, not created twice', () => {
  const w = new Weave();
  const crm = byId('crm');
  w.createSpace({ name: crm.space });
  const r = build(w, crm);
  assert.equal(r.created.spaces, 0);
  assert.equal(w.listSpaces().filter((s) => s.name === crm.space).length, 1);
  assert.equal(w.userTables().length, 2);
});

test('index.html loads starter-core before app.js', () => {
  const html = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(html.indexOf('/starter-core.js') > -1, 'loaded');
  assert.ok(html.indexOf('/starter-core.js') < html.indexOf('/app.js'), 'before the app that reads it');
});
