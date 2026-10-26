import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './lib/temp.mjs';
process.env.WEAVE_KEYSTORE = join(tempDir('weave-ks-'), 'keystore.json');
const { Weave } = await import('../src/engine.js');
const { dispatchTool, handleMcpMessage } = await import('../src/mcp.js');
const { startServer } = await import('../src/server.js');
const { APP, fnBodyOf } = await import('./lib/source.mjs');

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
const ISS = 'https://idp.test';

function fresh() {
  const w = new Weave({ actor: 'kyle' });
  w.inviteIssuer = ISS;
  return w;
}
const users = (w) => w.getTable('System/Users');
const row = (w, name) => w.readEntity(w.findEntity(users(w).id, name).id);

test('engine: Users is a system table in the Workspace space with the account columns', () => {
  const w = fresh();
  const t = users(w);
  assert.equal(t.system, 'users');
  const byName = Object.fromEntries(Object.values(t.fields).map((f) => [f.name, f]));
  for (const [n, type] of [['Name', 'text'], ['Email', 'text'], ['Role', 'select'], ['Status', 'select'], ['Kind', 'select'], ['Identities', 'number'], ['Last Seen', 'date'], ['Created', 'date']]) {
    assert.equal(byName[n]?.type, type, `${n} is a ${type}`);
  }
  assert.deepEqual(byName.Role.config.options.map((o) => o.name), ['Architect', 'Editor', 'Observer']);
  assert.deepEqual(byName.Status.config.options.map((o) => o.name), ['Invited', 'Active']);
  assert.deepEqual(byName.Kind.config.options.map((o) => o.name), ['Person', 'Agent']);
});

test('engine: rows mirror accounts and pending invites; meta stays the source of truth', () => {
  const w = fresh();
  w.createAccount({ name: 'bot', role: 'observer' });
  w.inviteMember({ email: 'dana@example.com', role: 'editor', issuer: ISS });
  const bot = row(w, 'bot');
  assert.equal(bot.fields.Role, 'Observer');
  assert.equal(bot.fields.Status, 'Active');
  assert.equal(bot.fields.Kind, 'Agent');
  assert.equal(bot.raw.Identities, 0);
  assert.ok(bot.fields.Created);
  const dana = row(w, 'dana');
  assert.equal(dana.fields.Email, 'dana@example.com');
  assert.equal(dana.fields.Status, 'Invited');
  assert.equal(dana.fields.Kind, 'Person');
  w.deleteAccount('bot');
  assert.equal(w.findEntity(users(w).id, 'bot'), undefined, 'a deleted account leaves the table');
});

test('engine: creating a row with an Email invites at the chosen Role and hands the code over once', () => {
  const w = fresh();
  const e = w.createEntity(users(w).id, { values: { Email: 'Ann@Example.com', Role: 'Architect' } });
  const once = w.takeOneTime(e.id);
  assert.match(once.invite.code, /^wvi_/);
  assert.equal(w.takeOneTime(e.id), null, 'once means once');
  const [inv] = w.listInvites();
  assert.equal(inv.email, 'ann@example.com');
  assert.equal(inv.role, 'architect');
  const r = w.readEntity(e.id);
  assert.equal(r.fields.Status, 'Invited');
  assert.equal(r.fields.Role, 'Architect');
  assert.equal(w.redeemIdentityInvite(once.invite.code, { issuer: ISS, subject: 'user_ann', email: 'ann@example.com' }).role, 'architect');
  const joined = row(w, 'ann');
  assert.equal(joined.fields.Status, 'Active');
  assert.equal(joined.raw.Identities, 1);
  assert.ok(joined.fields['Last Seen']);
  assert.equal(w.listEntities(users(w).id).length, 1, 'the invite row became the account row, not a second one');
});

test('engine: an invite row keeps the Name it was given for the account it makes', () => {
  const w = fresh();
  const e = w.createEntity(users(w).id, { name: 'Dana Q', values: { Email: 'dq@example.com' } });
  assert.equal(w.readEntity(e.id).name, 'Dana Q');
  w.redeemIdentityInvite(w.takeOneTime(e.id).invite.code, { issuer: ISS, subject: 'user_dq' });
  assert.ok(w.listAccounts().some((a) => a.name === 'Dana Q'));
});

