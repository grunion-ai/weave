import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { APP, fnBodyOf, rulesFor } from './lib/source.mjs';

function build() {
  const w = new Weave();
  w.createSpace({ name: 'Work' });
  const tasks = w.createTable({ space: 'Work', name: 'Tasks' });
  return { w, tasks, wf: w.getTable('Workspace/Workflows') };
}

test('a system table cannot be renamed, directly or through its Tables row', () => {
  const { w, wf } = build();
  assert.throws(() => w.updateTable(wf.id, { name: 'Automations' }), /system/i);
  const row = w.findEntity('Workspace/Tables', 'Workflows');
  assert.throws(() => w.updateEntity(row.id, { Name: 'Automations' }), /system/i, 'the registry row is the same door');
  assert.equal(w.getTable(wf.id).name, 'Workflows', 'the name held');
  assert.doesNotThrow(() => w.updateTable(wf.id, { name: 'Workflows', description: 'Every workflow.' }));
  assert.equal(w.getTable(wf.id).description, 'Every workflow.', 'the rest of the patch lands');
});

test('a system table cannot be deleted or moved', () => {
  const { w, wf } = build();
  assert.throws(() => w.deleteTable(wf.id), /system/i);
  assert.throws(() => w.deleteTable(wf.id, { hard: true }), /system/i);
  assert.throws(() => w.moveTable(wf.id, 'Work'), /system/i);
});

test('a user table still renames', () => {
  const { w, tasks } = build();
  assert.equal(w.updateTable(tasks.id, { name: 'Todos' }).name, 'Todos');
});

test('GET /api/trash lists every trashed row in the workspace, and PATCH refuses a system table rename', async () => {
  const { w, tasks, wf } = build();
  const notes = w.createTable({ space: 'Work', name: 'Notes' });
  const a = w.createEntity(tasks.id, { Name: 'old task' });
  const b = w.createEntity(notes.id, { Name: 'old note' });
  w.deleteEntity(a.id);
  w.deleteEntity(b.id);
  const gone = w.createTable({ space: 'Work', name: 'Scratch' });
  w.deleteTable(gone.id);
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/trash`);
    assert.equal(res.status, 200);
    const { total, items } = await res.json();
    const names = items.map((i) => i.name);
    assert.ok(names.includes('old task') && names.includes('old note'), 'rows from every table');
    assert.ok(items.some((i) => i.db === 'Workspace/Tables' && i.name === 'Scratch'), 'a trashed table is its registry row');
    assert.equal(total, items.length);
    const renamed = await fetch(`${base}/api/tables/${wf.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Automations' }),
    });
    assert.equal(renamed.status, 400);
  } finally { server.close(); }
});

test('the nav pins Workflows, Activity and Trash, in that order, under the spaces', () => {
  const nav = fnBodyOf('renderNav');
  const group = nav.slice(nav.indexOf("class: 'nav-system'"), nav.indexOf("$('#sidebar').append(system"));
  const at = (s) => group.indexOf(s);
  assert.ok(at("'#/activity'") > -1 && at("'#/trash'") > -1 && at('#/table/${wf.id}') > -1, 'the three routes');
  assert.ok(at('#/table/${wf.id}') < at("'#/activity'") && at("'#/activity'") < at("'#/trash'"), 'Workflows, Activity, Trash (Issue #561)');
  assert.doesNotMatch(group, /navTableMenu|draggable|grip/, 'no kebab, no grip: fixed rows');
  assert.match(nav, /db\.system === 'workflows'\) continue/, 'Workflows leaves the Workspace space list: one place in the nav');
});

test('the pinned group sits outside the scrolling list, above the stats strip', () => {
  const nav = fnBodyOf('renderNav');
  assert.match(nav, /document\.querySelector\('#sidebar \.nav-system'\)\?\.remove\(\)/, 'redrawn, never stacked');
  assert.ok(nav.indexOf("$('#sidebar').append(system") > -1, 'a sibling after #nav, like the stats strip');
  assert.ok(nav.indexOf("$('#sidebar').append(system") < nav.indexOf("$('#sidebar').append(stats)"), 'system rows above the stats');
  assert.ok(rulesFor('.nav-system')['border-top'], 'a hairline sets it apart from the spaces');
});

test('a system table\'s page title reads, it does not rename', () => {
  assert.match(APP, /onRename: db\.system \? null : async \(name\) => \{\n\s+await api\('PATCH', `\/tables\/\$\{db\.id\}`, \{ name \}\)/);
});

test('#/trash with no table is the workspace trash', () => {
  assert.match(APP, /if \(hash === '#\/trash'\) return showTrash\(null\)/);
  const body = fnBodyOf('showTrash');
  assert.match(body, /api\('GET', db \? `\/tables\/\$\{db\.id\}\/trash` : '\/trash'\)/);
});
