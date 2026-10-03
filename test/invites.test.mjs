/* Invite a new person to a workspace (Issue #569, bullet 3). A new person
   who signed up at the provider used to reach a 403 with no way in but an
   operator's CLI. An architect now invites them from the workspace: weave
   keeps a pending invite (email, role, who invited, when) and hands back a
   one-time sign-in link. Opening it and signing in at the provider makes the
   account at the invited role, pins the provider's subject to it, spends the
   invite and lands the person where they were going. The provider is asked
   for no email (Feature #252): the link is the proof, and the email only says
   who the invite is for, on the pending invite and nowhere else. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.WEAVE_KEYSTORE = join(mkdtempSync(join(tmpdir(), 'weave-ks-')), 'keystore.json');
const { Weave } = await import('../src/engine.js');
const { startServer } = await import('../src/server.js');
const { createOidc } = await import('../src/oidc.js');
const { dispatchTool } = await import('../src/mcp.js');
const { startIdp } = await import('./lib/idp.mjs');

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');
const ISS = 'https://idp.test';

/* ---------------------------------------------------------------- engine */
test('engine: an invite keeps email, role, inviter and time; the code only as its hash', () => {
  const w = new Weave({ actor: 'kyle' });
  w.updateWorkspace({ name: 'ws' });
  const inv = w.inviteMember({ email: 'Dylan@Example.com', issuer: ISS });
  assert.match(inv.code, /^wvi_[\w-]{40,}$/);
  assert.match(inv.id, /^[0-9a-f]{64}$/);
  assert.deepEqual([inv.email, inv.role, inv.invitedBy, inv.workspace, inv.name], ['dylan@example.com', 'editor', 'kyle', 'ws', 'dylan']);
  assert.ok(!JSON.stringify(w.state).includes(inv.code), 'the code is nowhere at rest');
  const [listed] = w.listInvites();
  assert.deepEqual(Object.keys(listed).sort(), ['createdAt', 'email', 'expiresAt', 'id', 'invitedBy', 'name', 'role', 'roleLabel', 'workspace']);
  assert.equal(listed.roleLabel, 'Editor, paid seat');
  assert.equal(w.inviteMember({ email: 'eye@example.com', role: 'reader', issuer: ISS }).role, 'observer', 'an old role name is an alias');
  assert.throws(() => w.inviteMember({ email: 'not-an-email', issuer: ISS }), /email/);
  assert.throws(() => w.inviteMember({ email: 'x@example.com', role: 'owner', issuer: ISS }), /Invalid role/);
  assert.throws(() => w.inviteMember({ email: 'x@example.com' }), /issuer/);
  assert.throws(() => w.inviteMember({ email: 'dylan@example.com', issuer: ISS }), /already/);
  const audit = JSON.stringify(w.listAudit({ limit: 20 }));
  assert.ok(audit.includes('member-invited'));
  assert.ok(!audit.includes('example.com'), 'no email lands in the audit log');
});

test('engine: redeeming makes the account at the invited role, de-duplicates the name, pins the subject, and spends the invite', () => {
  const w = new Weave({ actor: 'kyle' });
  w.createAccount({ name: 'dylan', role: 'architect' });
  const inv = w.inviteMember({ email: 'dylan@example.com', role: 'observer', issuer: ISS });
  assert.equal(w.identityInvite(inv.code).account, 'dylan-2', 'the peek names the account it will make');
  const made = w.redeemIdentityInvite(inv.code, { issuer: ISS, subject: 'user_dylan' });
  assert.deepEqual([made.name, made.role], ['dylan-2', 'observer']);
  assert.deepEqual(made.identities.map((i) => [i.issuer, i.subject]), [[ISS, 'user_dylan']]);
  assert.ok(!JSON.stringify(w.state.meta.accounts).includes('example.com'), 'the account carries no email');
  assert.equal(w.listInvites().length, 0);
  assert.equal(w.identityInvite(inv.code), null);
  assert.throws(() => w.redeemIdentityInvite(inv.code, { issuer: ISS, subject: 'user_other' }), /already used/, 'an invite opens once');
  assert.equal(w.accountForIdentity({ issuer: ISS, subject: 'user_dylan' }).name, 'dylan-2', 'the next sign-in needs no invite');
  // A subject that already opens an account is refused, and the invite waits for the right person.
  const second = w.inviteMember({ email: 'ann@example.com', issuer: ISS });
  assert.throws(() => w.redeemIdentityInvite(second.code, { issuer: ISS, subject: 'user_dylan' }), /already opens 'dylan-2'/);
  assert.equal(w.listInvites().length, 1);
  assert.throws(() => w.redeemIdentityInvite(second.code, { issuer: 'https://other.example', subject: 'user_ann' }), /another provider/);
});

