import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { createOidc, oidcFromEnv } from '../src/oidc.js';
import { renderAuthPage } from '../src/auth-page.js';
import { createBilling } from '../src/billing.js';
import { startServer } from '../src/server.js';
import { startIdp, serveOidc, cookieOf } from './lib/idp.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');

const ISS = 'https://clerk.example.com';

const mail = /[\w.+-]+@[\w-]+\.[\w.]+/;

test('engine: linking mints a one-time invite, stored as its hash; redeeming it pins the subject and nothing else', () => {
  const w = new Weave();
  w.createAccount({ name: 'kyle', role: 'admin' });
  w.createAccount({ name: 'eye', role: 'reader' });
  const inv = w.linkIdentity('kyle', { issuer: `${ISS}/` });
  assert.equal(inv.account, 'kyle');
  assert.equal(inv.issuer, ISS);
  assert.match(inv.code, /^wvi_[\w-]{40,}$/);
  assert.ok(Date.parse(inv.expiresAt) > Date.now() + 6 * 86400e3, 'an invite lasts days, not minutes');
  assert.ok(!JSON.stringify(w.state.meta).includes(inv.code), 'only the hash is kept');
  assert.equal(Object.keys(w.state.meta.identityInvites).length, 1);
  assert.throws(() => w.linkIdentity('kyle', {}), /issuer/);
  assert.throws(() => w.linkIdentity('nobody', { issuer: ISS }), /not found/);
  assert.equal(w.identityInvite(inv.code).account, 'kyle', 'a pending invite can be looked at');
  assert.equal(w.identityInvite('wvi_made-up'), null);

  assert.throws(() => w.redeemIdentityInvite(inv.code, { issuer: 'https://other.example', subject: 'user_1' }), /another provider/);
  const hit = w.redeemIdentityInvite(inv.code, { issuer: ISS, subject: 'user_1', email: ' Kyle@Example.com ' });
  assert.equal(hit.name, 'kyle');
  assert.ok(!('tokenHash' in hit));
  const ids = w.listAccounts().find((a) => a.name === 'kyle').identities;
  assert.deepEqual(ids.map((i) => [i.issuer, i.subject, i.verifiedEmail]), [[ISS, 'user_1', 'kyle@example.com']], 'one verified email per identity, normalised (Feature #290)');
  assert.ok(!('email' in ids[0]), 'the old unverified field stays gone');
  assert.throws(() => w.redeemIdentityInvite(inv.code, { issuer: ISS, subject: 'user_1' }), /expired or was already used/, 'single use');
  assert.equal(w.identityInvite(inv.code), null);
  assert.equal(Object.keys(w.state.meta.identityInvites).length, 0);

  assert.equal(w.accountForIdentity({ issuer: ISS, subject: 'user_1' }).name, 'kyle');
  assert.equal(w.accountForIdentity({ issuer: ISS, subject: 'user_2', email: 'kyle@example.com', emailVerified: true }), null, 'an email opens nothing');
  assert.equal(w.accountForIdentity({ issuer: 'https://other.example', subject: 'user_1' }), null, 'another issuer is another namespace');

  const second = w.linkIdentity('eye', { issuer: ISS });
  assert.throws(() => w.redeemIdentityInvite(second.code, { issuer: ISS, subject: 'user_1' }), /already opens 'kyle'/);
  assert.equal(w.identityInvite(second.code).account, 'eye');
  assert.equal(w.redeemIdentityInvite(second.code, { issuer: ISS, subject: 'user_eye' }).name, 'eye');

  assert.deepEqual(w.unlinkIdentity('kyle', { issuer: ISS, subject: 'user_1' }), { unlinked: 1, remaining: 0 });
  assert.throws(() => w.unlinkIdentity('kyle', { subject: 'user_1' }), /not found|No identity/);
  assert.equal(w.accountForIdentity({ issuer: ISS, subject: 'user_1' }), null);
  const audit = w.listAudit({ limit: 50 }).filter((e) => e.action.startsWith('identity-'));
  for (const a of ['identity-invited', 'identity-linked', 'identity-unlinked']) assert.ok(audit.some((e) => e.action === a), a);
  assert.ok(!mail.test(JSON.stringify(audit)), 'no email in the audit');
  assert.ok(!mail.test(JSON.stringify(w.exportJSON().meta)), 'no email leaves through the export');
});

test('engine: an invite expires', () => {
  const w = new Weave();
  w.createAccount({ name: 'kyle', role: 'admin' });
  const inv = w.linkIdentity('kyle', { issuer: ISS });
  for (const i of Object.values(w.state.meta.identityInvites)) i.expiresAt = new Date(Date.now() - 1000).toISOString();
  assert.equal(w.identityInvite(inv.code), null);
  assert.throws(() => w.redeemIdentityInvite(inv.code, { issuer: ISS, subject: 'user_1' }), /expired or was already used/);
  assert.equal(w.listAccounts()[0].identities, undefined, 'nothing was pinned');
  w.linkIdentity('kyle', { issuer: ISS });
  assert.equal(Object.keys(w.state.meta.identityInvites).length, 1);
});

test('engine: invites never leave through the JSON export, and an import keeps this workspace\'s own', () => {
  const w = new Weave();
  w.createAccount({ name: 'kyle', role: 'admin' });
  const inv = w.linkIdentity('kyle', { issuer: ISS });
  const dump = w.exportJSON();
  assert.equal(dump.meta.identityInvites, undefined);
  w.importJSON(dump);
  assert.equal(w.identityInvite(inv.code).account, 'kyle');
  const far = new Weave();
  far.importJSON(dump);
  assert.equal(far.identityInvite(inv.code), null);
});

