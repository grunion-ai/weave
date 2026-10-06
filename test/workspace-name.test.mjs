import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as naming from '../src/workspace-name.js';
import { Weave } from '../src/engine.js';
import { createWorkspaceHub, openDefaultWorkspace } from '../src/server.js';

const { nameFromFile, workspaceName } = naming;

const SLUG_RULE = /^[a-z0-9][a-z0-9-_]*$/i;
const tmp = () => mkdtempSync(join(tmpdir(), 'weave-wsname-'));

test('workspaceName: "Personal Workspace", slug personal-workspace, the same every time', () => {
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(workspaceName(), { name: 'Personal Workspace', slug: 'personal-workspace' });
  }
  assert.match(workspaceName().slug, SLUG_RULE);
  assert.deepEqual(Object.keys(naming).sort(), ['nameFromFile', 'workspaceName', 'workspaceSlug'], 'no word lists left behind');
});

test('workspaceName: a taken slug gets -2, -3 and so on', () => {
  assert.deepEqual(workspaceName({ taken: ['personal-workspace'] }), { name: 'Personal Workspace 2', slug: 'personal-workspace-2' });
  const third = workspaceName({ taken: ['personal-workspace', 'personal-workspace-2'] });
  assert.deepEqual(third, { name: 'Personal Workspace 3', slug: 'personal-workspace-3' });
  assert.match(third.slug, SLUG_RULE);
  assert.equal(workspaceName({ taken: ['Personal-Workspace'] }).slug, 'personal-workspace-2', 'taken is matched case-blind');
  assert.equal(workspaceName({ taken: ['other'] }).slug, 'personal-workspace');
  assert.equal(workspaceName({ taken: new Map([['personal-workspace', 1]]).keys() }).slug, 'personal-workspace-2', 'any iterable of names');
});

test('engine: a fresh workspace is seeded personal-workspace, never "Weave Workspace"', () => {
  const w = new Weave();
  assert.equal(w.state.meta.name, 'personal-workspace');
  assert.equal(w.updateWorkspace({ name: w.state.meta.name }).name, 'personal-workspace');
  assert.equal(new Weave({ name: 'acme' }).state.meta.name, 'acme', 'a caller that knows the name seeds it');
});

test('nameFromFile: a file someone named is a name asked for; the default data file is not', () => {
  assert.equal(nameFromFile('/x/other.db'), 'other');
  assert.equal(nameFromFile('./crm.json'), 'crm');
  assert.equal(nameFromFile('/data/workspace.db'), null, 'the Dockerfile and Railway default');
  assert.equal(nameFromFile('/home/k/.weave/workspace.json'), null, 'the CLI default');
  assert.equal(nameFromFile('/x/my notes.db'), null, 'a stem the rename rule refuses');
  assert.equal(nameFromFile(null), null, 'in memory');
});

test('engine: a fresh file named by its creator keeps that name (AGENTS.md: --data ./other.db)', () => {
  const dir = tmp();
  try {
    assert.equal(new Weave({ path: join(dir, 'other.db') }).state.meta.name, 'other');
    assert.equal(new Weave({ path: join(dir, 'workspace.db') }).state.meta.name, 'personal-workspace');
    const main = new Weave({ path: join(dir, 'main.db'), name: 'main' });
    assert.equal(createWorkspaceHub(main).get('other')?.state.meta.name, 'other');
    assert.equal(openDefaultWorkspace(join(dir, 'acme.db')).state.meta.name, 'acme', 'weave serve --data acme.db');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('engine: an existing workspace keeps its name, "Weave Workspace" included', () => {
  const dir = tmp();
  try {
    const path = join(dir, 'old.db');
    const w = new Weave({ path });
    w.state.meta.name = 'Weave Workspace';
    w.save();
    w.store.close?.();
    assert.equal(new Weave({ path }).state.meta.name, 'Weave Workspace', 'reopening never renames');
    assert.equal(new Weave({ path, name: 'acme' }).state.meta.name, 'Weave Workspace', 'the seed name applies to a fresh file only');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('weave serve: a fresh default workspace is personal-workspace, -2 when that name is on the instance', () => {
  const dir = tmp();
  try {
    const w = openDefaultWorkspace(join(dir, 'workspace.db'));
    assert.equal(w.state.meta.name, 'personal-workspace', 'not "workspace", the data file basename');
    w.store.close?.();
    assert.equal(openDefaultWorkspace(join(dir, 'workspace.db')).state.meta.name, 'personal-workspace', 'a restart keeps it');

    const dir2 = tmp();
    try {
      writeFileSync(join(dir2, 'personal-workspace.db'), '');
      assert.equal(openDefaultWorkspace(join(dir2, 'workspace.db')).state.meta.name, 'personal-workspace-2');
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('weave serve: existing workspaces keep the names they carry', () => {
  const dir = tmp();
  try {
    const legacy = new Weave({ path: join(dir, 'acme.db') });
    legacy.state.meta.name = 'Weave Workspace';
    legacy.save();
    legacy.store.close?.();
    assert.equal(openDefaultWorkspace(join(dir, 'acme.db')).state.meta.name, 'acme');
    const served = new Weave({ path: join(dir, 'workspace.db') });
    served.state.meta.name = 'workspace';
    served.save();
    served.store.close?.();
    assert.equal(openDefaultWorkspace(join(dir, 'workspace.db')).state.meta.name, 'workspace');
    const drawn = new Weave({ path: join(dir, 'drawn.db'), name: 'quiet-turtle' });
    drawn.save();
    drawn.store.close?.();
    assert.equal(openDefaultWorkspace(join(dir, 'drawn.db')).state.meta.name, 'quiet-turtle');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hub: a sibling file still named "Weave Workspace" is adopted under its file name', () => {
  const dir = tmp();
  try {
    const main = new Weave({ path: join(dir, 'main.db') });
    main.state.meta.name = 'main';
    main.save();
    const side = new Weave({ path: join(dir, 'side.db') });
    side.state.meta.name = 'Weave Workspace';
    side.save();
    side.store.close?.();
    const hub = createWorkspaceHub(main);
    assert.equal(hub.get('side')?.state.meta.name, 'side');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hub: workspaces created with no name are personal-workspace, then -2, then -3', () => {
  const dir = tmp();
  try {
    const main = new Weave({ path: join(dir, 'main.db') });
    main.state.meta.name = 'main';
    main.save();
    const hub = createWorkspaceHub(main);
    assert.equal(hub.create().state.meta.name, 'personal-workspace', 'not "undefined"');
    assert.equal(hub.create(undefined).state.meta.name, 'personal-workspace-2');
    assert.equal(hub.create('').state.meta.name, 'personal-workspace-3');
    assert.ok(hub.get('personal-workspace') && hub.get('personal-workspace-2'), 'each answers at its slug');
    assert.equal(hub.create('named').state.meta.name, 'named', 'an explicit name is kept');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hub: the default workspace weave serve opens holds personal-workspace, so the next unnamed one is -2', () => {
  const dir = tmp();
  try {
    const main = openDefaultWorkspace(join(dir, 'workspace.db'));
    const hub = createWorkspaceHub(main);
    assert.equal(hub.create().state.meta.name, 'personal-workspace-2');
    assert.equal(hub.create().state.meta.name, 'personal-workspace-3');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
