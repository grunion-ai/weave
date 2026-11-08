import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { withServer } from './lib/fixtures.mjs';

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
  const hits = w.universalSearch('triage');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].kind, 'view');
  assert.equal(hits[0].id, view.id);
  assert.equal(hits[0].name, 'Issue triage');
  assert.equal(hits[0].url, `/w/${w.state.meta.name}/#/view/${view.id}`);
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
  other.state.meta.name = 'issues';
  await withServer(uno, { workspaces: { issues: other } }, async ({ base }) => {
    const scoped = await (await fetch(`${base}/api/search?q=issue&limit=4`)).json();
    assert.ok(scoped.some((h) => h.kind === 'table'), 'scoped: the table is returned');
    assert.ok(scoped.some((h) => h.kind === 'view'), 'scoped: the view is returned');
    assert.equal(scoped.filter((h) => h.kind === 'entity').length, 4);

    const all = await (await fetch(`${base}/api/search?q=issue&all=1&limit=4`)).json();
    assert.equal(all.some((h) => h.workspace), false, 'all=1 is ignored and no hit names a workspace (Issue #1308)');
    assert.deepEqual(all, scoped, 'all=1 answers exactly what the workspace answers');
    assert.equal(all.some((h) => String(h.url).startsWith('/w/issues/')), false, 'no row from the other workspace is returned');
  });
});

test('a registry row never shadows its own space or table hit (Issue #382)', () => {
  const { w } = crowded('Onboarding', 0);
  const hits = w.universalSearch('onboarding');
  assert.deepEqual(hits.map((h) => `${h.kind}:${h.db ?? ''}${h.name}`), ['table:Issue desk/Onboarding']);
  const desk = w.universalSearch('issue desk');
  assert.deepEqual(desk.map((h) => h.kind), ['space', 'table'].filter((k) => desk.some((h) => h.kind === k)));
  assert.ok(!desk.some((h) => h.kind === 'entity' && /^(System|Workspace)\//.test(h.db)), `no registry rows: ${desk.map((h) => h.db ?? h.kind)}`);
});