test('migration: a pinned identity drops its email, an unpinned one is dropped, and the identity audit is scrubbed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-oidc-mig-'));
  try {
    const path = join(dir, 'w.db');
    const w = new Weave({ path });
    w.createAccount({ name: 'kyle', role: 'admin' });
    w.createSpace({ name: 'Dev' });
    const a = Object.values(w.state.meta.accounts)[0];
    a.identities = [
      { issuer: ISS, email: 'kyle@example.com', subject: 'user_1', createdAt: '2026-10-01T00:00:00.000Z', lastUsedAt: '2026-10-02T00:00:00.000Z' },
      { issuer: 'https://dev.example', email: 'kyle@example.com', subject: null, createdAt: '2026-09-29T00:00:00.000Z', lastUsedAt: null },
    ];
    w.save();
    for (const [action, detail] of [
      ['identity-linked', { name: 'kyle', issuer: ISS, email: 'kyle@example.com' }],
      ['identity-pinned', { name: 'kyle', issuer: ISS, email: 'kyle@example.com' }],
      ['identity-unlinked', { name: 'kyle', email: 'old@example.com' }],
    ]) w.store.audit({ at: new Date().toISOString(), actor: 'local', action, detail });
    w.store.close?.();

    const again = new Weave({ path });
    const ids = again.listAccounts()[0].identities;
    assert.deepEqual(ids, [{ issuer: ISS, subject: 'user_1', createdAt: '2026-10-01T00:00:00.000Z', lastUsedAt: '2026-10-02T00:00:00.000Z' }]);
    assert.equal(again.accountForIdentity({ issuer: ISS, subject: 'user_1' }).name, 'kyle', 'the pinned person still signs in');
    const audit = again.listAudit({ limit: -1 }).filter((e) => e.action.startsWith('identity-'));
    assert.equal(audit.length, 3, 'entries are kept, only the email goes');
    assert.ok(audit.every((e) => e.detail.name === 'kyle' && !('email' in e.detail)));
    assert.ok(!mail.test(JSON.stringify(again.state.meta)));
    assert.ok(!mail.test(JSON.stringify(again.listAudit({ limit: -1 }))));
    again.store.close?.();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('migration: a dump carrying the old shape is scrubbed on import too', () => {
  const w = new Weave();
  w.createAccount({ name: 'kyle', role: 'admin' });
  const dump = w.exportJSON();
  Object.values(dump.meta.accounts)[0].identities = [{ issuer: ISS, email: 'kyle@example.com', subject: 'user_1' }, { issuer: ISS, email: 'b@example.com', subject: null }];
  const far = new Weave();
  far.importJSON(dump);
  assert.deepEqual(far.listAccounts()[0].identities, [{ issuer: ISS, subject: 'user_1' }]);
});

test('cli: account link mints an invite (issuer from WEAVE_OIDC_ISSUER or --issuer); unlink takes the subject', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-oidc-'));
  try {
    const data = join(dir, 'w.db');
    const run = (args, env = {}) => spawnSync(process.execPath, [BIN, '--data', data, ...args], { encoding: 'utf8', env: { ...process.env, WEAVE_OIDC_ISSUER: '', WEAVE_OIDC_CLIENT_ID: '', WEAVE_ORIGIN: '', WEAVE_UPDATE_CHECK: 'off', ...env } });
    assert.equal(run(['account', 'create', 'kyle', '--role', 'admin']).status, 0);
    const bare = run(['account', 'link', 'kyle']);
    assert.notEqual(bare.status, 0);
    assert.match(bare.stderr + bare.stdout, /--issuer/);
    const fromEnv = run(['account', 'link', 'kyle'], { WEAVE_OIDC_ISSUER: `${ISS}/`, WEAVE_ORIGIN: 'https://weave.example.com' });
    assert.equal(fromEnv.status, 0, fromEnv.stderr);
    const made = JSON.parse(fromEnv.stdout);
    assert.equal(made.issuer, ISS);
    assert.equal(made.url, `https://weave.example.com/api/auth/oidc/start?invite=${made.code}`);
    const flagged = JSON.parse(run(['account', 'link', 'kyle', '--issuer', 'https://other.example']).stdout);
    assert.equal(flagged.issuer, 'https://other.example');
    assert.equal(flagged.url, `/api/auth/oidc/start?invite=${flagged.code}`, 'with no WEAVE_ORIGIN the link is a path');
    const email = run(['account', 'link', 'kyle', '--email', 'kyle@example.com', '--issuer', ISS]);
    assert.notEqual(email.status, 0, 'linking by email is gone');
    assert.match(email.stderr, /invite/);
    const w = new Weave({ path: data });
    w.redeemIdentityInvite(made.code, { issuer: ISS, subject: 'user_1' });
    w.store.close?.();
    assert.equal(JSON.parse(run(['account', 'list']).stdout)[0].identities.length, 1);
    assert.deepEqual(JSON.parse(run(['account', 'unlink', 'kyle', '--subject', 'user_1']).stdout), { unlinked: 1, remaining: 0 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('config: WEAVE_OIDC_* is all or nothing, and the issuer is https off loopback', () => {
  assert.equal(oidcFromEnv({}), null);
  const on = oidcFromEnv({ WEAVE_OIDC_ISSUER: 'https://clerk.example.com/', WEAVE_OIDC_CLIENT_ID: 'abc', WEAVE_OIDC_CLIENT_SECRET: 'shh', WEAVE_OIDC_NAME: 'Clerk' });
  assert.deepEqual([on.issuer, on.clientId, on.clientSecret, on.name], ['https://clerk.example.com', 'abc', 'shh', 'Clerk']);
  assert.equal(oidcFromEnv({ WEAVE_OIDC_ISSUER: 'http://127.0.0.1:9000', WEAVE_OIDC_CLIENT_ID: 'abc' }).name, '127.0.0.1', 'the name falls back to the host');
  assert.throws(() => oidcFromEnv({ WEAVE_OIDC_ISSUER: 'https://clerk.example.com' }), /WEAVE_OIDC_CLIENT_ID/);
  assert.throws(() => oidcFromEnv({ WEAVE_OIDC_CLIENT_ID: 'abc' }), /WEAVE_OIDC_ISSUER/);
  assert.throws(() => oidcFromEnv({ WEAVE_OIDC_ISSUER: 'http://clerk.example.com', WEAVE_OIDC_CLIENT_ID: 'abc' }), /https/);
  assert.throws(() => oidcFromEnv({ WEAVE_OIDC_ISSUER: 'clerk', WEAVE_OIDC_CLIENT_ID: 'abc' }), /absolute URL/);
});

test('page: the sign-in page names the provider only when one is configured', () => {
  assert.ok(!renderAuthPage({ mount: '', workspace: 'w' }).includes('/api/auth/oidc/start'));
  const html = renderAuthPage({ mount: '/w/docs', workspace: 'w', provider: 'Clerk <b>' });
  assert.match(html, /id="oidc"[^>]*href="\/w\/docs\/api\/auth\/oidc\/start"/);
  assert.match(html, /Sign in with Clerk &lt;b&gt;/);
});

async function serve({ idpOptions, link = 'user_kyle', configured = true, limits = { options: 1000, failed: 1000 }, billing = null } = {}) {
  const idp = await startIdp(idpOptions);
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  const admin = w.createAccount({ name: 'root', role: 'admin' }).token;
  const reader = w.createAccount({ name: 'eye', role: 'reader' }).token;
  w.createAccount({ name: 'kyle', role: 'writer' });
  if (link) w.redeemIdentityInvite(w.linkIdentity('kyle', { issuer: idp.issuer }).code, { issuer: idp.issuer, subject: link });
  w.setRequireAuth(true);
  return { w, idp, admin, reader, ...await serveOidc(w, idp, { configured, limits, billing }) };
}

const KYLE = { sub: 'user_kyle', email: 'kyle@example.com', email_verified: true };

test('routes: with no provider configured the door is not there', async () => {
  const s = await serve({ configured: false });
  try {
    assert.equal((await s.call('GET', '/api/auth/oidc/start')).status, 404);
    assert.equal((await s.call('GET', '/api/auth/oidc/callback?code=x&state=y')).status, 404);
    assert.ok(!(await (await s.call('GET', '/auth')).text()).includes('id="oidc"'));
  } finally { s.stop(); }
});

test('routes: start sends the browser to the provider with state, nonce and a PKCE challenge', async () => {
  const s = await serve();
  try {
    const res = await s.call('GET', '/api/auth/oidc/start');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const to = new URL(res.headers.get('location'));
    assert.equal(to.origin + to.pathname, `${s.idp.issuer}/oauth/authorize`);
    const q = to.searchParams;
    assert.equal(q.get('response_type'), 'code');
    assert.equal(q.get('client_id'), s.idp.clientId);
    assert.equal(q.get('redirect_uri'), `${s.base}/api/auth/oidc/callback`);
    assert.equal(q.get('scope'), 'openid email profile', 'the email claim (Feature #290) and the profile name (Issue #935)');
    assert.equal(q.get('code_challenge_method'), 'S256');
    for (const k of ['state', 'nonce', 'code_challenge']) assert.ok(q.get(k)?.length >= 32, k);
    assert.notEqual(q.get('state'), q.get('nonce'));
    assert.equal((await s.call('GET', '/auth')).headers.get('location'), '/api/auth/oidc/start');
    assert.match(await (await s.call('GET', '/auth?signed-out=1')).text(), /Sign in with Clerk/);
  } finally { s.stop(); }
});

test('routes: a linked person signs in at the provider and comes back with a session that opens the wall', async () => {
  const s = await serve();
  try {
    assert.equal((await s.call('GET', '/api/spaces')).status, 401);
    const { res, cookie } = await s.signIn(KYLE, { next: '/#/Dev/Task' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/#/Dev/Task');
    assert.match(res.headers.get('set-cookie'), new RegExp(`^wv_session_${s.w.state.meta.id}=[\\w-]{40,}; HttpOnly; SameSite=Lax; Path=/`));
    assert.equal((await s.call('GET', '/api/spaces', { cookie })).status, 200);
    const me = await (await s.call('GET', '/api/auth/me', { cookie })).json();
    assert.deepEqual([me.account.name, me.role], ['kyle', 'editor']);
    assert.equal(me.account.identities[0].subject, 'user_kyle');
    assert.equal(s.idp.seen.token[0].form.grant_type, 'authorization_code');
    assert.ok(s.idp.seen.token[0].form.code_verifier.length >= 43);
    assert.ok(s.w.listAudit({ limit: 10 }).some((e) => e.action === 'session-created'));
    await s.call('POST', '/api/auth/logout', { cookie });
    assert.equal((await s.call('GET', '/api/spaces', { cookie })).status, 401);
  } finally { s.stop(); }
});

test('oidc: what comes back is the issuer and the subject, and userinfo is never read', async () => {
  for (const claimsInIdToken of [true, false]) {
    const s = await serve({ idpOptions: { claimsInIdToken } });
    try {
      const { res } = await s.signIn(KYLE);
      assert.equal(res.status, 302);
      assert.equal(s.idp.seen.userinfo, 0, 'no userinfo trip for an email');
      const oidc = createOidc({ issuer: s.idp.issuer, clientId: s.idp.clientId, clientSecret: s.idp.clientSecret });
      const trip = await oidc.begin({ redirectUri: 'http://localhost/cb' });
      const back = s.idp.approve(trip.url, KYLE);
      const who = await oidc.redeem({ code: back.searchParams.get('code'), redirectUri: 'http://localhost/cb', verifier: trip.verifier, nonce: trip.nonce });
      assert.deepEqual(who, { issuer: s.idp.issuer, subject: 'user_kyle', ...(claimsInIdToken ? { email: 'kyle@example.com' } : {}) }, 'the verified email from the id token only, never userinfo');
    } finally { s.stop(); }
  }
});

test('oidc: the client-credential probe tells a client the provider accepts (invalid_grant) from one it refuses (Issue #1178)', async () => {
  const idp = await startIdp();
  try {
    const good = await createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret }).probe({ redirectUri: 'http://localhost/cb' });
    assert.deepEqual([good.ok, good.status, good.code], [true, 400, 'invalid_grant']);
    assert.ok(Date.parse(good.checkedAt) > 0);
    const sent = idp.seen.token.at(-1);
    assert.equal(sent.basic, true, 'the probe authenticates the way a sign-in does');
    assert.equal(sent.form.redirect_uri, 'http://localhost/cb');
    assert.match(sent.form.code, /^weave-probe-/);
    const stale = await createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: 'rotated-away' }).probe();
    assert.deepEqual([stale.ok, stale.status, stale.code], [false, 401, 'invalid_client']);
  } finally { idp.stop(); }
  const doc = { issuer: ISS, authorization_endpoint: `${ISS}/oauth/authorize`, token_endpoint: `${ISS}/oauth/token`, jwks_uri: `${ISS}/jwks` };
  const answering = (status, body) => createOidc({ issuer: ISS, clientId: 'c', clientSecret: 's', fetch: async (url) => (String(url).endsWith('/openid-configuration') ? Response.json(doc) : new Response(body == null ? 'nope' : JSON.stringify(body), { status })) });
  for (const [status, body, ok, code] of [
    [400, { error: 'invalid_scope' }, false, 'invalid_scope'],
    [400, { error: 'unauthorized_client' }, false, 'unauthorized_client'],
    [401, null, false, 'invalid_client'],
    [503, null, false, 'server_error'],
    [400, { error: 'invalid_request' }, true, 'invalid_request'],
  ]) {
    const r = await answering(status, body).probe();
    assert.deepEqual([r.ok, r.code], [ok, code], `${status} ${body?.error ?? ''}`);
  }
  const down = await createOidc({ issuer: ISS, clientId: 'c', fetch: async () => { throw new TypeError('fetch failed'); } }).probe();
  assert.deepEqual([down.ok, down.code], [false, 'unreachable']);
});

test('routes: /api/health carries the sign-in probe; anonymous reads auth.ok, an architect reads the provider code, and the top-level ok stays true (Issue #1178)', async () => {
  const idp = await startIdp();
  const w = new Weave();
  const architect = w.createAccount({ name: 'root', role: 'architect' }).token;
  w.setRequireAuth(true);
  const oidc = createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: 'rotated-away', name: 'Clerk' });
  const errors = [];
  const was = console.error;
  console.error = (line) => errors.push(String(line));
  const { server, port } = await startServer(w, { port: 0, oidc, authProbeEvery: 40 });
  const health = async (token) => (await fetch(`http://127.0.0.1:${port}/api/health`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })).json();
  try {
    let body;
    for (let i = 0; i < 200 && !(body = await health(architect)).auth; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(body.ok, true, 'an auth fault never fails the Railway check or the release swap');
    assert.deepEqual([body.auth.ok, body.auth.status, body.auth.code], [false, 401, 'invalid_client']);
    assert.deepEqual(await health(null), { ok: true, name: 'weave', auth: { ok: false } }, 'anonymous learns only whether sign-in works');
    assert.ok(errors.some((l) => /sign-in is broken: Clerk answered 401 invalid_client/.test(l)), errors.join('\n'));
    const seen = idp.seen.token.length;
    for (let i = 0; i < 200 && idp.seen.token.length === seen; i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(idp.seen.token.length > seen, 'the probe runs again on its interval');
  } finally { console.error = was; server.close(); idp.stop(); }
  const quiet = new Weave();
  const off = await startServer(quiet, { port: 0, oidc: null, authProbeEvery: 40 });
  try {
    assert.equal('auth' in (await (await fetch(`http://127.0.0.1:${off.port}/api/health`)).json()), false, 'no provider, no auth block');
  } finally { off.server.close(); }
});

test('cli: weave serve probes sign-in at start and every fifteen minutes (Issue #1178)', async () => {
  const { readFileSync } = await import('node:fs');
  const bin = readFileSync(BIN, 'utf8');
  assert.match(bin, /await startServer\(w, \{[^}]*authProbeEvery: 15 \* 60_000/);
});

test('routes: signing in provisions nobody — a stranger, and the linked email under a new subject, are refused', async () => {
  const s = await serve();
  try {
    for (const [why, claims] of [
      ['stranger', { sub: 'user_x', email: 'stranger@example.com', email_verified: true }],
      ['same email, new subject', { ...KYLE, sub: 'user_impostor' }],
    ]) {
      const { res } = await s.signIn(claims);
      assert.equal(res.status, 403, why);
      assert.equal(res.headers.get('set-cookie'), null, why);
      const page = await res.text();
      assert.match(page, /<h1>No access to /, why);
      assert.match(page, /invite link/, `${why}: the page says what to do`);
      assert.match(page, /A workspace architect can send you an invite link/, `${why}: the page names the role by its current name`);
      assert.ok(!/\badmin\b/i.test(page), `${why}: the page names no admin`);
      assert.ok(!mail.test(page), `${why}: the page names no email`);
    }
    assert.equal((await s.signIn(KYLE)).res.status, 302);
    assert.equal(Object.keys(s.w.state.meta.sessions).length, 1);
  } finally { s.stop(); }
});

test('routes: with billing on, the No access page also offers a workspace of your own and holds the login for /start', async () => {
  const billing = createBilling({ secretKey: 'clerk-test', soloPlan: 'solo', teamPlan: 'team', fetch: async () => new Response('{}', { status: 404 }) });
  const s = await serve({ billing });
  try {
    const { res } = await s.signIn({ sub: 'user_x', email: 'stranger@example.com', email_verified: true });
    assert.equal(res.status, 403);
    const page = await res.text();
    assert.match(page, /<h1>No access to /);
    assert.match(page, /A workspace architect can send you an invite link/, 'the invite advice stays');
    assert.match(page, /<a class="provider" href="\/start">Start your own workspace<\/a>/);
    const held = res.headers.getSetCookie().find((c) => c.startsWith('wv_start='))?.split(';')[0];
    assert.ok(held, 'the login is held for the start page');
    assert.equal(Object.keys(s.w.state.meta.sessions ?? {}).length, 0, 'no session on the workspace it has no access to');
    const start = await (await s.call('GET', '/api/start', { cookie: held })).json();
    assert.deepEqual([start.signedIn, start.rows, start.canCreate], [true, [], true]);
  } finally { s.stop(); }
});

test('handbook: no guide names the architect role "admin" except the rename note that maps the old names', async () => {
  const { GUIDES } = await import('../src/handbook.js');
  const hits = [];
  for (const g of GUIDES) for (const line of g.doc.split('\n')) if (/\badmin\b/i.test(line) && !/\breader\b/.test(line)) hits.push(`${g.name}: ${line.slice(0, 120)}`);
  assert.deepEqual(hits, [], 'a guide line says admin where the role is architect (Feature #255)');
});

test('routes: a token that fails verification never becomes a session', async () => {
  const s = await serve();
  try {
    for (const what of ['signature', 'nonce', 'aud', 'iss', 'expired']) {
      s.idp.tamper(what);
      const { res } = await s.signIn(KYLE);
      assert.equal(res.status, 401, what);
      assert.equal(res.headers.get('set-cookie'), null, what);
    }
    s.idp.tamper(null);
    assert.equal(Object.keys(s.w.state.meta.sessions ?? {}).length, 0);
  } finally { s.stop(); }
});

test('routes: state is one-time, and a callback weave did not start is refused', async () => {
  const s = await serve();
  try {
    const { back, trip, res } = await s.signIn(KYLE);
    assert.equal(res.status, 302);
    assert.equal((await s.call('GET', back.pathname + back.search, { cookie: trip })).status, 400, 'replayed');
    assert.equal((await s.call('GET', '/api/auth/oidc/callback?code=abc&state=made-up')).status, 400);
    assert.equal((await s.call('GET', '/api/auth/oidc/callback?error=access_denied&state=made-up')).status, 400);
  } finally { s.stop(); }
});

test('routes: a callback finishes only in the browser that started it', async () => {
  const s = await serve();
  try {
    const start = await s.call('GET', '/api/auth/oidc/start');
    assert.match(start.headers.get('set-cookie'), /^wv_oidc=[\w-]{32,}; HttpOnly; SameSite=Lax; Path=\/api\/auth\/oidc; Max-Age=300/);
    const back = s.idp.approve(start.headers.get('location'), KYLE);
    const other = await s.call('GET', back.pathname + back.search);
    assert.equal(other.status, 400);
    assert.equal(other.headers.get('set-cookie'), null);
    assert.equal(s.idp.seen.token.length, 0, 'the code was never redeemed');
    const wrong = await s.call('GET', back.pathname + back.search, { cookie: 'wv_oidc=someone-elses-trip' });
    assert.equal(wrong.status, 400);
    assert.equal(Object.keys(s.w.state.meta.sessions ?? {}).length, 0);
  } finally { s.stop(); }
});

test('routes: a provider that stops answering mid-trip is a 502 page, never a session', async () => {
  const s = await serve();
  try {
    const start = await s.call('GET', '/api/auth/oidc/start');
    const back = s.idp.approve(start.headers.get('location'), KYLE);
    s.idp.stop();
    const res = await s.call('GET', back.pathname + back.search, { cookie: cookieOf(start) });
    assert.equal(res.status, 502);
    assert.equal(res.headers.get('set-cookie'), null);
    assert.match(await res.text(), /Clerk is not answering/);
    assert.equal(Object.keys(s.w.state.meta.sessions ?? {}).length, 0);
  } finally { s.stop(); }
});

test('routes: next stays on this origin', async () => {
  const s = await serve();
  try {
    for (const next of ['//evil.example/x', 'https://evil.example/', '/\\evil.example']) {
      const { res } = await s.signIn(KYLE, { next });
      assert.equal(res.headers.get('location'), '/', next);
    }
  } finally { s.stop(); }
});

const hrefs = (html) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
const intoRedirect = (href) => { const u = new URL(href, 'http://x'); return /(^|\/)auth$/.test(u.pathname) && !u.searchParams.has('signed-out'); };

test('routes: an identity with no account gets a page that offers a different account and never links into the redirect (Issue #570)', async () => {
  const s = await serve();
  try {
    const { res } = await s.signIn({ sub: 'user_x', email: 'stranger@example.com', email_verified: true }, { next: '/#/Dev/Task' });
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const html = await res.text();
    assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
    assert.match(html, /<meta name="viewport"/);
    assert.ok(!mail.test(html), 'the refusal page names no email');
    assert.match(html, /invite link/);
    const links = hrefs(html);
    assert.deepEqual(links.filter(intoRedirect), [], `a link leads into the automatic redirect: ${links}`);
    assert.ok(links.includes('/auth?signed-out=1'), `Back to sign in: ${links}`);
    assert.match(html, /href="[^"]*"[^>]*>Use a different account</);
    const other = links.find((h) => h.startsWith('/api/auth/oidc/start'));
    assert.ok(other, `Use a different account: ${links}`);
    const start = await s.call('GET', other);
    assert.equal(start.status, 302);
    const to = new URL(start.headers.get('location'));
    assert.equal(to.origin + to.pathname, `${s.idp.issuer}/oauth/authorize`);
    assert.equal(to.searchParams.get('prompt'), 'login');
    assert.equal(new URL((await s.call('GET', '/api/auth/oidc/start')).headers.get('location')).searchParams.get('prompt'), null);
    const back = s.idp.approve(start.headers.get('location'), KYLE);
    const done = await s.call('GET', back.pathname + back.search, { cookie: cookieOf(start) });
    assert.equal(done.status, 302);
    assert.equal(done.headers.get('location'), '/#/Dev/Task');
    const after = await s.call('GET', '/auth?signed-out=1');
    assert.equal(after.status, 200);
    assert.equal(after.headers.get('location'), null);
    assert.match(await after.text(), /Sign in with Clerk/);
  } finally { s.stop(); }
});

test('routes: an invite opened as someone already known offers a different account that keeps the invite', async () => {
  const s = await serve({ link: null });
  try {
    s.w.redeemIdentityInvite(s.w.linkIdentity('eye', { issuer: s.idp.issuer }).code, { issuer: s.idp.issuer, subject: 'user_eye' });
    const inv = await (await s.call('POST', '/api/accounts/kyle/identities', { body: {}, token: s.admin })).json();
    const { res } = await s.signIn({ sub: 'user_eye' }, { invite: inv.code, next: '/#/Dev/Task' });
    assert.equal(res.status, 409);
    const links = hrefs(await res.text());
    assert.deepEqual(links.filter(intoRedirect), [], String(links));
    assert.ok(links.includes('/auth?signed-out=1'), String(links));
    const other = links.find((h) => h.startsWith('/api/auth/oidc/start?fresh=1'));
    assert.ok(other, String(links));
    const start = await s.call('GET', other);
    assert.equal(new URL(start.headers.get('location')).searchParams.get('prompt'), 'login');
    const back = s.idp.approve(start.headers.get('location'), KYLE);
    const done = await s.call('GET', back.pathname + back.search, { cookie: cookieOf(start) });
    assert.equal(done.status, 302, 'the right person spends the invite on the second trip');
    assert.equal(done.headers.get('location'), '/#/Dev/Task');
    assert.deepEqual(s.w.listAccounts().find((a) => a.name === 'kyle').identities.map((i) => i.subject), ['user_kyle']);
  } finally { s.stop(); }
});

test('routes: with an end-session endpoint in discovery, a different account signs out at the provider first', async () => {
  const s = await serve({ idpOptions: { endSession: true } });
  try {
    const { res } = await s.signIn({ sub: 'user_x', email: 'stranger@example.com', email_verified: true });
    assert.equal(res.status, 403);
    const out = hrefs(await res.text()).find((h) => h.startsWith(s.idp.issuer));
    assert.ok(out, 'the different-account link goes to the provider');
    const u = new URL(out);
    assert.equal(u.origin + u.pathname, `${s.idp.issuer}/oauth/logout`);
    assert.equal(u.searchParams.get('client_id'), s.idp.clientId);
    assert.equal(u.searchParams.get('post_logout_redirect_uri'), `${s.base}/auth?signed-out=1`);
  } finally { s.stop(); }
});

test('routes: a workspace under /w/<name> gets its own sign-in page back from the no-account page', async () => {
  const s = await serve();
  try {
    const name = s.w.state.meta.name;
    const start = await s.call('GET', `/w/${name}/api/auth/oidc/start`);
    const back = s.idp.approve(start.headers.get('location'), { sub: 'user_x', email: 'stranger@example.com', email_verified: true });
    const res = await s.call('GET', back.pathname + back.search, { cookie: cookieOf(start) });
    assert.equal(res.status, 403);
    const links = hrefs(await res.text());
    assert.ok(links.includes(`/w/${name}/auth?signed-out=1`), String(links));
    assert.ok(links.some((h) => h.startsWith(`/w/${name}/api/auth/oidc/start?fresh=1`)), String(links));
  } finally { s.stop(); }
});

test('routes: no sign-in refusal page links into the automatic redirect', async () => {
  const s = await serve();
  try {
    const pages = [];
    pages.push(['expired', await s.call('GET', '/api/auth/oidc/callback?code=abc&state=made-up')]);
    const start = await s.call('GET', '/api/auth/oidc/start');
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    pages.push(['provider error', await s.call('GET', `/api/auth/oidc/callback?error=access_denied&state=${state}`, { cookie: cookieOf(start) })]);
    s.idp.tamper('signature');
    pages.push(['unverified token', (await s.signIn(KYLE)).res]);
    s.idp.tamper(null);
    const trip = await s.call('GET', '/api/auth/oidc/start');
    const back = s.idp.approve(trip.headers.get('location'), KYLE);
    s.idp.stop();
    pages.push(['provider down', await s.call('GET', back.pathname + back.search, { cookie: cookieOf(trip) })]);
    const cold = await serve();
    cold.idp.stop();
    pages.push(['provider down at start', await cold.call('GET', '/api/auth/oidc/start?next=%2Fx')]);
    cold.stop();
    for (const [why, res] of pages) {
      assert.ok(res.status >= 400, `${why}: ${res.status}`);
      assert.match(res.headers.get('content-type'), /text\/html/, why);
      assert.equal(res.headers.get('cache-control'), 'no-store', why);
      const links = hrefs(await res.text());
      assert.deepEqual(links.filter(intoRedirect), [], `${why}: ${links}`);
      assert.ok(links.includes('/auth?signed-out=1'), `${why}: ${links}`);
    }
  } finally { s.stop(); }
});

const quietErrors = () => {
  const lines = [];
  const was = console.error;
  console.error = (line) => lines.push(String(line));
  return { lines, restore: () => { console.error = was; } };
};

test('routes: a provider that refuses weave\'s own client gets a "broken on weave\'s side" page with nothing to retry (Issue #1179)', async () => {
  const s = await serve();
  const log = quietErrors();
  try {
    const pages = [];
    for (const code of ['invalid_client', 'invalid_scope', 'unauthorized_client']) {
      s.idp.tamper(code);
      pages.push([`token endpoint ${code}`, code, (await s.signIn(KYLE)).res]);
    }
    s.idp.tamper('invalid_client');
    const onboarding = await s.call('GET', '/api/auth/oidc/start?start=1');
    const back = s.idp.approve(onboarding.headers.get('location'), KYLE);
    pages.push(['token endpoint from /start', 'invalid_client', await s.call('GET', back.pathname + back.search, { cookie: cookieOf(onboarding) })]);
    s.idp.tamper(null);
    const start = await s.call('GET', '/api/auth/oidc/start');
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    pages.push(['authorization endpoint invalid_scope', 'invalid_scope', await s.call('GET', `/api/auth/oidc/callback?error=invalid_scope&state=${state}`, { cookie: cookieOf(start) })]);
    for (const [why, code, res] of pages) {
      assert.equal(res.status, 503, why);
      assert.equal(res.headers.get('set-cookie'), null, why);
      assert.equal(res.headers.get('cache-control'), 'no-store', why);
      const html = await res.text();
      assert.match(html, /<h1>Sign-in is broken on weave&#39;s side<\/h1>|<h1>Sign-in is broken on weave's side<\/h1>/, why);
      assert.match(html, new RegExp(`Clerk refused weave(&#39;|')s own credentials \\(${code}\\)`), why);
      assert.match(html, /will not help/, why);
      assert.deepEqual(hrefs(html), [], `${why}: no link back into the loop`);
    }
    assert.equal(log.lines.filter((l) => /ALERT sign-in is broken/.test(l)).length, pages.length, log.lines.join('\n'));
    assert.equal(Object.keys(s.w.state.meta.sessions ?? {}).length, 0);
  } finally { log.restore(); s.stop(); }
});

test('routes: every other failed verification keeps Back to sign in and adds Use a different account, which asks the provider for a fresh login (Issue #1179)', async () => {
  const s = await serve();
  try {
    s.idp.tamper('signature');
    const unverified = (await s.signIn(KYLE, { next: '/#/Dev/Task' })).res;
    assert.equal(unverified.status, 401);
    const start = await s.call('GET', '/api/auth/oidc/start');
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const denied = await s.call('GET', `/api/auth/oidc/callback?error=access_denied&state=${state}`, { cookie: cookieOf(start) });
    assert.equal(denied.status, 400);
    s.idp.tamper(null);
    for (const [why, res] of [['unverified', unverified], ['denied', denied]]) {
      const html = await res.text();
      assert.match(html, />Back to sign in</, why);
      assert.match(html, />Use a different account</, why);
      const links = hrefs(html);
      assert.ok(links.includes('/auth?signed-out=1'), `${why}: ${links}`);
      const other = links.find((h) => h.startsWith('/api/auth/oidc/start?fresh=1'));
      assert.ok(other, `${why}: ${links}`);
      const again = await s.call('GET', other);
      assert.equal(new URL(again.headers.get('location')).searchParams.get('prompt'), 'login', `${why}: the provider asks who you are instead of approving silently`);
      if (why === 'unverified') {
        const back = s.idp.approve(again.headers.get('location'), KYLE);
        const done = await s.call('GET', back.pathname + back.search, { cookie: cookieOf(again) });
        assert.deepEqual([done.status, done.headers.get('location')], [302, '/#/Dev/Task']);
      }
    }
  } finally { s.stop(); }
  const ended = await serve({ idpOptions: { endSession: true } });
  try {
    ended.idp.tamper('signature');
    const out = hrefs(await (await ended.signIn(KYLE)).res.text()).find((h) => h.startsWith(ended.idp.issuer));
    assert.ok(out, 'with an end-session endpoint, Use a different account ends the provider session first');
    assert.equal(new URL(out).pathname, '/oauth/logout');
  } finally { ended.stop(); }
});

test('routes: a rate-limited sign-in is a page with a way back, not bare JSON', async () => {
  const s = await serve({ limits: { options: 1, failed: 1 } });
  try {
    await s.call('GET', '/api/auth/oidc/callback?code=abc&state=made-up');
    const res = await s.call('GET', '/api/auth/oidc/callback?code=abc&state=made-up');
    assert.equal(res.status, 429);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const links = hrefs(await res.text());
    assert.deepEqual(links.filter(intoRedirect), []);
    assert.ok(links.includes('/auth?signed-out=1'), String(links));
    await s.call('GET', '/api/auth/oidc/start');
    const busy = await s.call('GET', '/api/auth/oidc/start');
    assert.equal(busy.status, 429);
    assert.match(busy.headers.get('content-type'), /text\/html/);
  } finally { s.stop(); }
});

test('routes: linking is an admin verb that answers with an invite link', async () => {
  const s = await serve({ link: null });
  try {
    assert.equal((await s.call('POST', '/api/accounts/kyle/identities', { body: {} })).status, 401);
    assert.equal((await s.call('POST', '/api/accounts/kyle/identities', { body: {}, token: s.reader })).status, 403);
    const made = await s.call('POST', '/api/accounts/kyle/identities', { body: {}, token: s.admin });
    assert.equal(made.status, 201);
    const inv = await made.json();
    assert.equal(inv.issuer, s.idp.issuer, 'the issuer defaults to the configured provider');
    assert.equal(inv.url, `${s.base}/api/auth/oidc/start?invite=${inv.code}`);
    assert.ok(inv.expiresAt);
    const old = await s.call('POST', '/api/accounts/kyle/identities', { body: { email: 'kyle@example.com' }, token: s.admin });
    assert.equal(old.status, 400, 'an email is refused, not stored');
  } finally { s.stop(); }
});

test('routes: an invite link signs the person in through the provider and pins them, once', async () => {
  const s = await serve({ link: null });
  try {
    assert.equal((await s.signIn(KYLE)).res.status, 403, 'not linked yet');
    const inv = await (await s.call('POST', '/api/accounts/kyle/identities', { body: {}, token: s.admin })).json();
    const { start, res, cookie } = await s.signIn(KYLE, { invite: inv.code });
    assert.equal(start.status, 302);
    assert.equal(new URL(start.headers.get('location')).searchParams.get('scope'), 'openid email profile');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/');
    const me = await (await s.call('GET', '/api/auth/me', { cookie })).json();
    assert.equal(me.account.name, 'kyle');
    assert.deepEqual(me.account.identities.map((i) => i.subject), ['user_kyle']);
    assert.equal(me.account.identities[0].verifiedEmail, 'kyle@example.com', 'a member sees their own address');
    assert.equal((await s.signIn(KYLE)).res.status, 302);
    const again = await s.call('GET', `/api/auth/oidc/start?invite=${inv.code}`);
    assert.equal(again.status, 410);
    assert.match(await again.text(), /expired or was already used/);
    assert.ok(!mail.test(JSON.stringify(s.w.exportJSON().meta)), 'no email exported');
    assert.ok(!mail.test(JSON.stringify(s.w.listAudit({ limit: -1 }))), 'no email audited');
  } finally { s.stop(); }
});

test('routes: an expired invite, or one for a subject that already opens another account, pins nothing', async () => {
  const s = await serve({ link: null });
  try {
    const expired = await (await s.call('POST', '/api/accounts/kyle/identities', { body: {}, token: s.admin })).json();
    for (const i of Object.values(s.w.state.meta.identityInvites)) i.expiresAt = new Date(Date.now() - 1000).toISOString();
    assert.equal((await s.call('GET', `/api/auth/oidc/start?invite=${expired.code}`)).status, 410);
    assert.equal((await s.call('GET', '/api/auth/oidc/start?invite=wvi_made-up')).status, 410);

    s.w.redeemIdentityInvite(s.w.linkIdentity('eye', { issuer: s.idp.issuer }).code, { issuer: s.idp.issuer, subject: 'user_eye' });
    const inv = await (await s.call('POST', '/api/accounts/kyle/identities', { body: {}, token: s.admin })).json();
    const { res } = await s.signIn({ sub: 'user_eye' }, { invite: inv.code });
    assert.equal(res.status, 409);
    assert.equal(res.headers.get('set-cookie'), null);
    assert.match(await res.text(), /already opens another account/);
    assert.equal(s.w.identityInvite(inv.code).account, 'kyle', 'the invite is still there for the right person');
    assert.equal(s.w.listAccounts().find((a) => a.name === 'kyle').identities, undefined);
  } finally { s.stop(); }
});

test('routes: unlink takes the subject', async () => {
  const s = await serve();
  try {
    assert.equal((await s.signIn(KYLE)).res.status, 302);
    const gone = await s.call('DELETE', '/api/accounts/kyle/identities?subject=user_kyle', { token: s.admin });
    assert.equal(gone.status, 200);
    assert.deepEqual(await gone.json(), { unlinked: 1, remaining: 0 });
    assert.equal((await s.signIn(KYLE)).res.status, 403);
  } finally { s.stop(); }
});
