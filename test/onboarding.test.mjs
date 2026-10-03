/* Feature #248 — onboarding: a short welcome that starts by naming the first
   workspace. The welcome runs once per person, on an instance where that
   person has built nothing yet; it names the workspace they are in (a
   default arrives filled in), optionally builds a starter through
   starter-core's steps(), and remembers that it ran, finished or skipped.

   Who "the person" is: the signed-in account (a session or a Bearer token),
   whose row carries the mark; with nobody signed in (a loopback instance
   with no sign-in) the hub root's own meta carries it. The trigger:
     not onboarded
     AND may rename this workspace (no role, or architect)
     AND this workspace has no tables of its own
     AND no other workspace the person can open has any, the weave docs
         workspace aside (it ships with its own).
   An existing person with a populated workspace never sees it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { seedWeaver } from '../src/weaver-seed.js';

await import('../public/starter-core.js');
const S = globalThis.WeaveStarters;

test('workspaceName keeps a valid name and folds the rest into one', () => {
  assert.equal(S.workspaceName('main'), 'main');
  assert.equal(S.workspaceName('Uno'), 'Uno', 'a name the engine accepts is kept as typed');
  assert.equal(S.workspaceName('  acme-team  '), 'acme-team');
  assert.equal(S.workspaceName('Acme Team'), 'acme-team');
  assert.equal(S.workspaceName("Kyle's  Café!"), 'kyles-cafe');
  assert.equal(S.workspaceName('--x--'), 'x');
  assert.equal(S.workspaceName('!!!'), '');
  assert.equal(S.workspaceName(''), '');
  assert.equal(S.workspaceName(null), '');
  assert.ok(S.workspaceName('a'.repeat(200)).length <= 48);
  for (const n of ['Acme Team', "Kyle's  Café!", '--x--', 'a'.repeat(200)]) {
    assert.match(S.workspaceName(n), /^[a-z0-9][a-z0-9-_]*$/i, n);
  }
});

test('the engine keeps the mark: on the account row, or on the workspace with nobody signed in', () => {
  const w = new Weave();
  const { account } = w.createAccount({ name: 'kyle', role: 'architect' });
  assert.equal(w.onboardedAt(), null);
  assert.equal(w.onboardedAt(account.id), null);
  w.markOnboarded(account.id);
  assert.ok(w.onboardedAt(account.id), 'the account is onboarded');
  assert.equal(w.onboardedAt(), null, 'the anonymous mark is separate');
  const first = w.onboardedAt(account.id);
  w.markOnboarded(account.id);
  assert.equal(w.onboardedAt(account.id), first, 'a second mark keeps the first time');
  w.markOnboarded();
  assert.ok(w.onboardedAt());
  assert.throws(() => w.markOnboarded('nope'), /not found/);
});

/* A fresh self-hosted install: the root workspace (named for its data file)
   beside the seeded weave docs workspace. The docs workspace is seeded once
   and copied: seeding it takes seconds. */