test('engine: a revoked or expired invite opens nothing', () => {
  const w = new Weave();
  const inv = w.inviteMember({ email: 'ann@example.com', issuer: ISS });
  assert.throws(() => w.revokeInvite('nope'), /not found/);
  assert.throws(() => w.revokeInvite(inv.id.slice(0, 3)), /not found/, 'a short prefix names nothing');
  assert.deepEqual(w.revokeInvite(inv.id.slice(0, 12)), { revoked: 1 });
  assert.equal(w.identityInvite(inv.code), null);
  assert.throws(() => w.redeemIdentityInvite(inv.code, { issuer: ISS, subject: 'user_ann' }), /expired or was already used/);
  const old = w.inviteMember({ email: 'old@example.com', issuer: ISS });
  w.state.meta.identityInvites[old.id].expiresAt = new Date(Date.now() - 1000).toISOString();
  assert.equal(w.identityInvite(old.code), null);
  assert.equal(w.listInvites().length, 0, 'an expired invite is not pending');
  assert.equal(w.listAccounts().length, 0);
});

test('engine: invites stay out of the export and survive this workspace\'s own import', () => {
  const w = new Weave();
  const inv = w.inviteMember({ email: 'ann@example.com', issuer: ISS });
  const dump = w.exportJSON();
  assert.ok(!JSON.stringify(dump).includes('ann@example.com'));
  w.importJSON(dump);
  assert.equal(w.identityInvite(inv.code).account, 'ann');
});

/* ---------------------------------------------------------------- surfaces */
test('mcp: weave_accounts invite, invites and revoke-invite', () => {
  const w = new Weave();
  const inv = dispatchTool(w, 'weave_accounts', { action: 'invite', email: 'ann@example.com', role: 'observer', issuer: ISS });
  assert.equal(inv.role, 'observer');
  assert.match(inv.url, /\/api\/auth\/oidc\/start\?invite=wvi_/);
  assert.equal(dispatchTool(w, 'weave_accounts', { action: 'invites' }).invites[0].email, 'ann@example.com');
  assert.deepEqual(dispatchTool(w, 'weave_accounts', { action: 'revoke-invite', invite: inv.id }), { revoked: 1 });
});

