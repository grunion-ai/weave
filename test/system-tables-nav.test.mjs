import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { APP, HTML, fnBodyOf, rulesFor } from './lib/source.mjs';

function build() {
  const w = new Weave();
  w.createSpace({ name: 'Work' });
  const tasks = w.createTable({ space: 'Work', name: 'Tasks' });
  return { w, tasks, wf: w.getTable('System/Workflows') };
}

test('a system table cannot be renamed, directly or through its Tables row', () => {
  const { w, wf } = build();
  assert.throws(() => w.updateTable(wf.id, { name: 'Automations' }), /system/i);
  const row = w.findEntity('System/Tables', 'Workflows');
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
    assert.ok(items.some((i) => i.db === 'System/Tables' && i.name === 'Scratch'), 'a trashed table is its registry row');
    assert.equal(total, items.length);
    const renamed = await fetch(`${base}/api/tables/${wf.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Automations' }),
    });
    assert.equal(renamed.status, 400);
  } finally { server.close(); }
});

test('the sidebar anchors its name and search at the top, and pins New space then the system tables at the bottom (Issue #854)', () => {
  assert.match(HTML, /<div class="nav-head">[\s\S]*id="ws-name"[\s\S]*id="search-btn"[\s\S]*<\/div>/,
    'the workspace name and the search button share one head block, so one rule anchors both');
  const head = rulesFor('.nav-head');
  const pinned = rulesFor('.nav-pinned');
  assert.equal(head.position, 'sticky', 'the head holds the sidebar\'s top edge');
  assert.equal(pinned.position, 'sticky', 'the pinned strip holds its bottom edge');
  assert.equal(head.top, '-14px', 'it sticks past the sidebar\'s own padding, as the strip already does');
  assert.equal(pinned.bottom, '-14px');
  for (const [name, rules] of [['.nav-head', head], ['.nav-pinned', pinned]]) {
    assert.match(rules.background ?? '', /--wv-canvas/, `${name} paints the canvas, so rows scroll under it rather than through it`);
  }
  assert.equal(rulesFor('#sidebar')['overflow-y'], 'auto', 'the sidebar stays the one scroll container (Issue #451)');
  for (const [sidebar, nav] of [['#sidebar', '#sidebar .nav-head'], ['#app.nav-peek #sidebar', '#app.nav-peek #sidebar .nav-head']]) {
    const pad = rulesFor(sidebar)['padding-top'] ?? rulesFor(sidebar).padding?.split(/\s+/)[0];
    if (!pad) continue;
    assert.equal(rulesFor(nav)['padding-top'], pad, `${nav} covers the ${pad} the sidebar pads at that size`);
    assert.equal(rulesFor(nav).top, `-${pad}`, `${nav} sticks flush with the sidebar's own edge there`);
  }

  const nav = fnBodyOf('renderNav');
  const strip = nav.indexOf("class: 'nav-pinned'");
  assert.ok(strip > -1, 'one strip holds everything pinned to the bottom');
  const order = ['foot', 'system', 'identity'].map((n) => nav.indexOf(n, strip));
  assert.deepEqual([...order].sort((a, b) => a - b), order,
    'New space leads the strip, the System space follows it, the identity panel last (Issue #854, Feature #333)');
  assert.doesNotMatch(nav, /nav-stats/, 'the rows and size line is gone (Feature #333)');
});

test('the nav pins Workflows, Users, Activity and Trash, in that order, under the spaces', () => {
  const nav = fnBodyOf('renderNav');
  const group = nav.slice(nav.indexOf("class: 'nav-system'"), nav.indexOf("class: 'nav-pinned'"));
  const at = (s) => group.indexOf(s);
  assert.ok(at("'#/activity'") > -1 && at("'#/trash'") > -1 && at("'Workflows'") > -1, 'the three routes');
  assert.ok(at("'Workflows'") < at("'Users'") && at("'Users'") < at("'#/activity'") && at("'#/activity'") < at("'#/trash'"), 'Workflows, Users, Activity, Trash (Issue #561, Feature #318)');
  assert.doesNotMatch(group, /navTableMenu|draggable|grip/, 'no kebab, no grip: fixed rows');
  assert.match(nav, /db\.system === 'workflows'\) continue/, 'Workflows leaves the scrolling space list: one place in the nav');
});

test('the Workflows row always shows, resolved through the registry a member reads from the root (Issue #872)', () => {
  const nav = fnBodyOf('renderNav');
  const group = nav.slice(nav.indexOf("class: 'nav-system'"), nav.indexOf("class: 'nav-pinned'"));
  assert.doesNotMatch(group, /wf \? \[/, 'no condition wraps the Workflows row');
  assert.match(nav, /registryTable\('workflows'\)/, 'a member workspace finds Workflows in state.registry');
  assert.match(nav, /wf \? `#\/table\/\$\{wf\.id\}`/, 'the row opens Workflows at this workspace\'s own URL (Issue #875)');
  assert.doesNotMatch(nav, /`\/#\/table\/\$\{wf\.id\}`/, 'never the root registry table, which lists other workspaces\' workflows');
  assert.match(nav, /: '\/'/, 'nothing resolved still links the root registry');
});

test('the sidebar lists user spaces only; the registry lives on the workspace page (Issue #874)', () => {
  const nav = fnBodyOf('renderNav');
  assert.match(nav, /for \(const space of state\.schema\) \{\s*if \(space\.system\) continue;/, 'a system space never renders as a sidebar space');
  const home = fnBodyOf('showHome');
  assert.match(home, /state\.schema\.filter\(\(s\) => s\.system === 'workspace'\)/, 'the workspace page reads its own registry space, never the root\'s');
  assert.match(home, /dataset: \{ href: `#\/table\/\$\{db\.id\}`, registry: db\.system \}/, 'each registry table is a row that opens it');
});

test('the pinned group sits outside the scrolling list, above the identity panel', () => {
  const nav = fnBodyOf('renderNav');
  assert.match(nav, /document\.querySelector\('#sidebar \.nav-pinned'\)\?\.remove\(\)/, 'redrawn, never stacked');
  const strip = nav.indexOf("class: 'nav-pinned'");
  assert.ok(strip > -1, 'a sibling after #nav, the one strip pinned to the bottom');
  assert.ok(nav.indexOf('system', strip) < nav.indexOf('identity', strip), 'System above the identity panel');
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
