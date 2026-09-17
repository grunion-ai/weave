/* Universal search keeps the hierarchy (Issue #280).
   Rows used to crowd containers out: hierarchy hits scored 8–9, a row hit
   up to 20, and the merged list was sorted and then sliced to `limit` — so a
   query matching 200 rows returned 200 rows and never the workspace, space or
   table of the same name. `limit` bounds rows; the workspace, spaces, tables
   and saved views that match are always returned. Views are searched too. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

function crowded(name = 'Issue', rows = 30) {
  const w = new Weave();
  w.state.meta.name = 'issue tracker';
  w.createSpace({ name: 'Issue desk' });
  const t = w.createTable({ space: 'Issue desk', name: name });
  for (let i = 0; i < rows; i++) w.createEntity(t, { name: `Issue number ${i}` });
  w.createView({ name: 'Issue triage', blocks: [{ table: t.id }] });
  return { w, t };
}

test('rows filling the limit never crowd out the workspace, space, table or view', () => {
  const { w, t } = crowded();
  const hits = w.universalSearch('issue', { limit: 5 });
  const kinds = hits.map((h) => h.kind);
  assert.ok(kinds.includes('workspace'), 'the workspace survives a full page of rows');
  assert.ok(kinds.includes('space'), 'the space survives');
  assert.ok(hits.some((h) => h.kind === 'table' && h.id === t.id), 'the table survives');
  assert.ok(kinds.includes('view'), 'the view survives');
  assert.equal(hits.filter((h) => h.kind === 'entity').length, 5, 'limit still bounds the rows');
  const firstRow = kinds.indexOf('entity');
  assert.ok(kinds.slice(0, firstRow).length === 4, `containers list above the text-matched rows (got ${kinds.join(', ')})`);
});

test('saved views are searched, with a #/view/ permalink', () => {
  const { w } = crowded('Ticket', 0);
  const [view] = w.listViews();
  const hits = w.universalSearch('triage', { prefix: '/w/demo' });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, 'view');
  assert.equal(hits[0].id, view.id);
  assert.equal(hits[0].name, 'Issue triage');
  assert.equal(hits[0].url, `/w/demo/#/view/${view.id}`);
  w.deleteView(view.id);
  assert.equal(w.universalSearch('triage').length, 0, 'a deleted view is no longer found');
});

test('an id hit still ranks on top once hierarchy is kept', () => {
  const { w } = crowded();
  const hits = w.universalSearch('#2', { limit: 3 });
  assert.equal(hits[0].kind, 'entity');
  assert.equal(hits[0].publicId, 2);
});

test('GET /api/search keeps hierarchy past the limit, scoped and across workspaces', async () => {
  const { w: uno } = crowded();
  uno.state.meta.name = 'uno';
  const { w: other } = crowded('Issue');
  const { server } = await startServer(uno, { port: 0, workspaces: { issues: other } });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const scoped = await (await fetch(`${base}/api/search?q=issue&limit=4`)).json();
    assert.ok(scoped.some((h) => h.kind === 'table'), 'scoped: the table is returned');
    assert.ok(scoped.some((h) => h.kind === 'view'), 'scoped: the view is returned');
    assert.equal(scoped.filter((h) => h.kind === 'entity').length, 4);

    const all = await (await fetch(`${base}/api/search?q=issue&all=1&limit=4`)).json();
    assert.ok(all.some((h) => h.workspace === 'issues' && h.kind === 'workspace'), 'all: the named workspace is returned');
    for (const ws of ['uno', 'issues']) {
      assert.ok(all.some((h) => h.workspace === ws && h.kind === 'table'), `all: ${ws}'s table is returned`);
      assert.ok(all.some((h) => h.workspace === ws && h.kind === 'view'), `all: ${ws}'s view is returned`);
    }
    assert.equal(all.filter((h) => h.kind === 'entity').length, 4, 'all: limit bounds rows across workspaces');
    const view = all.find((h) => h.workspace === 'issues' && h.kind === 'view');
    assert.match(view.url, /^\/w\/issues\/#\/view\//);
  } finally {
    server.close();
  }
});
