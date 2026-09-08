import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

/* Feature #219, slice c (server half) — a member's API answers for the
   registry rows that describe it. The rows live at the root, but a member
   page reads and edits them through its own /w/<id>/api prefix: an entity
   or a registry table the member does not hold falls through to the root.
   A Spaces row created from a member page lands in that member. */

const json = async (r) => r.json();
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const patch = (url, body) => fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('a member-scoped request for a root registry row or table falls through to the root', async () => {
  const root = new Weave();
  root.updateWorkspace({ name: 'root' });
  const uno = new Weave();
  uno.updateWorkspace({ name: 'uno' });
  uno.createSpace({ name: 'Dev' });
  uno.createTable({ space: 'Dev', name: 'Task' });
  const { server } = await startServer(root, { port: 0, workspaces: { uno } });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const tablesT = root.getTable('Workspace/Tables');
    const spacesT = root.getTable('Workspace/Spaces');
    // The registry table, by name and by id, through the member prefix.
    const byName = await json(await post(`${base}/w/uno/api/tables/Tables/query`, { where: [['Name', '=', 'Task']] }));
    assert.equal(byName.total, 1);
    const byId = await json(await post(`${base}/w/uno/api/tables/${tablesT.id}/query`, {}));
    assert.ok(byId.items.some((i) => i.sysId === uno.getTable('Dev/Task').id));
    // The row itself, read and written through the member prefix.
    const rowId = byName.items[0].id;
    const row = await json(await fetch(`${base}/w/uno/api/entities/${rowId}`));
    assert.equal(row.sysWorkspaceId, uno.state.meta.id);
    const res = await patch(`${base}/w/uno/api/entities/${rowId}`, { Name: 'Job' });
    assert.equal(res.status, 200, await res.text());
    assert.equal(uno.getTable('Dev/Job').name, 'Job');
    // The member's own rows are untouched by the fallthrough: an unknown id is still a 404.
    assert.equal((await fetch(`${base}/w/uno/api/entities/nope`)).status, 404);
    // A Spaces row created from the member page lands in the member.
    const made = await json(await post(`${base}/w/uno/api/tables/${spacesT.id}/entities`, { name: 'Ops' }));
    assert.equal(made.sysWorkspaceId, uno.state.meta.id);
    assert.ok(uno.getSpace('Ops'));
    // The same create at the root lands in the root.
    const rootMade = await json(await post(`${base}/api/tables/${spacesT.id}/entities`, { name: 'Wiki' }));
    assert.equal(rootMade.sysWorkspaceId, root.state.meta.id);
    // Stats for a member table carry the root's space rollups.
    root.addField(spacesT.id, { name: 'Job · count', type: 'rollup', config: { via: uno.getTable('Dev/Job').id, aggregate: 'count' } });
    const stats = await json(await fetch(`${base}/w/uno/api/tables/${uno.getTable('Dev/Job').id}/stats`));
    assert.equal(stats.rollups[0].name, 'Job · count');
    assert.equal(stats.rollups[0].value, 0);
  } finally {
    server.close();
  }
});
