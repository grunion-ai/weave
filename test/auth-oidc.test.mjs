/* Door C, end to end without a browser (Feature #212, Feature #222 door C):
   sign in with one OpenID Connect provider — Clerk, Auth0, Keycloak, Google —
   on top of door B's session. The provider proves who is there; weave decides
   whether that person has an account. Nobody is provisioned by signing in: an
   architect mints a one-time invite for an account, the person signs in at the
   provider through it, and the provider's subject is pinned to the account.
   weave asks the provider for `openid` alone and stores no email (Feature
   #252). The provider is test/lib/idp.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { createOidc, oidcFromEnv } from '../src/oidc.js';
import { renderAuthPage } from '../src/auth-page.js';
import { startIdp } from './lib/idp.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'weave.js');

const ISS = 'https://clerk.example.com';

/* ---------------------------------------------------------------- engine */
const mail = /[\w.+-]+@[\w-]+\.[\w.]+/; // an email address, not the issuer's host

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
  const hit = w.redeemIdentityInvite(inv.code, { issuer: ISS, subject: 'user_1', email: 'kyle@example.com' });
  assert.equal(hit.name, 'kyle');
  assert.ok(!('tokenHash' in hit));
  const ids = w.listAccounts().find((a) => a.name === 'kyle').identities;
  assert.deepEqual(ids.map((i) => [i.issuer, i.subject]), [[ISS, 'user_1']]);
  assert.ok(!('email' in ids[0]), 'no email on the identity');
  assert.throws(() => w.redeemIdentityInvite(inv.code, { issuer: ISS, subject: 'user_1' }), /expired or was already used/, 'single use');
  assert.equal(w.identityInvite(inv.code), null);
  assert.equal(Object.keys(w.state.meta.identityInvites).length, 0);

  assert.equal(w.accountForIdentity({ issuer: ISS, subject: 'user_1' }).name, 'kyle');
  assert.equal(w.accountForIdentity({ issuer: ISS, subject: 'user_2', email: 'kyle@example.com', emailVerified: true }), null, 'an email opens nothing');
  assert.equal(w.accountForIdentity({ issuer: 'https://other.example', subject: 'user_1' }), null, 'another issuer is another namespace');

  // A subject already pinned elsewhere is refused, and the invite survives for the right person.
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
  assert.ok(!mail.test(JSON.stringify(w.state.meta)), 'no email in the workspace');
});

test('engine: an invite expires', () => {
  const w = new Weave();
  w.createAccount({ name: 'kyle', role: 'admin' });
  const inv = w.linkIdentity('kyle', { issuer: ISS });
  for (const i of Object.values(w.state.meta.identityInvites)) i.expiresAt = new Date(Date.now() - 1000).toISOString();
  assert.equal(w.identityInvite(inv.code), null);
  assert.throws(() => w.redeemIdentityInvite(inv.code, { issuer: ISS, subject: 'user_1' }), /expired or was already used/);
  assert.equal(w.listAccounts()[0].identities, undefined, 'nothing was pinned');
  // Minting the next one sweeps the dead ones.
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
    // The shape v0.4.54 wrote: linked by email, pinned at first sign-in.
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

/* ---------------------------------------------------------------- config */
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

/* ---------------------------------------------------------------- routes */
const cookieOf = (res) => (res.headers.get('set-cookie') ?? '').split(';')[0];

async function serve({ idpOptions, link = 'user_kyle', configured = true, limits = { options: 1000, failed: 1000 } } = {}) {
  const idp = await startIdp(idpOptions);
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  const admin = w.createAccount({ name: 'root', role: 'admin' }).token;
  const reader = w.createAccount({ name: 'eye', role: 'reader' }).token;
  w.createAccount({ name: 'kyle', role: 'writer' });
  if (link) w.redeemIdentityInvite(w.linkIdentity('kyle', { issuer: idp.issuer }).code, { issuer: idp.issuer, subject: link });
  w.setRequireAuth(true);
  const oidc = configured ? createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' }) : null;
  const { server } = await startServer(w, { port: 0, origin: null, oidc, limits });
  const base = `http://localhost:${server.address().port}`;
  const call = (method, path, { token, body, cookie } = {}) => fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: ['POST', 'PUT', 'PATCH'].includes(method) ? JSON.stringify(body ?? {}) : undefined,
    redirect: 'manual',
  });
  /* One trip: start at weave, sign in at the provider, come back. */
  const signIn = async (claims, { next, invite } = {}) => {
    const q = new URLSearchParams({ ...(next ? { next } : {}), ...(invite ? { invite } : {}) }).toString();
    const start = await call('GET', `/api/auth/oidc/start${q ? `?${q}` : ''}`);
    const authorize = start.headers.get('location');
    const trip = cookieOf(start);
    const back = idp.approve(authorize, claims);
    const res = await call('GET', back.pathname + back.search, { cookie: trip });
    return { start, authorize, back, trip, res, cookie: cookieOf(res) };
  };
  return { w, idp, admin, reader, base, call, signIn, stop: () => { server.close(); idp.stop(); } };
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
    assert.equal(q.get('scope'), 'openid', 'no email, no profile (Feature #252)');
    assert.equal(q.get('code_challenge_method'), 'S256');
    for (const k of ['state', 'nonce', 'code_challenge']) assert.ok(q.get(k)?.length >= 32, k);
    assert.notEqual(q.get('state'), q.get('nonce'));
    // Signed out, /auth goes straight here; the page is for after sign-out.
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
    assert.match(res.headers.get('set-cookie'), /^wv_session=[\w-]{40,}; HttpOnly; SameSite=Lax; Path=\//);
    assert.equal((await s.call('GET', '/api/spaces', { cookie })).status, 200);
    const me = await (await s.call('GET', '/api/auth/me', { cookie })).json();
    assert.deepEqual([me.account.name, me.role], ['kyle', 'editor']);
    assert.equal(me.account.identities[0].subject, 'user_kyle');
    assert.equal(s.idp.seen.token[0].form.grant_type, 'authorization_code');
    assert.ok(s.idp.seen.token[0].form.code_verifier.length >= 43);
    assert.ok(s.w.listAudit({ limit: 10 }).some((e) => e.action === 'session-created'));
    // Sign out is door B's.
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
      assert.deepEqual(who, { issuer: s.idp.issuer, subject: 'user_kyle' });
    } finally { s.stop(); }
  }
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
    // Someone signs in at the provider as themselves and hands the callback
    // URL to another browser: that browser never started a trip.
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

