import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer, createWorkspaceHub } from '../src/server.js';

/* Feature #219, slice b — the hub joins every workspace it holds to the
   root's registry: the ones handed in, the ones its scan adopts, and the
   ones it creates. The root is the default workspace; a member's API has no
   Workspace space; a hard delete drops the member's rows. */

const json = async (r) => r.json();
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const patch = (url, body) => fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('hub: members join the root registry; the root grid carries a Workspace column; a root row edit renames the member table', async () => {
  const root = new Weave();
  root.updateWorkspace({ name: 'root' });
  const uno = new Weave();
  uno.updateWorkspace({ name: 'uno' });
  uno.createSpace({ name: 'Dev' });
  uno.createTable({ space: 'Dev', name: 'Task' });
  const { server } = await startServer(root, { port: 0, workspaces: { uno } });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const unoSchema = await json(await fetch(`${base}/w/uno/api/schema`));
    assert.deepEqual(unoSchema.map((s) => s.space), ['Dev'], 'a member sidebar shows only its own spaces');
    const rootSchema = await json(await fetch(`${base}/api/schema`));
    const ws = rootSchema.find((s) => s.system === 'workspace');
    assert.ok(ws.tables.find((t) => t.system === 'workspaces'), 'the root has the Workspaces table');
    const tablesT = ws.tables.find((t) => t.system === 'tables');
    assert.ok(tablesT.fields.find((f) => f.name === 'Workspace'), 'Tables carries a Workspace column');
    const rows = await json(await post(`${base}/api/tables/${tablesT.id}/query`, { where: [['Name', '=', 'Task']] }));
    assert.equal(rows.total, 1);
    const row = await json(await fetch(`${base}/api/entities/${rows.items[0].id}`));
    assert.equal(row.fields.Workspace?.name ?? row.fields.Workspace, 'uno');
    assert.equal(row.sysWorkspaceId, uno.state.meta.id);
    // Rename through the root row → the member table renames.
    const res = await patch(`${base}/api/entities/${row.id}`, { Name: 'Job' });
    assert.equal(res.status, 200, await res.text());
    assert.equal(uno.getTable('Dev/Job').name, 'Job');
    // The member's own registry surface reports its slice, clean.
    const report = await json(await fetch(`${base}/w/uno/api/registry`));
    assert.deepEqual(report.problems, []);
  } finally {
    server.close();
  }
});

test('hub: adopted and created workspaces join; a hard delete drops the rows', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-rootreg-'));
  try {
    const main = new Weave({ path: join(dir, 'main.db') });
    main.updateWorkspace({ name: 'main' });
    // A sibling file on disk before the hub exists — legacy, with its own registry.
    const legacy = new Weave({ path: join(dir, 'legacy.db') });
    legacy.updateWorkspace({ name: 'legacy' });
    legacy.createSpace({ name: 'Ops' });
    legacy.createTable({ space: 'Ops', name: 'Run' });
    assert.ok(legacy.getTable('Workspace/Tables'), 'a legacy workspace minted its own registry');
    legacy.store.close?.();
    const { server } = await startServer(main, { port: 0 });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const list = await json(await fetch(`${base}/api/workspaces`));
      const leg = list.find((w) => w.name === 'legacy');
      assert.ok(leg, 'scan adopted the sibling');
      const legSchema = await json(await fetch(`${base}/w/${leg.id}/api/schema`));
      assert.deepEqual(legSchema.map((s) => s.space), ['Ops'], 'the legacy registry is tombstoned');
      const wsT = main.getTable('Workspace/Workspaces');
      const names = () => main.listEntities(wsT.id).map((e) => main.entityName(e)).sort();
      assert.deepEqual(names(), ['legacy', 'main']);
      const made = await json(await post(`${base}/api/workspaces`, { name: 'scratch' }));
      assert.equal(made.name, 'scratch');
      assert.deepEqual(names(), ['legacy', 'main', 'scratch']);
      const meta = await json(await fetch(`${base}/w/scratch/api/workspace`));
      assert.doesNotMatch(meta.description, /Workspace\* space below/, 'the fresh description no longer promises a local Workspace space');
      const scratch = list.concat(await json(await fetch(`${base}/api/workspaces`))).find((w) => w.name === 'scratch');
      await fetch(`${base}/api/workspaces/${scratch.id}?hard=1`, { method: 'DELETE' });
      assert.deepEqual(names(), ['legacy', 'main']);
      assert.ok(readdirSync(join(dir, 'trash')).some((f) => f.startsWith('scratch-')));
    } finally {
      server.close();
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('hub: a single-member hub (the worker shape) is its own root, unchanged', () => {
  const only = new Weave();
  only.createSpace({ name: 'S' });
  const hub = createWorkspaceHub(only);
  assert.equal(hub.get(hub.defaultName), only);
  assert.equal(only.registryHost, null);
  assert.ok(only.getTable('Workspace/Workspaces'));
});
