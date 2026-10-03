/* Kyle's three roles (2026-10-02): "Observer (free) can only view and
   comment, Editor (paid seat) can view and create/edit entities, Architect
   (paid) everything including create delete edit workspace spaces tables,
   field definitions". They replace reader / writer / admin, which stay
   accepted as input for one release and are rewritten on every open. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.env.WEAVE_KEYSTORE = join(mkdtempSync(join(tmpdir(), 'weave-ks-')), 'keystore.json');
const { Weave } = await import('../src/engine.js');
const { createWorkspaceHub } = await import('../src/server.js');
const { createRequestHandler } = await import('../src/routes.js');
const { dispatchTool } = await import('../src/mcp.js');

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');

function client(hub) {
  const handle = createRequestHandler(hub, { version: 'test' });
  return async (method, path, { body, token } = {}) => {
    const url = new URL(path, 'http://localhost:4400');
    const headers = { host: 'localhost:4400', ...(token ? { authorization: `Bearer ${token}` } : {}) };
    const res = await handle({
      method, path: decodeURIComponent(url.pathname), searchParams: url.searchParams,
      header: (n) => headers[n.toLowerCase()], readBody: async () => body ?? {}, remote: '127.0.0.1',
    });
    let json = null;
    try { json = JSON.parse(res.body); } catch { /* not json */ }
    return { status: res.status, json };
  };
}

function build() {
  const w = new Weave();
  w.updateWorkspace({ name: 'ws' });
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  const row = w.createEntity('Dev/Task', { name: 'one' });
  const tid = w.findTable('Dev/Task').id;
  const t = {
    architect: w.createAccount({ name: 'arc', role: 'architect' }).token,
    editor: w.createAccount({ name: 'ed', role: 'editor' }).token,
    observer: w.createAccount({ name: 'ob', role: 'observer' }).token,
  };
  w.setRequireAuth(true);
  return { w, call: client(createWorkspaceHub(w)), row, t, tid };
}

test('engine: three roles, Editor by default, a billing label each', () => {
  assert.deepEqual(Weave.ROLES, ['architect', 'editor', 'observer']);
  assert.deepEqual(Weave.ROLE_LABELS, { architect: 'Architect, paid', editor: 'Editor, paid seat', observer: 'Observer, free' });
  const w = new Weave();
  assert.equal(w.createAccount({ name: 'x' }).account.role, 'editor');
  assert.throws(() => w.createAccount({ name: 'y', role: 'owner' }), /Invalid role 'owner' \(architect, editor, observer\)/);
});

test('engine: the old names are input aliases, stored under the new name with a deprecation note', () => {
  const w = new Weave();
  for (const [old, now] of [['admin', 'architect'], ['writer', 'editor'], ['reader', 'observer']]) {
    const made = w.createAccount({ name: old, role: old });
    assert.equal(made.account.role, now, old);
    assert.match(made.note, new RegExp(`'${old}' is now '${now}'`), old);
    assert.equal(w.listAccounts().find((a) => a.name === old).role, now);
  }
  assert.equal(w.createAccount({ name: 'fresh', role: 'editor' }).note, undefined, 'a new name carries no note');
});