test('engine: Kind Agent with no Email makes an account and returns the wv_ token once', () => {
  const w = fresh();
  const e = w.createEntity(users(w).id, { name: 'scout', values: { Kind: 'Agent', Role: 'Editor' } });
  const once = w.takeOneTime(e.id);
  assert.match(once.token, /^wv_/);
  assert.equal(w.verifyToken(once.token).name, 'scout');
  assert.equal(w.verifyToken(once.token).role, 'editor');
  assert.throws(() => w.createEntity(users(w).id, { name: 'nobody', values: { Kind: 'Person' } }), /Email/);
  assert.throws(() => w.createEntity(users(w).id, { values: { Kind: 'Agent' } }), /Name/);
  assert.throws(() => w.createEntity(users(w).id, { name: 'x', values: { Kind: 'Agent', Status: 'Active' } }), /Status/);
});

test('engine: editing Role changes the account role; renaming renames the account', () => {
  const w = fresh();
  const { account } = w.createAccount({ name: 'ed', role: 'editor' });
  const e = w.findEntity(users(w).id, 'ed');
  w.updateEntity(e.id, { Role: 'Observer' });
  assert.equal(w.listAccounts().find((a) => a.id === account.id).role, 'observer');
  w.updateEntity(e.id, { Name: 'eddie' });
  assert.equal(w.listAccounts().find((a) => a.id === account.id).name, 'eddie');
  assert.equal(w.readEntity(e.id).name, 'eddie');
  w.createAccount({ name: 'taken' });
  assert.throws(() => w.updateEntity(e.id, { Name: 'taken' }), /already exists/);
  assert.throws(() => w.updateEntity(e.id, { Identities: 4 }), /Identities/);
  assert.throws(() => w.updateEntity(e.id, { Status: 'Invited' }), /Status/);
  const inv = w.createEntity(users(w).id, { values: { Email: 'iv@example.com' } });
  w.updateEntity(inv.id, { Role: 'Architect' });
  assert.equal(w.listInvites()[0].role, 'architect', 'an invite row changes the role the invite grants');
});

test('engine: users add their own fields, and any table relates to Users', () => {
  const w = fresh();
  w.createAccount({ name: 'ed' });
  w.addField(users(w).id, { name: 'Team', type: 'text' });
  const e = w.findEntity(users(w).id, 'ed');
  w.updateEntity(e.id, { Team: 'Ops' });
  assert.equal(w.readEntity(e.id).fields.Team, 'Ops');
  w.createSpace({ name: 'Work' });
  const tasks = w.createTable({ space: 'Work', name: 'Tasks' });
  w.addRelation(tasks.id, { name: 'Assignee', targetDb: users(w).id, cardinality: 'many-to-one', inverseName: 'Tasks' });
  const t = w.createEntity(tasks.id, { name: 'ship', values: { Assignee: 'ed' } });
  const assignee = () => w.state.entities[t.id].values[w.findField(tasks, 'Assignee').id];
  assert.equal(assignee(), e.id);
  w.syncRegistry();
  assert.equal(assignee(), e.id, 'a resync keeps the relation');
  assert.ok(w.findEntity(users(w).id, 'ed'), 'the row survives a resync');
  assert.equal(w.readEntity(e.id).fields.Team, 'Ops', 'its own fields survive a resync');
});

test('engine: deleting a row revokes the invite or deletes the account', () => {
  const w = fresh();
  w.createAccount({ name: 'gone' });
  w.inviteMember({ email: 'late@example.com', issuer: ISS });
  w.deleteEntity(w.findEntity(users(w).id, 'gone').id);
  assert.ok(!w.listAccounts().some((a) => a.name === 'gone'));
  w.deleteEntity(w.findEntity(users(w).id, 'late').id);
  assert.deepEqual(w.listInvites(), []);
  assert.equal(w.listEntities(users(w).id, { includeDeleted: true }).length, 0);
});

function secretsOf(w) {
  const m = w.state.meta;
  return [
    ...Object.values(m.accounts ?? {}).map((a) => a.tokenHash),
    ...Object.keys(m.sessions ?? {}),
    ...Object.keys(m.identityInvites ?? {}),
  ].filter(Boolean);
}

async function served() {
  const w = fresh();
  w.updateWorkspace({ name: 'home' });
  const architect = w.createAccount({ name: 'kyle', role: 'architect' }).token;
  const editor = w.createAccount({ name: 'ed', role: 'editor' }).token;
  const observer = w.createAccount({ name: 'ob', role: 'observer' }).token;
  w.createSession('ed');
  w.inviteMember({ email: 'wait@example.com', issuer: ISS });
  w.createSpace({ name: 'Work' });
  const tasks = w.createTable({ space: 'Work', name: 'Tasks' });
  w.addRelation(tasks.id, { name: 'Owner', targetDb: users(w).id, cardinality: 'many-to-one', inverseName: 'Owned' });
  const task = w.createEntity(tasks.id, { name: 'a task' });
  const { server } = await startServer(w, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, token = architect) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text };
  };
  return { w, server, call, architect, editor, observer, tasks, task };
}

