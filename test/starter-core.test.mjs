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

test('the catalog covers about forty kinds of work, each with one id, one space and one answer', () => {
  assert.ok(S.TEMPLATES.length >= 36, `${S.TEMPLATES.length} templates`);
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

const ORIGINAL = ['finance', 'tasks', 'crm', 'recruiting', 'projects', 'roadmap', 'content', 'support', 'freelance', 'research', 'fundraising', 'events', 'inventory', 'nonprofit', 'home'];
const copyRules = (s, where) => {
  assert.ok(!/—/.test(s), `${where}: no em dash: ${s}`);
  assert.ok(!/!/.test(s), `${where}: no exclamation mark: ${s}`);
  assert.ok(!/\b(simply|just|easy|easily)\b/i.test(s), `${where}: no filler: ${s}`);
  assert.ok(!/\brecords?\b/i.test(s), `${where}: row, never record (Issue #605): ${s}`);
};

const START = 'start';
const topics = () => S.CATEGORIES.filter((c) => c.id !== START);

test('the gallery holds nine to twelve topic categories after Start simple, each with an id, a sentence-case label, an icon and a blurb', () => {
  assert.ok(Array.isArray(S.CATEGORIES), 'CATEGORIES is exported');
  assert.equal(S.CATEGORIES[0].id, START, 'Start simple leads the gallery');
  assert.equal(S.CATEGORIES[0].label, 'Start simple');
  assert.ok(topics().length >= 9 && topics().length <= 12, `${topics().length} topic categories`);
  const icons = new Set(ICONS.map((n) => `lucide:${n}`));
  for (const key of ['id', 'label']) {
    const values = S.CATEGORIES.map((c) => c[key]);
    assert.equal(new Set(values).size, values.length, `every category ${key} is distinct: ${values.join(', ')}`);
  }
  for (const c of S.CATEGORIES) {
    assert.deepEqual(Object.keys(c).sort(), ['blurb', 'icon', 'id', 'label']);
    assert.match(c.id, /^[a-z][a-z0-9-]*$/, `${c.id}: a slug`);
    assert.match(c.label, /^[A-Z][a-z]/, `${c.label}: sentence case`);
    assert.equal(c.label.slice(1), c.label.slice(1).toLowerCase(), `${c.label}: sentence case`);
    assert.ok(c.label.length <= 28, `${c.label}: short`);
    assert.ok(icons.has(c.icon), `${c.id}: ${c.icon} is in the inventory`);
    assert.ok(c.blurb.length > 0 && c.blurb.length <= 60, `${c.blurb}: short`);
    for (const s of [c.label, c.blurb]) copyRules(s, c.id);
  }
});

test('every template sits in one category, every topic category holds three or four, and Start simple holds only basic', () => {
  const ids = new Set(S.CATEGORIES.map((c) => c.id));
  for (const t of S.TEMPLATES) assert.ok(ids.has(t.category), `${t.id}: category ${t.category} is listed`);
  for (const c of topics()) {
    const n = S.TEMPLATES.filter((t) => t.category === c.id).length;
    assert.ok(n >= 3 && n <= 4, `${c.id}: three or four templates, has ${n}`);
  }
  assert.deepEqual(S.TEMPLATES.filter((t) => t.category === START).map((t) => t.id), ['basic']);
  const topical = S.TEMPLATES.filter((t) => t.category !== START).length;
  assert.ok(topical >= 36 && topical <= 48, `${topical} topic templates`);
});

test('basic is one general table with status, owner, due date and notes, kept out of the featured three', () => {
  const basic = byId('basic');
  assert.ok(basic, 'basic is in the catalog');
  assert.equal(basic.featured, false);
  const tables = S.spec(basic, { now: NOW }).spaces[0].tables;
  assert.equal(tables.length, 1, 'one table');
  const [items] = tables;
  for (const [name, type] of [['Status', 'workflow'], ['Owner', 'text'], ['Due', 'date'], ['Notes', 'text']]) {
    assert.equal(items.fields.find((f) => f.name === name)?.type, type, `${items.name}.${name}`);
  }
  assert.ok(items.rows.length >= 2 && items.rows.length <= 4, 'a few sample rows');
  assert.match(basic.details, /starting point/i, 'details say it is a starting point');
});

test('searchText gathers the words a search should match: title, work, blurb, details, category and table names', () => {
  const freelance = byId('freelance');
  const text = S.searchText(freelance);
  for (const word of ['freelance', 'invoices', 'clients and bookings', 'jobs']) assert.ok(text.includes(word), `${word} in ${text}`);
  assert.equal(text, text.toLowerCase(), 'lower case, ready to match');
});

const SEARCHES = {
  crm: ['crm'], invoice: ['freelance'], budget: ['finance', 'budgets'], expense: ['expenses'], subscription: ['subscriptions'],
  saving: ['savings'], okr: ['goals'], meeting: ['meetings'], bug: ['bugs'], sprint: ['sprints'],
  roadmap: ['roadmap'], interview: ['recruiting', 'user-research'], hiring: ['recruiting'], onboarding: ['onboarding'],
  vacation: ['time-off'], pipeline: ['deals'], ticket: ['support'], newsletter: ['content'], campaign: ['campaigns'],
  social: ['social'], event: ['events'], investor: ['fundraising'], inventory: ['inventory'], equipment: ['assets'],
  'purchase order': ['vendors'], appointment: ['bookings'], tenant: ['rentals'], landlord: ['rentals'], donor: ['nonprofit'],
  grant: ['nonprofit'], volunteer: ['volunteers'], club: ['members'], chore: ['home'], habit: ['habits'], workout: ['workouts'],
  recipe: ['recipes'], 'meal plan': ['recipes'], homework: ['courses'], book: ['reading'], notes: ['research', 'basic'],
  'to-do': ['tasks', 'basic'],
};
test('common searches find the template people mean', () => {
  for (const [query, want] of Object.entries(SEARCHES)) {
    const hits = S.TEMPLATES.filter((t) => S.searchText(t).includes(query)).map((t) => t.id);
    for (const id of want) assert.ok(hits.includes(id), `"${query}" finds ${id}; found ${hits.join(', ') || 'nothing'}`);
  }
});

test('the fifteen original starters keep their ids and their first tables', () => {
  const ids = S.TEMPLATES.map((t) => t.id);
  for (const id of ORIGINAL) assert.ok(ids.includes(id), `${id} is still in the catalog`);
  assert.equal(S.firstTable(byId('finance')), 'Transactions');
  assert.equal(S.firstTable(byId('tasks')), 'Tasks');
  assert.equal(S.firstTable(byId('crm')), 'Companies');
});

test('every template carries one line on who it is for and one line on what it is like (Issue #949)', () => {
  for (const t of S.TEMPLATES) {
    assert.equal(typeof t.details, 'string', `${t.id}.details`);
    assert.match(t.details, /^[A-Z][^.]*\.$/, `${t.id}: one sentence: ${t.details}`);
    assert.ok(t.details.length <= 64, `${t.id}: one short line, has ${t.details.length}: ${t.details}`);
    assert.equal(typeof t.like, 'string', `${t.id}.like`);
    assert.match(t.like, /^Like \S/, `${t.id}: names what it is like: ${t.like}`);
    assert.ok(t.like.length <= 26, `${t.id}: like stays short: ${t.like}`);
    copyRules(t.details, t.id);
    copyRules(t.like, t.id);
  }
  assert.equal(byId('projects').like, 'Like Asana');
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
    if (!template.featured && template.id !== 'basic') assert.ok(tables.length >= 2 && tables.length <= 4, `${template.id}: two to four tables`);
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