test('migration: an account and its wv_ token stored under an old role name are rewritten on open, and the token keeps working', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-roles-'));
  try {
    const path = join(dir, 'w.db');
    const a = new Weave({ path });
    const tokens = {};
    for (const [name, role] of [['boss', 'architect'], ['bot', 'editor'], ['eye', 'observer']]) tokens[name] = a.createAccount({ name, role }).token;
    // What a pre-rename weave left on disk.
    const old = { boss: 'admin', bot: 'writer', eye: 'reader' };
    for (const acc of Object.values(a.state.meta.accounts)) acc.role = old[acc.name];
    a.save();
    a.store.close?.();
    const b = new Weave({ path });
    assert.deepEqual(Object.fromEntries(b.listAccounts().map((x) => [x.name, x.role])), { boss: 'architect', bot: 'editor', eye: 'observer' });
    assert.equal(b.verifyToken(tokens.bot).role, 'editor');
    assert.equal(b.verifyToken(tokens.boss).role, 'architect');
    b.store.close?.();
    // The rewrite was saved, not just read through.
    const c = new Weave({ path });
    assert.deepEqual(Object.values(c.state.meta.accounts).map((x) => x.role).sort(), ['architect', 'editor', 'observer']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('migration: an import that carries the old names lands the new ones', () => {
  const w = new Weave();
  w.createAccount({ name: 'k', role: 'admin' });
  const dump = w.exportJSON();
  for (const acc of Object.values(dump.meta.accounts)) acc.role = 'admin';
  const v = new Weave();
  v.importJSON(dump);
  assert.equal(v.listAccounts()[0].role, 'architect');
});

test('routes: an old role name still on a row is read as its new name (an older process beside the server)', async () => {
  const { w, call, t, tid } = build();
  Object.values(w.state.meta.accounts).find((a) => a.name === 'ed').role = 'writer';
  assert.equal((await call('POST', `/api/tables/${tid}/entities`, { token: t.editor, body: { name: 'two' } })).status, 201);
  assert.equal((await call('POST', '/api/spaces', { token: t.editor, body: { name: 'Nope' } })).status, 403);
  Object.values(w.state.meta.accounts).find((a) => a.name === 'arc').role = 'admin';
  assert.equal((await call('GET', '/api/accounts', { token: t.architect })).status, 200);
});

test('observer: reads, comments, deletes only its own comment, and writes nothing else', async () => {
  const { w, call, row, t, tid } = build();
  assert.equal((await call('GET', `/api/entities/${row.id}`, { token: t.observer })).status, 200);
  assert.equal((await call('POST', `/api/tables/${tid}/query`, { token: t.observer, body: {} })).status, 200);
  const mine = await call('POST', `/api/entities/${row.id}/comments`, { token: t.observer, body: { author: 'someone else', text: 'looks right' } });
  assert.equal(mine.status, 201);
  assert.equal(mine.json.author, 'ob', 'an observer comments as itself');
  const theirs = await call('POST', `/api/entities/${row.id}/comments`, { token: t.editor, body: { author: 'ed', text: 'mine' } });
  assert.equal(theirs.status, 201);
  assert.equal((await call('DELETE', `/api/entities/${row.id}/comments/${theirs.json.id}`, { token: t.observer })).status, 403);
  assert.equal((await call('DELETE', `/api/entities/${row.id}/comments/${mine.json.id}`, { token: t.observer })).status, 200);
  assert.deepEqual(w.getEntity(row.id).comments.map((c) => c.text), ['mine']);
  for (const [method, path, body] of [
    ['POST', `/api/tables/${tid}/entities`, { name: 'two' }],
    ['PATCH', `/api/entities/${row.id}`, { name: 'renamed' }],
    ['DELETE', `/api/entities/${row.id}`, null],
    ['POST', '/api/undo', {}],
    ['POST', '/api/spaces', { name: 'S' }],
  ]) assert.equal((await call(method, path, { token: t.observer, body })).status, 403, `${method} ${path}`);
  assert.equal(w.getEntity(row.id).name ?? w.entityName(w.getEntity(row.id)), 'one');
});

test('a role weave does not know is held to what an observer may do', async () => {
  const { w, call, row, t, tid } = build();
  Object.values(w.state.meta.accounts).find((a) => a.name === 'ob').role = 'owner';
  assert.equal((await call('POST', `/api/tables/${tid}/entities`, { token: t.observer, body: { name: 'x' } })).status, 403);
  const c = await call('POST', `/api/entities/${row.id}/comments`, { token: t.observer, body: { author: 'k', text: 'hi' } });
  assert.equal(c.json.author, 'ob');
});

test('editor: entities and comments, never structure', async () => {
  const { w, call, row, t, tid } = build();
  const made = await call('POST', `/api/tables/${tid}/entities`, { token: t.editor, body: { name: 'two' } });
  assert.equal(made.status, 201);
  assert.equal((await call('PATCH', `/api/entities/${made.json.id}`, { token: t.editor, body: { name: 'two!' } })).status, 200);
  assert.equal((await call('DELETE', `/api/entities/${made.json.id}`, { token: t.editor })).status, 200);
  const c = await call('POST', `/api/entities/${row.id}/comments`, { token: t.editor, body: { author: 'ed', text: 'hi' } });
  assert.equal(c.status, 201);
  const oc = await call('POST', `/api/entities/${row.id}/comments`, { token: t.observer, body: { text: 'obs' } });
  assert.equal((await call('DELETE', `/api/entities/${row.id}/comments/${oc.json.id}`, { token: t.editor })).status, 200, 'an editor may clear any comment');
  const before = JSON.stringify(w.describeSchema());
  for (const [method, path, body] of [
    ['POST', '/api/workspaces', { name: 'other' }],
    ['DELETE', '/api/workspaces/ws', null],
    ['PATCH', '/api/workspace', { name: 'renamed' }],
    ['POST', '/api/spaces', { name: 'S' }],
    ['PATCH', `/api/spaces/${w.findSpace('Dev').id}`, { name: 'D2' }],
    ['DELETE', `/api/spaces/${w.findSpace('Dev').id}`, null],
    ['POST', '/api/tables', { space: 'Dev', name: 'T2' }],
    ['PATCH', `/api/tables/${tid}`, { name: 'Job' }],
    ['DELETE', `/api/tables/${tid}`, null],
    ['POST', `/api/tables/${tid}/fields`, { name: 'Due', type: 'date' }],
    ['POST', '/api/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'weave_create_space', arguments: { name: 'S' } } }],
  ]) assert.equal((await call(method, path, { token: t.editor, body })).status, 403, `${method} ${path}`);
  assert.equal(JSON.stringify(w.describeSchema()), before);
});

test('architect: structure, accounts and MCP', async () => {
  const { w, call, t, tid } = build();
  assert.equal((await call('POST', '/api/spaces', { token: t.architect, body: { name: 'Ops' } })).status, 201);
  const run = await call('POST', '/api/tables', { token: t.architect, body: { space: 'Ops', name: 'Run' } });
  assert.equal(run.status, 201);
  assert.equal((await call('POST', `/api/tables/${run.json.id}/fields`, { token: t.architect, body: { name: 'Due', type: 'date' } })).status, 201);
  assert.equal((await call('PATCH', '/api/workspace', { token: t.architect, body: { name: 'ws2' } })).status, 200);
  const acc = await call('POST', '/api/accounts', { token: t.architect, body: { name: 'new', role: 'reader' } });
  assert.equal(acc.status, 201);
  assert.equal(acc.json.account.role, 'observer');
  assert.ok(acc.json.note);
  const mcp = await call('POST', '/api/mcp', { token: t.architect, body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'weave_accounts', arguments: { action: 'list' } } } });
  assert.equal(mcp.status, 200);
  assert.ok(!mcp.json.result.isError);
  assert.ok(w.findSpace('Ops'));
});

test('mcp: weave_accounts create takes the new names, the old as aliases, Editor by default', () => {
  const w = new Weave();
  assert.equal(dispatchTool(w, 'weave_accounts', { action: 'create', name: 'a' }).account.role, 'editor');
  const old = dispatchTool(w, 'weave_accounts', { action: 'create', name: 'b', role: 'writer' });
  assert.equal(old.account.role, 'editor');
  assert.ok(old.note);
  assert.equal(dispatchTool(w, 'weave_accounts', { action: 'create', name: 'c', role: 'observer' }).account.role, 'observer');
});

test('cli: account create defaults to editor and takes the old names with a note', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-roles-cli-'));
  try {
    const data = join(dir, 'w.db');
    const run = (args) => spawnSync(process.execPath, [BIN, '--data', data, ...args], { encoding: 'utf8', env: { ...process.env, WEAVE_UPDATE_CHECK: 'off' } });
    assert.equal(JSON.parse(run(['account', 'create', 'bot']).stdout).account.role, 'editor');
    const old = JSON.parse(run(['account', 'create', 'eye', '--role', 'reader']).stdout);
    assert.equal(old.account.role, 'observer');
    assert.match(old.note, /deprecated/);
    assert.match(run(['help']).stdout, /account create <name> \[--role architect\|editor\|observer\]/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