test('http: no token, session or invite hash reaches rows, queries, exports or MCP', async () => {
  const s = await served();
  try {
    const hashes = secretsOf(s.w);
    assert.ok(hashes.length >= 5, 'the fixture holds token, session and invite hashes');
    const t = users(s.w);
    const outputs = [
      (await s.call('GET', `/api/tables/${t.id}/entities`)).text,
      (await s.call('POST', `/api/tables/${t.id}/query`, {})).text,
      (await s.call('GET', '/api/export')).text,
      (await s.call('GET', `/api/search?q=example`)).text,
      JSON.stringify(dispatchTool(s.w, 'weave_query', { db: t.id })),
      JSON.stringify(s.w.exportJSON()),
      JSON.stringify(s.w.listEntities(t.id).map((e) => s.w.readEntity(e.id))),
    ];
    for (const out of outputs) for (const h of hashes) assert.ok(!out.includes(h), `hash ${h.slice(0, 8)} leaked`);
    assert.ok(outputs[0].includes('wait@example.com') || outputs[1].includes('wait@example.com'), 'the invite row is there');
  } finally { s.server.close(); }
});

test('http: only an Architect writes Users rows; Editor and Observer read and relate', async () => {
  const s = await served();
  try {
    const t = users(s.w);
    const made = await s.call('POST', `/api/tables/${t.id}/entities`, { values: { Email: 'new@example.com', Role: 'Editor' } });
    assert.equal(made.status, 201, made.text);
    assert.match(made.json.invite.url, /\/api\/auth\/oidc\/start\?invite=wvi_/);
    assert.equal(made.json.fields.Status, 'Invited');
    const agent = await s.call('POST', `/api/tables/${t.id}/entities`, { name: 'helper', values: { Kind: 'Agent' } });
    assert.equal(agent.status, 201, agent.text);
    assert.match(agent.json.token, /^wv_/);
    const again = await s.call('GET', `/api/entities/${agent.json.id}`);
    assert.equal(again.json.token, undefined, 'the token is not read back');
    for (const tok of [s.editor, s.observer]) {
      assert.equal((await s.call('GET', `/api/tables/${t.id}/entities`, undefined, tok)).status, 200);
      assert.equal((await s.call('POST', `/api/tables/${t.id}/entities`, { name: 'sneak', values: { Kind: 'Agent' } }, tok)).status, 403);
      assert.equal((await s.call('PATCH', `/api/entities/${agent.json.id}`, { Role: 'Architect' }, tok)).status, 403);
      assert.equal((await s.call('DELETE', `/api/entities/${agent.json.id}`, undefined, tok)).status, 403);
    }
    const linked = await s.call('PATCH', `/api/entities/${s.task.id}`, { Owner: 'ed' }, s.editor);
    assert.equal(linked.status, 200, linked.text);
    assert.ok(!s.w.listAccounts().some((a) => a.name === 'sneak'));
    const del = await s.call('DELETE', `/api/entities/${agent.json.id}`);
    assert.equal(del.status, 200, del.text);
    assert.ok(!s.w.listAccounts().some((a) => a.name === 'helper'));
  } finally { s.server.close(); }
});

test('mcp: create, update and delete Users rows like any table; non-architects are refused', () => {
  const w = fresh();
  const made = dispatchTool(w, 'weave_create_entity', { db: 'Users', name: 'mcp-bot', values: { Kind: 'Agent' } });
  assert.match(made.token, /^wv_/);
  const inv = dispatchTool(w, 'weave_create_entity', { db: 'Users', values: { Email: 'm@example.com' } });
  assert.match(inv.invite.url, /invite=wvi_/);
  dispatchTool(w, 'weave_update_entity', { entity: made.id, values: { Role: 'Observer' } });
  assert.equal(w.listAccounts().find((a) => a.name === 'mcp-bot').role, 'observer');
  w.createAccount({ name: 'boss', role: 'architect' });
  const caller = { role: 'editor', root: w, rootRole: 'editor' };
  assert.throws(() => dispatchTool(w, 'weave_create_entity', { db: 'Users', name: 'x', values: { Kind: 'Agent' } }, { caller }), /architect/);
  assert.throws(() => dispatchTool(w, 'weave_delete_entity', { entity: made.id }, { caller }), /architect/);
  dispatchTool(w, 'weave_delete_entity', { entity: made.id });
  assert.ok(!w.listAccounts().some((a) => a.name === 'mcp-bot'));
  assert.equal(typeof handleMcpMessage, 'function');
});

