import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { createWorkspaceHub, startServer } from '../src/server.js';
import { workspaceSlug } from '../src/workspace-name.js';

/* A workspace carries a display name a person reads and a slug its URL
   answers at (Issue #592): renaming to "Personal finance" was refused with
   "Workspace name must be alphanumeric" while the old seed name "Weave
   Workspace" had a space. Slugs are case-blind, like Slack, Notion and GitHub
   (Issue #599): on a case-sensitive volume "Acme" and "acme" became two
   workspaces, two files and two URLs. Existing files are never renamed. */

const tmp = () => mkdtempSync(join(tmpdir(), 'weave-wsslug-'));

test('workspaceSlug: a display name folds to lowercase letters, digits, - and _', () => {
  assert.equal(workspaceSlug('Personal finance'), 'personal-finance');
  assert.equal(workspaceSlug('Acme'), 'acme');
  assert.equal(workspaceSlug('  Café & Co.  '), 'cafe-co');
  assert.equal(workspaceSlug('ops_hub-2'), 'ops_hub-2');
  assert.equal(workspaceSlug('***'), '', 'nothing usable left');
});

test('engine: renaming to a display name keeps it and derives the slug (Issue #592)', () => {
  const w = new Weave();
  const got = w.updateWorkspace({ name: 'Personal finance' });
  assert.equal(got.name, 'personal-finance', 'name is the slug the URL answers at');
  assert.equal(got.title, 'Personal finance', 'title is what a person reads');
  assert.deepEqual([w.getWorkspace().name, w.getWorkspace().title], ['personal-finance', 'Personal finance']);
  assert.equal(w.updateWorkspace({ name: 'sales' }).title, 'sales', 'a bare slug is its own title');
  assert.throws(() => w.updateWorkspace({ name: '***' }), /letters, digits, - and _/, 'the refusal names the rule');
  assert.equal(new Weave().getWorkspace().title, 'personal-workspace', 'a workspace with no title reads as its slug');
});

test('hub: a case variant of a held slug is the same workspace (Issue #599)', () => {
  const dir = tmp();
  try {
    const main = new Weave({ path: join(dir, 'main.db'), name: 'main' });
    const hub = createWorkspaceHub(main);
    const acme = hub.create('acme');
    assert.equal(hub.get('ACME'), acme, 'any casing resolves');
    assert.throws(() => hub.create('Acme'), (e) => e.code === 'conflict');
    const team = hub.create('Acme Team');
    assert.deepEqual([team.state.meta.name, team.getWorkspace().title], ['acme-team', 'Acme Team']);
    assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.db')).sort(), ['acme-team.db', 'acme.db', 'main.db']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hub: an existing mixed-case workspace keeps its file and its slug, and owns its case variants', () => {
  const dir = tmp();
  try {
    const old = new Weave({ path: join(dir, 'Acme.db'), name: 'Acme' });
    old.save();
    old.store.close?.();
    const main = new Weave({ path: join(dir, 'main.db'), name: 'main' });
    const hub = createWorkspaceHub(main);
    const held = hub.get('Acme');
    assert.equal(held?.state.meta.name, 'Acme', 'the slug it carries still resolves');
    assert.equal(hub.get('acme'), held, 'and so does its lowercase');
    assert.throws(() => hub.create('acme'), (e) => e.code === 'conflict');
    assert.ok(readdirSync(dir).includes('Acme.db') && !readdirSync(dir).includes('acme.db'), 'no file renamed or added');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('HTTP + MCP: rename to a display name re-keys the hub; a case variant of another slug is refused', async () => {
  const dir = tmp();
  const main = new Weave({ path: join(dir, 'main.db'), name: 'main' });
  const { server } = await startServer(main, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const mcp = (ws, args) => call('POST', `/w/${ws}/api/mcp`, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'weave_workspace', arguments: { action: 'update', ...args } } });
  try {
    assert.equal((await call('POST', '/api/workspaces', { name: 'acme' })).status, 201);
    assert.equal((await call('POST', '/api/workspaces', { name: 'Acme' })).status, 409);
    assert.equal((await call('POST', '/api/workspaces', { name: 'other' })).status, 201);

    const patched = await call('PATCH', '/w/other/api/workspace', { name: 'Personal finance' });
    assert.equal(patched.status, 200);
    assert.deepEqual([patched.body.name, patched.body.title], ['personal-finance', 'Personal finance']);
    assert.equal((await call('GET', '/w/personal-finance/api/workspace')).body.title, 'Personal finance');
    assert.equal((await call('PATCH', '/w/personal-finance/api/workspace', { name: 'ACME' })).status, 409);

    // The tool the Issue was found on renames through the hub too.
    const viaMcp = await mcp('personal-finance', { name: 'Household Budget' });
    assert.equal(viaMcp.body.result.isError, undefined, JSON.stringify(viaMcp.body));
    assert.equal((await call('GET', '/w/household-budget/api/workspace')).body.title, 'Household Budget');
    const clash = await mcp('household-budget', { name: 'Acme' });
    assert.equal(clash.body.result.isError, true, 'a clash is refused over MCP as over REST');
    assert.equal((await call('GET', '/w/household-budget/api/workspace')).status, 200, 'and changed nothing');
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
