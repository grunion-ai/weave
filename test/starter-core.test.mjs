/* Issue #386 — the first-run empty state, the pure half and its engine side.
   Every root workspace carries the registry (the system Workspace space and
   its tables) from birth, so a count that includes it is never zero and the
   empty state never showed. The user-table count reads the engine's system
   flag; the templates are data walked through the engine's own create
   calls, so each one is built here on a fresh engine exactly as the browser
   builds it over REST. */
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

// The engine's side of each REST door the browser walks.
function build(w, template, opts) {
  for (const step of S.steps(template, opts)) {
    if (step.op === 'space') w.createSpace(step.body);
    else if (step.op === 'table') w.createTable(step.body);
    else if (step.op === 'field') w.addField(step.table, step.body);
    else if (step.op === 'relation') w.addRelation(step.table, step.body);
    else assert.fail(`unknown op ${step.op}`);
  }
}

test('three templates: Tasks, CRM and Docs, each with a title and a blurb', () => {
  assert.deepEqual(S.TEMPLATES.map((t) => t.id), ['tasks', 'crm', 'docs']);
  for (const t of S.TEMPLATES) {
    assert.ok(t.title && t.blurb && t.space, t.id);
    assert.ok(!/—/.test(t.blurb), 'no em dash in user copy');
  }
});

for (const template of S.TEMPLATES) {
  test(`the ${template.title} template builds on a fresh engine through the create calls`, () => {
    const w = new Weave();
    build(w, template);
    assert.deepEqual(w.userTables().map((d) => d.name).sort(), template.tables.map((t) => t.name).sort());
    const known = new Set(VOCABULARY.fieldTypes.map((f) => f.type));
    for (const t of template.tables) {
      const db = w.getTable(`${template.space}/${t.name}`);
      for (const f of t.fields ?? []) {
        assert.ok(known.has(f.type), `${f.type} is a field type`);
        assert.equal(w.findField(db, f.name)?.type, f.type, `${t.name}.${f.name}`);
      }
    }
    for (const r of template.relations ?? []) {
      const db = w.getTable(`${template.space}/${r.table}`);
      assert.equal(w.findField(db, r.name)?.type, 'relation');
      assert.equal(w.findField(w.getTable(`${template.space}/${r.target}`), r.inverseName)?.type, 'relation', 'the inverse lands too');
    }
  });
}

test('Tasks carries a workflow with a default state', () => {
  const w = new Weave();
  build(w, S.TEMPLATES.find((t) => t.id === 'tasks'));
  const status = w.findField(w.getTable('Work/Tasks'), 'Status');
  assert.equal(status.type, 'workflow');
  const e = w.createEntity('Work/Tasks', { name: 'First' });
  assert.equal(w.readEntity(e.id).fields.Status, 'To do');
});

test('a space the person already made is reused, not created twice', () => {
  const w = new Weave();
  w.createSpace({ name: 'CRM' });
  const crm = S.TEMPLATES.find((t) => t.id === 'crm');
  assert.equal(S.steps(crm, { hasSpace: true }).filter((s) => s.op === 'space').length, 0);
  build(w, crm, { hasSpace: true });
  assert.equal(w.listSpaces().filter((s) => s.name === 'CRM').length, 1);
  assert.equal(w.userTables().length, 2);
});

test('index.html loads starter-core before app.js', () => {
  const html = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
  assert.ok(html.indexOf('/starter-core.js') > -1, 'loaded');
  assert.ok(html.indexOf('/starter-core.js') < html.indexOf('/app.js'), 'before the app that reads it');
});
