import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

function build() {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  const issues = w.createTable({ space: 'Dev', name: 'Issue' });
  const releases = w.createTable({ space: 'Dev', name: 'Release' });
  w.addField(issues, { name: 'Notes', type: 'text' });
  w.addRelation(releases, { name: 'Fixes', targetDb: 'Issue', cardinality: 'one-to-many', inverseName: 'Fixed in' });
  const grid = w.createEntity(issues, { name: 'Grid paints twice' });
  w.updateEntity(grid.id, { Notes: 'quasar flicker on first load' });
  const other = w.createEntity(issues, { name: 'Second issue' });
  const rel = w.createEntity(releases, { name: 'quasar release' });
  return { w, issues, releases, grid, other, rel };
}

test('universalSearch with a table scope returns only rows of those tables, matched on any text field', () => {
  const { w, issues, releases, grid, rel } = build();
  const hits = w.universalSearch('quasar', { tables: [issues.id] });
  assert.deepEqual(hits.map((h) => h.kind), ['entity'], 'no workspace, space, table or view hits under a scope');
  assert.equal(hits[0].id, grid.id, 'the Issue row is found through its Notes, not its Name');
  assert.match(hits[0].snippet, /quasar flicker/);
  const both = w.universalSearch('quasar', { tables: [issues.id, releases.id] }).map((h) => h.id).sort();
  assert.deepEqual(both, [grid.id, rel.id].sort());
  const byName = w.universalSearch('quasar', { tables: ['Dev/Release'] }).map((h) => h.id);
  assert.deepEqual(byName, [rel.id], 'a table reference by qualified name works too');
});

test('universalSearch with a table scope and no text lists the scoped rows, newest first', () => {
  const { w, issues, grid, other } = build();
  const hits = w.universalSearch('', { tables: [issues.id], limit: 10 });
  assert.deepEqual(hits.map((h) => h.id).sort(), [grid.id, other.id].sort());
  assert.ok(hits.every((h) => h.kind === 'entity' && h.db === 'Dev/Issue'));
  assert.deepEqual(w.universalSearch('', {}), [], 'the unscoped palette still answers nothing for nothing');
  w.deleteEntity(other.id);
  assert.deepEqual(w.universalSearch('', { tables: [issues.id] }).map((h) => h.id), [grid.id], 'a trashed row is not offered');
});

test('GET /api/search?tables= scopes the search to those tables', async () => {
  const { w, issues, releases, grid, rel } = build();
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const scoped = await (await fetch(`${base}/api/search?q=quasar&tables=${issues.id}`)).json();
    assert.deepEqual(scoped.map((h) => h.id), [grid.id]);
    assert.ok(scoped.every((h) => h.kind === 'entity'));
    const two = await (await fetch(`${base}/api/search?q=quasar&tables=${issues.id},${releases.id}`)).json();
    assert.deepEqual(two.map((h) => h.id).sort(), [grid.id, rel.id].sort());
    const empty = await (await fetch(`${base}/api/search?q=&tables=${issues.id}`)).json();
    assert.equal(empty.length, 2, 'an empty query under a scope lists the table');
    const wide = await (await fetch(`${base}/api/search?q=quasar`)).json();
    assert.ok(wide.some((h) => h.id === rel.id) && wide.some((h) => h.id === grid.id), 'no scope keeps the workspace-wide search');
    const missing = await fetch(`${base}/api/search?q=x&tables=no-such-table`);
    assert.equal(missing.status, 404);
  } finally {
    server.close();
  }
});