const DOCS = join(mkdtempSync(join(tmpdir(), 'weave-onboard-docs-')), 'weave.db');
seedWeaver(new Weave({ path: DOCS })).store.close?.();
test.after(() => rmSync(join(DOCS, '..'), { recursive: true, force: true }));
async function fresh({ seed = () => {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'weave-onboard-'));
  const root = new Weave({ path: join(dir, 'workspace.db') });
  root.state.meta.name = 'workspace';
  root.save();
  copyFileSync(DOCS, join(dir, 'weave.db'));
  await seed(root, dir);
  const { server } = await startServer(root, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { dir, root, base, call, close: () => { server.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('a fresh instance shows the welcome, with the workspace\'s own name as the default', async () => {
  const f = await fresh();
  try {
    const r = await f.call('GET', '/api/onboarding');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { show: true, name: 'workspace' });
  } finally { f.close(); }
});

test('skip keeps the default name, builds nothing, and the mark survives a restart', async () => {
  const f = await fresh();
  try {
    const r = await f.call('POST', '/api/onboarding', {});
    assert.equal(r.status, 200);
    assert.equal(r.body.name, 'workspace');
    assert.equal(r.body.table, null);
    assert.equal(f.root.userTables().length, 0, 'nothing half made');
    assert.equal((await f.call('GET', '/api/onboarding')).body.show, false, 'it ran');
    const reopened = new Weave({ path: join(f.dir, 'workspace.db') });
    assert.ok(reopened.onboardedAt(), 'stored in the workspace file, not the page');
    reopened.store.close?.();
  } finally { f.close(); }
});

test('the rename path stores the typed name, folded to a workspace name, and the hub follows', async () => {
  const f = await fresh();
  try {
    const r = await f.call('POST', '/api/onboarding', { name: 'Acme Team' });
    assert.equal(r.status, 200);
    assert.equal(r.body.name, 'acme-team');
    assert.equal(r.body.url, `/w/${f.root.state.meta.id}/`);
    assert.equal((await f.call('GET', '/api/workspace')).body.name, 'acme-team');
    const list = (await f.call('GET', '/api/workspaces')).body;
    assert.ok(list.find((x) => x.name === 'acme-team' && x.default), 'the default workspace answers to its new name');
    // Renaming from the rail still works after onboarding.
    const again = await f.call('PATCH', '/api/workspace', { name: 'acme' });
    assert.equal(again.body.name, 'acme');
  } finally { f.close(); }
});

test('the starter path builds the template through steps() and names its first table', async () => {
  const f = await fresh();
  try {
    const r = await f.call('POST', '/api/onboarding', { name: 'home', template: 'tasks' });
    assert.equal(r.status, 200);
    const tasks = f.root.findTable('Work/Tasks');
    assert.ok(tasks, 'Work/Tasks exists');
    assert.equal(r.body.table, tasks.id);
    assert.equal(f.root.findField(tasks, 'Status')?.type, 'workflow');
    assert.equal(r.body.name, 'home');
    const crm = await fresh();
    try {
      const c = await crm.call('POST', '/api/onboarding', { template: 'crm' });
      assert.equal(crm.root.findField(crm.root.findTable('CRM/Contacts'), 'Company')?.type, 'relation', 'relations too');
      assert.equal(c.body.table, crm.root.findTable('CRM/Companies').id, 'the first table of the template');
    } finally { crm.close(); }
    assert.equal((await f.call('POST', '/api/onboarding', { template: 'nope' })).status, 400);
  } finally { f.close(); }
});

test('a taken name is refused before anything is built or marked', async () => {
  const f = await fresh();
  try {
    const r = await f.call('POST', '/api/onboarding', { name: 'weave', template: 'tasks' });
    assert.equal(r.status, 409);
    assert.equal(f.root.userTables().length, 0, 'no template');
    assert.equal(f.root.onboardedAt(), null, 'not marked');
    assert.equal((await f.call('GET', '/api/onboarding')).body.show, true);
  } finally { f.close(); }
});

test('an existing person with a workspace of their own never sees it', async () => {
  const populated = await fresh({ seed: (root) => { root.createSpace({ name: 'Ops' }); root.createTable({ space: 'Ops', name: 'Runbook' }); } });
  try {
    assert.equal((await populated.call('GET', '/api/onboarding')).body.show, false, 'tables in this workspace');
  } finally { populated.close(); }
  // An empty root beside a populated sibling: they already have a workspace.
  const sibling = await fresh({
    seed: (root, dir) => {
      const uno = new Weave({ path: join(dir, 'uno.db') });
      uno.state.meta.name = 'uno';
      uno.createSpace({ name: 'Main' });
      uno.createTable({ space: 'Main', name: 'Item' });
      uno.store.close?.();
    },
  });
  try {
    assert.equal((await sibling.call('GET', '/api/onboarding')).body.show, false, 'tables in another workspace');
    assert.equal((await sibling.call('GET', '/w/uno/api/onboarding')).body.show, false);
  } finally { sibling.close(); }
  // The docs workspace itself never offers it.
  const f = await fresh();
  try {
    assert.equal((await f.call('GET', '/w/weave/api/onboarding')).body.show, false);
  } finally { f.close(); }
});

test('once per person: each account carries its own mark, and its first name is the default', async () => {
  let kyle, maya;
  const f = await fresh({
    seed: (root) => {
      kyle = root.createAccount({ name: 'Kyle Adriany', role: 'architect' });
      maya = root.createAccount({ name: 'maya', role: 'architect' });
    },
  });
  const as = (who) => ({ Authorization: `Bearer ${who.token}` });
  try {
    assert.deepEqual((await f.call('GET', '/api/onboarding', undefined, as(kyle))).body, { show: true, name: 'kyle' });
    const done = await f.call('POST', '/api/onboarding', {}, as(kyle));
    assert.equal(done.body.name, 'kyle', 'skip keeps the default, the account\'s first name');
    assert.ok(f.root.onboardedAt(kyle.account.id), 'on the account row');
    assert.equal(f.root.onboardedAt(), null, 'not on the workspace');
    assert.equal((await f.call('GET', '/api/onboarding', undefined, as(kyle))).body.show, false);
    // Maya has not been onboarded, and the instance is still empty.
    assert.equal((await f.call('GET', '/api/onboarding', undefined, as(maya))).body.show, true);
    // A session minted at sign-in counts the same as the token.
    const minted = f.root.createSession(maya.account.id, { ua: 'test' });
    const cookie = { Cookie: `wv_session=${minted.token}` };
    assert.equal((await f.call('GET', '/api/onboarding', undefined, cookie)).body.show, true);
    await f.call('POST', '/api/onboarding', { name: 'maya-team' }, cookie);
    assert.ok(f.root.onboardedAt(maya.account.id));
    assert.equal((await f.call('GET', '/api/onboarding', undefined, as(maya))).body.show, false);
  } finally { f.close(); }
});

test('a person who cannot rename the workspace is never asked, and cannot post it', async () => {
  let writer, reader;
  const f = await fresh({
    seed: (root) => {
      root.createAccount({ name: 'admin', role: 'architect' });
      writer = root.createAccount({ name: 'wendy', role: 'editor' });
      reader = root.createAccount({ name: 'rita', role: 'observer' });
    },
  });
  try {
    for (const who of [writer, reader]) {
      const h = { Authorization: `Bearer ${who.token}` };
      assert.equal((await f.call('GET', '/api/onboarding', undefined, h)).body.show, false, who.account.name);
      assert.equal((await f.call('POST', '/api/onboarding', {}, h)).status, 403, who.account.name);
    }
    assert.equal(f.root.state.meta.name, 'workspace');
  } finally { f.close(); }
});