/* Issue #570: with a provider, bare /auth sends a signed-out browser on to
   the provider, and the provider still holds its own session. A refusal
   page that links to /auth therefore loops: provider, same identity, same
   refusal. Every link on a refusal page lands on /auth?signed-out=1, which
   renders, or leaves the provider's session behind. */
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
    assert.ok(!mail.test(html), 'no email: weave asks the provider for none (Feature #252)');
    assert.match(html, /invite link/);
    const links = hrefs(html);
    assert.deepEqual(links.filter(intoRedirect), [], `a link leads into the automatic redirect: ${links}`);
    assert.ok(links.includes('/auth?signed-out=1'), `Back to sign in: ${links}`);
    assert.match(html, /href="[^"]*"[^>]*>Use a different account</);
    // The provider names no end-session endpoint, so the other account is a
    // fresh trip that asks the provider to sign in again.
    const other = links.find((h) => h.startsWith('/api/auth/oidc/start'));
    assert.ok(other, `Use a different account: ${links}`);
    const start = await s.call('GET', other);
    assert.equal(start.status, 302);
    const to = new URL(start.headers.get('location'));
    assert.equal(to.origin + to.pathname, `${s.idp.issuer}/oauth/authorize`);
    assert.equal(to.searchParams.get('prompt'), 'login');
    // A plain start does not force a sign-in.
    assert.equal(new URL((await s.call('GET', '/api/auth/oidc/start')).headers.get('location')).searchParams.get('prompt'), null);
    // ?next survives the switch, and the switched trip signs the other person in.
    const back = s.idp.approve(start.headers.get('location'), KYLE);
    const done = await s.call('GET', back.pathname + back.search, { cookie: cookieOf(start) });
    assert.equal(done.status, 302);
    assert.equal(done.headers.get('location'), '/#/Dev/Task');
    // The page it points back at renders, with no redirect.
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
    // Discovery is cached once fetched, so a provider down at start needs a
    // server that never reached it.
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
    assert.equal(new URL(start.headers.get('location')).searchParams.get('scope'), 'openid');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/');
    const me = await (await s.call('GET', '/api/auth/me', { cookie })).json();
    assert.equal(me.account.name, 'kyle');
    assert.deepEqual(me.account.identities.map((i) => i.subject), ['user_kyle']);
    assert.ok(!('email' in me.account.identities[0]));
    // From now on the subject alone signs in.
    assert.equal((await s.signIn(KYLE)).res.status, 302);
    // The link is spent: start refuses it before the provider is asked.
    const again = await s.call('GET', `/api/auth/oidc/start?invite=${inv.code}`);
    assert.equal(again.status, 410);
    assert.match(await again.text(), /expired or was already used/);
    assert.ok(!mail.test(JSON.stringify(s.w.state.meta)), 'no email stored');
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
