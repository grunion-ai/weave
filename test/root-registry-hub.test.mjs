import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer, createWorkspaceHub } from '../src/server.js';
import { tempDir } from './lib/temp.mjs';

const json = async (r) => r.json();
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const patch = (url, body) => fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('hub: each workspace owns its registry and registry edits stay local', async () => {
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
    assert.ok(unoSchema.some(s => s.system === 'workspace'));
    assert.ok(unoSchema.some(s => s.space === 'Dev'));
    const rootSchema = await json(await fetch(`${base}/api/schema`));
    const ws = unoSchema.find((s) => s.system === 'workspace');
    assert.ok(ws.tables.find((t) => t.system === 'workspaces'), 'the root has the Workspaces table');
    const tablesT = ws.tables.find((t) => t.system === 'tables');
    assert.ok(tablesT.fields.find((f) => f.name === 'Workspace'), 'Tables carries a Workspace column');
    const rows = await json(await post(`${base}/w/uno/api/tables/${tablesT.id}/query`, { where: [['Name', '=', 'Task']] }));
    assert.equal(rows.total, 1);
    const row = await json(await fetch(`${base}/w/uno/api/entities/${rows.items[0].id}`));
    assert.equal(row.fields.Workspace?.name ?? row.fields.Workspace, 'uno');
    assert.equal(row.sysWorkspaceId, uno.state.meta.id);
    const res = await patch(`${base}/w/uno/api/entities/${row.id}`, { Name: 'Job' });
    assert.equal(res.status, 200, await res.text());
    assert.equal(uno.getTable('Dev/Job').name, 'Job');
    assert.equal(rootSchema.some(s => s.tables.some(t => t.name === 'Job' || t.name === 'Task')), false);
    assert.equal((await fetch(`${base}/api/entities/${row.id}`)).status, 404);
    const report = await json(await fetch(`${base}/w/uno/api/registry`));
    assert.deepEqual(report.problems, []);
  } finally {
    server.close();
  }
});

test('hub: adopted and created workspaces keep local registries through their lifecycle', async () => {
  const dir = tempDir('weave-rootreg-');
  try {
    const main = new Weave({ path: join(dir, 'main.db') });
    main.updateWorkspace({ name: 'main' });
    const legacy = new Weave({ path: join(dir, 'legacy.db') });
    legacy.updateWorkspace({ name: 'legacy' });
    legacy.createSpace({ name: 'Ops' });
    legacy.createTable({ space: 'Ops', name: 'Run' });
    assert.ok(legacy.getTable('System/Tables'), 'a legacy workspace minted its own registry');
    legacy.store.close?.();
    const { server } = await startServer(main, { port: 0 });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const list = await json(await fetch(`${base}/api/workspaces`));
      const leg = list.find((w) => w.name === 'legacy');
      assert.ok(leg, 'scan adopted the sibling');
      const legSchema = await json(await fetch(`${base}/w/${leg.id}/api/schema`));
      assert.ok(legSchema.some(s => s.space === 'Ops'));
      assert.ok(legSchema.some(s => s.system === 'workspace'));
      const wsT = main.getTable('System/Workspaces');
      const names = () => main.listEntities(wsT.id).map((e) => main.entityName(e)).sort();
      assert.deepEqual(names(), ['main']);
      const made = await json(await post(`${base}/api/workspaces`, { name: 'scratch' }));
      assert.equal(made.name, 'scratch');
      assert.deepEqual(names(), ['main']);
      const meta = await json(await fetch(`${base}/w/scratch/api/workspace`));
      assert.equal(meta.name, 'scratch');
      const scratch = list.concat(await json(await fetch(`${base}/api/workspaces`))).find((w) => w.name === 'scratch');
      const wsRow = async () => json(await fetch(`${base}/w/scratch/api/workspace`));
      await fetch(`${base}/api/workspaces/${scratch.id}`, { method: 'DELETE' });
      assert.equal((await json(await fetch(`${base}/api/workspaces`))).some(w => w.name === 'scratch'), false);
      assert.deepEqual(names(), ['main']);
      await post(`${base}/api/workspaces/${scratch.id}/restore`, {});
      assert.equal((await wsRow()).name, 'scratch');
      await fetch(`${base}/api/workspaces/${scratch.id}?hard=1`, { method: 'DELETE' });
      assert.deepEqual(names(), ['main']);
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
  assert.ok(only.getTable('System/Workspaces'));
});
