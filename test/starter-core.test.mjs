import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Weave } from '../src/engine.js';
import { VOCABULARY, ICONS } from '../src/vocabulary.js';

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
  w.createSpace({ name: 'Workspace2' });
  w.createTable({ space: 'Workspace2', name: 'Tables' });
  assert.equal(w.userTables().length, 1);
  assert.equal(S.userTables(w.describeSchema()).length, 1);
  w.deleteTable('Workspace2/Tables');
  assert.equal(w.userTables().length, 0);
  assert.equal(S.userTables(w.describeSchema()).length, 0);
});

test('userTables tolerates an empty or missing schema', () => {
  assert.deepEqual(S.userTables([]), []);
  assert.deepEqual(S.userTables(undefined), []);
  assert.deepEqual(S.userTables([{ space: 'X', tables: [] }]), []);
});

const NOW = new Date(2026, 9, 3);
function build(w, template, now = NOW) {
  const r = w.build(S.spec(template, { now }));
  assert.ok(r.ok, `${template.id} builds`);
  assert.deepEqual(r.errors, [], `${template.id} builds without errors`);
  assert.deepEqual(r.ignored, [], `${template.id}: every icon and key is taken`);
  return r;
}
const byId = (id) => S.TEMPLATES.find((t) => t.id === id);
const rows = (w, ref) => w.listEntities(w.getTable(ref).id).map((e) => { const r = w.readEntity(e.id); return { id: r.id, name: r.raw.Name, fields: r.raw }; });

test('three featured templates: personal finance, tasks and a CRM, in that order', () => {
  const featured = S.TEMPLATES.filter((t) => t.featured);
  assert.deepEqual(featured.map((t) => t.id), ['finance', 'tasks', 'crm']);
  assert.deepEqual(featured.map((t) => t.title), ['Money', 'Work', 'People']);
  assert.deepEqual(S.TEMPLATES.slice(0, 3), featured, 'the featured three lead the catalog');
  for (const t of S.TEMPLATES.slice(3)) assert.equal(t.featured, false, `${t.id} is in the catalog only`);
});

test('the catalog covers about fourteen kinds of work, each with one id, one space and one answer', () => {
  assert.ok(S.TEMPLATES.length >= 14, `${S.TEMPLATES.length} templates`);
  for (const key of ['id', 'title', 'space', 'work']) {
    const values = S.TEMPLATES.map((t) => t[key]);
    assert.equal(new Set(values).size, values.length, `every ${key} is distinct: ${values.join(', ')}`);
  }
  for (const t of S.TEMPLATES) {
    for (const key of ['id', 'title', 'blurb', 'space', 'icon', 'work']) assert.equal(typeof t[key], 'string', `${t.id}.${key}`);
    assert.equal(typeof t.tables, 'function', `${t.id}.tables`);
    assert.equal(typeof t.featured, 'boolean', `${t.id}.featured`);
    assert.match(t.id, /^[a-z][a-z0-9-]*$/, 'an id is a slug');
    assert.equal(t.title, t.space, 'the card and the sidebar call it one thing');
    assert.match(t.work, /^[A-Z][a-z]/, `${t.work}: sentence case`);
    assert.equal(t.work.slice(1), t.work.slice(1).toLowerCase(), `${t.work}: sentence case`);
    assert.ok(t.blurb.length <= 60, `${t.blurb}: short`);
    for (const s of [t.title, t.blurb, t.space, t.work]) {
      assert.ok(!/\u2014/.test(s), `no em dash in user copy: ${s}`);
      assert.ok(!/!/.test(s), `no exclamation mark: ${s}`);
      assert.ok(!/\b(simply|just|easy|easily)\b/i.test(s), `no filler: ${s}`);
    }
    assert.ok(!/\brecords?\b/i.test(t.blurb), 'row, never record (Issue #605)');
  }
});

test('every template and table icon is in the inventory', () => {
  const icons = new Set(ICONS.map((n) => `lucide:${n}`));
  for (const t of S.TEMPLATES) {
    assert.ok(icons.has(t.icon), `${t.id}: ${t.icon}`);
    for (const tb of S.spec(t, { now: NOW }).spaces[0].tables) assert.ok(icons.has(tb.icon), `${t.id}/${tb.name}: ${tb.icon}`);
  }
});

test('every option and state hue is a named colour', () => {
  const hues = new Set(VOCABULARY.optionColors.map((c) => c.name));
  for (const t of S.TEMPLATES) {
    for (const tb of S.spec(t, { now: NOW }).spaces[0].tables) {
      for (const f of tb.fields ?? []) {
        for (const o of [...(f.options ?? []), ...(f.states ?? [])]) {
          if (typeof o === 'object' && o.hue) assert.ok(hues.has(o.hue), `${t.id}/${tb.name}.${f.name}: ${o.hue}`);
        }
      }
    }
  }
});

for (const template of S.TEMPLATES) {
  test(`${template.title}: every relation, rollup and sample link resolves inside the space`, () => {
    const tables = S.spec(template, { now: NOW }).spaces[0].tables;
    const byName = new Map(tables.map((t) => [t.name, t]));
    for (const t of tables) {
      for (const f of t.fields ?? []) {
        if (f.type === 'relation') {
          assert.ok(byName.has(f.to), `${t.name}.${f.name} points at ${f.to}`);
          assert.ok(f.inverseName, `${t.name}.${f.name} names its inverse`);
        }
        if (f.type === 'rollup') {
          const own = t.fields.find((x) => x.name === f.relationField && x.type === 'relation');
          const inverse = tables.find((o) => (o.fields ?? []).some((x) => x.type === 'relation' && x.to === t.name && x.inverseName === f.relationField));
          const farName = own ? own.to : inverse?.name;
          assert.ok(farName, `${t.name}.${f.name} rolls up through a relation of its table`);
          if (f.aggregate !== 'count') {
            assert.ok(byName.get(farName).fields.some((x) => x.name === f.targetField), `${t.name}.${f.name}: ${farName}.${f.targetField} exists`);
          }
        }
      }
      for (const row of t.rows ?? []) {
        for (const f of (t.fields ?? []).filter((x) => x.type === 'relation' && row[x.name] != null)) {
          const names = new Set((byName.get(f.to).rows ?? []).map((r) => r.Name));
          for (const v of [row[f.name]].flat()) assert.ok(names.has(v), `${t.name} row ${row.Name}: ${f.name} names a ${f.to} row '${v}'`);
        }
      }
      const rowCount = (t.rows ?? []).length;
      if (template.featured) continue;
      assert.ok(rowCount >= 2 && rowCount <= 4, `${t.name}: two to four sample rows, has ${rowCount}`);
      for (const row of t.rows) {
        for (const v of Object.values(row)) {
          if (typeof v === 'string' && v.includes('@')) assert.match(v, /@example\.com$/, `${t.name}: example.com addresses only`);
          if (typeof v === 'string' && /^https?:/.test(v)) assert.match(v, /^https:\/\/([a-z0-9-]+\.)*example\.(com|org)(\/|$)/, `${t.name}: example links only`);
        }
      }
    }
    if (!template.featured) assert.ok(tables.length >= 2 && tables.length <= 4, `${template.id}: two to four tables`);
  });
}

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