test('cli: invite, invite list and invite revoke', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-invite-cli-'));
  try {
    const data = join(dir, 'w.db');
    const run = (args) => spawnSync(process.execPath, [BIN, '--data', data, ...args], { encoding: 'utf8', env: { ...process.env, WEAVE_OIDC_ISSUER: ISS, WEAVE_ORIGIN: 'https://weave.example.com', WEAVE_UPDATE_CHECK: 'off' } });
    const made = run(['invite', 'ann@example.com', '--role', 'architect']);
    assert.equal(made.status, 0, made.stderr);
    const inv = JSON.parse(made.stdout);
    assert.equal(inv.role, 'architect');
    assert.equal(inv.url, `https://weave.example.com/api/auth/oidc/start?invite=${inv.code}`);
    assert.equal(JSON.parse(run(['invite', 'list']).stdout)[0].email, 'ann@example.com');
    assert.deepEqual(JSON.parse(run(['invite', 'revoke', inv.id]).stdout), { revoked: 1 });
    assert.deepEqual(JSON.parse(run(['invite', 'list']).stdout), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---------------------------------------------------------------- routes */
const cookieOf = (res) => (res.headers.get('set-cookie') ?? '').split(';')[0];

async function serve() {
  const idp = await startIdp();
  const w = new Weave();
  w.updateWorkspace({ name: 'home' });
  const architect = w.createAccount({ name: 'kyle', role: 'architect' }).token;
  const editor = w.createAccount({ name: 'ed', role: 'editor' }).token;
  w.setRequireAuth(true);
  const other = new Weave();
  other.updateWorkspace({ name: 'other' });
  const otherArchitect = other.createAccount({ name: 'boss', role: 'architect' }).token;
  other.setRequireAuth(true);
  const oidc = createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' });
  const { server } = await startServer(w, { port: 0, origin: null, oidc, workspaces: { other }, limits: { options: 1000, failed: 1000 } });
  const base = `http://localhost:${server.address().port}`;
  const call = (method, path, { token, body, cookie } = {}) => fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: ['POST', 'PUT', 'PATCH'].includes(method) ? JSON.stringify(body ?? {}) : undefined,
    redirect: 'manual',
  });
  /* Open the invite link (or any start URL), sign in at the provider, come back. */
  const follow = async (startPath, claims) => {
    const start = await call('GET', startPath);
    if (start.status !== 302) return { start, res: start };
    const back = idp.approve(start.headers.get('location'), claims);
    const res = await call('GET', back.pathname + back.search, { cookie: cookieOf(start) });
    return { start, res, cookie: cookieOf(res) };
  };
  return { w, other, idp, architect, editor, otherArchitect, base, call, follow, stop: () => { server.close(); idp.stop(); } };
}

const path = (url) => { const u = new URL(url); return u.pathname + u.search; };

test('routes: inviting is an architect verb; the list and revoke live beside it', async () => {
  const s = await serve();
  try {
    const body = { email: 'dylan@example.com' };
    assert.equal((await s.call('POST', '/api/invites', { body })).status, 401);
    assert.equal((await s.call('POST', '/api/invites', { body, token: s.editor })).status, 403);
    assert.equal((await s.call('GET', '/api/invites', { token: s.editor })).status, 403);
    const res = await s.call('POST', '/api/invites', { body, token: s.architect });
    assert.equal(res.status, 201);
    const inv = await res.json();
    assert.equal(inv.role, 'editor', 'Editor by default');
    assert.equal(inv.invitedBy, 'kyle');
    assert.equal(inv.url, `${s.base}/api/auth/oidc/start?invite=${inv.code}`);
    const list = await (await s.call('GET', '/api/invites', { token: s.architect })).json();
    assert.deepEqual(list.map((i) => [i.email, i.role, i.invitedBy]), [['dylan@example.com', 'editor', 'kyle']]);
    assert.ok(!('code' in list[0]), 'the list never shows a code');
    assert.equal((await s.call('DELETE', `/api/invites/${inv.id}`, { token: s.editor })).status, 403);
    assert.equal((await s.call('DELETE', `/api/invites/${inv.id}`, { token: s.architect })).status, 200);
    assert.deepEqual(await (await s.call('GET', '/api/invites', { token: s.architect })).json(), []);
  } finally { s.stop(); }
});

test('routes: the invited person opens the link, signs in once, and lands with an account at the invited role', async () => {
  const s = await serve();
  try {
    const inv = await (await s.call('POST', '/api/invites', { body: { email: 'dylan@example.com', role: 'observer' }, token: s.architect })).json();
    const { res, cookie } = await s.follow(path(inv.url) + '&next=' + encodeURIComponent('/#/home'), { sub: 'user_dylan' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/#/home');
    const me = await (await s.call('GET', '/api/auth/me', { cookie })).json();
    assert.deepEqual([me.account.name, me.role], ['dylan', 'observer']);
    assert.equal((await s.call('GET', '/api/spaces', { cookie })).status, 200);
    assert.deepEqual(await (await s.call('GET', '/api/invites', { token: s.architect })).json(), [], 'the invite is spent');
    // Spent: the link is refused at start, before the provider.
    assert.equal((await s.call('GET', path(inv.url))).status, 410);
    // The next visit needs no invite: the subject is the identity now.
    const again = await s.follow('/api/auth/oidc/start', { sub: 'user_dylan' });
    assert.equal(again.res.status, 302);
    assert.equal(Object.keys(s.w.state.meta.accounts).length, 3);
  } finally { s.stop(); }
});

test('routes: a revoked invite, another workspace\'s invite and no invite at all leave the person at the refusal page', async () => {
  const s = await serve();
  try {
    const gone = await (await s.call('POST', '/api/invites', { body: { email: 'ann@example.com' }, token: s.architect })).json();
    await s.call('DELETE', `/api/invites/${gone.id}`, { token: s.architect });
    assert.equal((await s.call('GET', path(gone.url))).status, 410, 'revoked');
    // An invite to /w/other opens /w/other, never the root.
    const theirs = await (await s.call('POST', '/w/other/api/invites', { body: { email: 'bo@example.com' }, token: s.otherArchitect })).json();
    assert.match(theirs.url, /\/w\/other\/api\/auth\/oidc\/start\?invite=/);
    assert.equal((await s.call('GET', `/api/auth/oidc/start?invite=${theirs.code}`)).status, 410, 'wrong workspace');
    // No invite: the refusal page, unchanged.
    const { res } = await s.follow('/api/auth/oidc/start', { sub: 'user_stranger' });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('set-cookie'), null);
    assert.match(await res.text(), /No access to/, "the refusal page Issue #570 owns");
    assert.equal(s.w.listAccounts().length, 2, 'nobody was provisioned');
    // The right workspace takes it.
    const ok = await s.follow(path(theirs.url), { sub: 'user_bo' });
    assert.equal(ok.res.status, 302);
    assert.deepEqual(s.other.listAccounts().map((a) => [a.name, a.role]).sort(), [['bo', 'editor'], ['boss', 'architect']]);
  } finally { s.stop(); }
});