test('cli: entity create on Users prints the invite link or the token once', () => {
  const dir = tempDir('weave-users-cli-');
  try {
    const data = join(dir, 'w.db');
    const run = (args) => spawnSync(process.execPath, [BIN, '--data', data, ...args], { encoding: 'utf8', env: { ...process.env, WEAVE_OIDC_ISSUER: ISS, WEAVE_ORIGIN: 'https://weave.example.com', WEAVE_UPDATE_CHECK: 'off' } });
    const agent = run(['create', 'Users', 'cli-bot', '--values', '{"Kind":"Agent"}']);
    assert.equal(agent.status, 0, agent.stderr);
    assert.match(JSON.parse(agent.stdout).token, /^wv_/);
    const inv = run(['create', 'Users', 'Cleo', '--values', '{"Email":"cleo@example.com","Role":"Observer"}']);
    assert.equal(inv.status, 0, inv.stderr);
    assert.match(JSON.parse(inv.stdout).invite.url, /^https:\/\/weave\.example\.com\/api\/auth\/oidc\/start\?invite=wvi_/);
    const list = JSON.parse(run(['invite', 'list']).stdout);
    assert.equal(list[0].role, 'observer');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ui: the nav pins Users beside Workflows, and + New on Users opens the user dialog', () => {
  const nav = fnBodyOf('renderNav');
  const group = nav.slice(nav.indexOf("$('#rail-system').replaceChildren"), nav.indexOf("class: 'nav-pinned'"));
  assert.ok(group.indexOf("'Users'") > group.indexOf("'Workflows'") && group.indexOf("'Users'") < group.indexOf("'#/activity'"), 'Workflows, Users, Activity, Trash');
  assert.match(nav, /db\.system === 'users'/, 'Users leaves the Workspace space list');
  assert.match(APP, /if \(db\.system === 'users'\) return newUserDialog\(db, redraw\)/);
  const dialog = fnBodyOf('newUserDialog');
  assert.match(dialog, /made\.invite\?\.url|made\.token/, 'the one-time link or token is shown');
});

test('hub: the root Users table lists every member account under its Workspace, and a row made for a member lands there', () => {
  const r = fresh();
  r.updateWorkspace({ name: 'root' });
  const m = new Weave();
  m.updateWorkspace({ name: 'uno' });
  m.createAccount({ name: 'early' });
  m.joinRegistry(r);
  r.createAccount({ name: 'boss', role: 'architect' });
  m.createAccount({ name: 'late' });
  const t = users(r);
  const wsOf = (name) => r.readEntity(r.findEntity(t.id, name).id).fields.Workspace?.name;
  assert.equal(wsOf('boss'), 'root');
  assert.equal(wsOf('early'), 'uno');
  assert.equal(wsOf('late'), 'uno');
  const made = r.createEntity(t.id, { name: 'uno-bot', values: { Kind: 'Agent', Workspace: m.state.meta.id } });
  assert.match(r.takeOneTime(made.id).token, /^wv_/);
  assert.ok(m.listAccounts().some((a) => a.name === 'uno-bot'), 'the account lives in the member');
  assert.ok(!r.listAccounts().some((a) => a.name === 'uno-bot'));
  r.updateEntity(made.id, { Role: 'Observer' });
  assert.equal(m.listAccounts().find((a) => a.name === 'uno-bot').role, 'observer');
  r.deleteEntity(made.id);
  assert.ok(!m.listAccounts().some((a) => a.name === 'uno-bot'));
  assert.ok(r.findEntity(t.id, 'boss'), 'the root row is untouched');
});

test('engine: Last Seen follows a signed-in session, at most once an hour per account (Issue #877)', (t) => {
  const t0 = Date.parse('2026-10-15T09:00:00.000Z');
  t.mock.timers.enable({ apis: ['Date'], now: t0 });
  const w = fresh();
  w.createAccount({ name: 'kyle', role: 'architect' });
  const { token } = w.createSession('kyle');
  const lastSeen = () => row(w, 'kyle').raw['Last Seen'];
  assert.equal(lastSeen(), new Date(t0).toISOString(), 'sign-in writes Last Seen');
  t.mock.timers.tick(2 * 60 * 60_000);
  assert.ok(w.verifySession(token));
  assert.equal(lastSeen(), new Date(t0 + 2 * 60 * 60_000).toISOString(), 'a renewal two hours on moves Last Seen');
  t.mock.timers.tick(10 * 60_000);
  assert.ok(w.verifySession(token).renewed);
  assert.equal(lastSeen(), new Date(t0 + 2 * 60 * 60_000).toISOString(), 'a renewal ten minutes later leaves it alone');
  t.mock.timers.tick(55 * 60_000);
  assert.ok(w.verifySession(token));
  assert.equal(lastSeen(), new Date(t0 + 185 * 60_000).toISOString(), 'past the hour it moves again');
});
