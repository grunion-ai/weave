import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADJECTIVES, ANIMALS, nameFromFile, workspaceName } from '../src/workspace-name.js';
import { Weave } from '../src/engine.js';
import { createWorkspaceHub, openDefaultWorkspace } from '../src/server.js';

/* A new workspace is named at random, adjective then animal (Issue #594):
   display name "Quiet Turtle", slug quiet-turtle. Before this, a fresh
   workspace was seeded 'Weave Workspace' and `weave serve` renamed it to the
   data file's basename, so a stock install read "workspace" everywhere. */

const SLUG_RULE = /^[a-z0-9][a-z0-9-_]*$/i; // engine.js updateWorkspace, hub.create
// The animal icons upstream Lucide ships (lucide-static, checked 2026-10-02).
// rat, worm, shrimp and bug are left out on purpose: next to an adjective
// they read as a jab. Lucide's `mouse` is the computer mouse.
const LUCIDE_ANIMALS = ['bird', 'cat', 'dog', 'fish', 'panda', 'rabbit', 'snail', 'squirrel', 'turtle'];
// Fixed draws: index 0 of each list.
const first = () => 0;
const tmp = () => mkdtempSync(join(tmpdir(), 'weave-wsname-'));

test('workspaceName: Title Case display name, kebab-case slug that passes the rename rule', () => {
  for (let i = 0; i < 200; i++) {
    const { name, slug, animal } = workspaceName();
    assert.match(name, /^[A-Z][a-z]+ [A-Z][a-z]+$/, `display name "${name}" capitalizes both words`);
    assert.match(slug, /^[a-z]+-[a-z]+$/, `slug "${slug}" is lower kebab case`);
    assert.match(slug, SLUG_RULE);
    assert.equal(name.toLowerCase().replace(' ', '-'), slug, 'name and slug are the same two words');
    assert.ok(ANIMALS.includes(animal) && slug.endsWith(`-${animal}`), 'the animal is reported for the icon');
  }
  const { name, slug } = workspaceName({ random: first });
  assert.equal(slug, `${ADJECTIVES[0]}-${ANIMALS[0]}`);
  assert.equal(name, `${ADJECTIVES[0][0].toUpperCase()}${ADJECTIVES[0].slice(1)} ${ANIMALS[0][0].toUpperCase()}${ANIMALS[0].slice(1)}`);
});

test('workspaceName: curated lists, animals limited to Lucide animal icons', () => {
  assert.ok(ADJECTIVES.length >= 20 && ANIMALS.length >= 8, 'enough pairs that two installs rarely match');
  for (const list of [ADJECTIVES, ANIMALS]) {
    assert.equal(new Set(list).size, list.length, 'no duplicates');
    for (const word of list) assert.match(word, /^[a-z]+$/, `"${word}" is one lower-case word`);
  }
  for (const a of ANIMALS) assert.ok(LUCIDE_ANIMALS.includes(a), `"${a}" has a Lucide icon of the same name`);
  // Neutral or positive only: nothing that turns a pair into an insult.
  const unkind = ['slow', 'lazy', 'dumb', 'fat', 'ugly', 'old', 'silly', 'sly', 'dirty', 'smelly', 'grumpy', 'angry', 'sad', 'sick', 'weird', 'wild', 'crazy', 'tiny', 'little', 'big', 'odd', 'mad', 'stinky', 'scared'];
  for (const a of ADJECTIVES) assert.ok(!unkind.includes(a), `"${a}" can read as an insult`);
});

test('workspaceName: a taken slug gets -2, -3 and so on', () => {
  const base = `${ADJECTIVES[0]}-${ANIMALS[0]}`;
  assert.equal(workspaceName({ random: first, taken: [base] }).slug, `${base}-2`);
  const third = workspaceName({ random: first, taken: [base, `${base}-2`] });
  assert.equal(third.slug, `${base}-3`);
  assert.match(third.slug, SLUG_RULE);
  assert.match(third.name, / 3$/, 'the display name carries the number too');
  assert.equal(workspaceName({ random: first, taken: [base.toUpperCase()] }).slug, `${base}-2`, 'taken is matched case-blind');
  assert.equal(workspaceName({ random: first, taken: ['other'] }).slug, base);
});

test('engine: a fresh workspace is seeded with a generated slug, never "Weave Workspace"', () => {
  const names = new Set();
  for (let i = 0; i < 20; i++) {
    const w = new Weave();
    assert.notEqual(w.state.meta.name, 'Weave Workspace');
    assert.match(w.state.meta.name, /^[a-z]+-[a-z]+$/);
    names.add(w.state.meta.name);
    // The name the seed picked is one updateWorkspace would accept.
    assert.equal(w.updateWorkspace({ name: w.state.meta.name }).name, w.state.meta.name);
  }
  assert.ok(names.size > 1, 'names vary between workspaces');
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
    assert.match(new Weave({ path: join(dir, 'workspace.db') }).state.meta.name, /^[a-z]+-[a-z]+$/);
    // Dropped beside a running hub, it answers at its file name, as before.
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

test('weave serve: a fresh default workspace gets a generated name, skipping names on the instance', () => {
  const dir = tmp();
  try {
    const w = openDefaultWorkspace(join(dir, 'workspace.db'));
    assert.match(w.state.meta.name, /^[a-z]+-[a-z]+$/, 'not "workspace", the data file basename');
    w.store.close?.();
    assert.equal(openDefaultWorkspace(join(dir, 'workspace.db')).state.meta.name, w.state.meta.name, 'a restart keeps it');

    const base = `${ADJECTIVES[0]}-${ANIMALS[0]}`;
    const dir2 = tmp();
    try {
      writeFileSync(join(dir2, `${base}.db`), '');
      assert.equal(openDefaultWorkspace(join(dir2, 'workspace.db'), { random: first }).state.meta.name, `${base}-2`);
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
    // Never served: still seeded "Weave Workspace" → the basename, as before.
    const legacy = new Weave({ path: join(dir, 'acme.db') });
    legacy.state.meta.name = 'Weave Workspace';
    legacy.save();
    legacy.store.close?.();
    assert.equal(openDefaultWorkspace(join(dir, 'acme.db')).state.meta.name, 'acme');
    // Served before this change: named "workspace", and it stays that.
    const served = new Weave({ path: join(dir, 'workspace.db') });
    served.state.meta.name = 'workspace';
    served.save();
    served.store.close?.();
    assert.equal(openDefaultWorkspace(join(dir, 'workspace.db')).state.meta.name, 'workspace');
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

test('hub: creating a workspace with no name generates one, -2 on a collision', () => {
  const dir = tmp();
  const realRandom = Math.random;
  try {
    const main = new Weave({ path: join(dir, 'main.db') });
    main.state.meta.name = 'main';
    main.save();
    const hub = createWorkspaceHub(main);
    Math.random = first;
    const base = `${ADJECTIVES[0]}-${ANIMALS[0]}`;
    assert.equal(hub.create().state.meta.name, base, 'not "undefined"');
    assert.equal(hub.create(undefined).state.meta.name, `${base}-2`);
    assert.equal(hub.create('').state.meta.name, `${base}-3`);
    Math.random = realRandom;
    assert.ok(hub.get(base) && hub.get(`${base}-2`), 'each answers at its slug');
    assert.equal(hub.create('named').state.meta.name, 'named', 'an explicit name is kept');
  } finally {
    Math.random = realRandom;
    rmSync(dir, { recursive: true, force: true });
  }
});
