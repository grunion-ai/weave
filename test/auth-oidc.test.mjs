/* Door C, end to end without a browser (Feature #212, Feature #222 door C):
   sign in with one OpenID Connect provider — Clerk, Auth0, Keycloak, Google —
   on top of door B's session. The provider proves who is there; weave decides
   whether that person has an account. Nobody is provisioned by signing in: an
   admin links an account to a provider email first, the first sign-in pins
   the provider's subject to it, and the session that comes out is door B's
   cookie. The provider is test/lib/idp.mjs. */
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
test('engine: an identity is linked by email, pinned to the subject on first sign-in, and refused to anyone else', () => {
  const w = new Weave();
  w.createAccount({ name: 'kyle', role: 'admin' });
  w.createAccount({ name: 'eye', role: 'reader' });
  const linked = w.linkIdentity('kyle', { issuer: ISS, email: 'Kyle@Example.com' });
  assert.deepEqual([linked.issuer, linked.email, linked.subject], [ISS, 'kyle@example.com', null]);
  assert.throws(() => w.linkIdentity('eye', { issuer: ISS, email: 'kyle@example.com' }), /already linked/);
  assert.throws(() => w.linkIdentity('kyle', { issuer: ISS, email: 'nope' }), /email/);
  assert.throws(() => w.linkIdentity('nobody', { issuer: ISS, email: 'a@b.co' }), /not found/);

  assert.equal(w.accountForIdentity({ issuer: ISS, subject: 'user_1', email: 'stranger@example.com', emailVerified: true }), null, 'no account, no entry');
  assert.equal(w.accountForIdentity({ issuer: ISS, subject: 'user_1', email: 'kyle@example.com', emailVerified: false }), null, 'an unverified email proves nothing');
  assert.equal(w.accountForIdentity({ issuer: 'https://other.example', subject: 'user_1', email: 'kyle@example.com', emailVerified: true }), null, 'another issuer is another namespace');

  const hit = w.accountForIdentity({ issuer: ISS, subject: 'user_1', email: 'KYLE@example.com', emailVerified: true });
  assert.equal(hit.name, 'kyle');
  assert.ok(!('tokenHash' in hit));
  assert.equal(w.listAccounts().find((a) => a.name === 'kyle').identities[0].subject, 'user_1', 'pinned');
  assert.equal(w.accountForIdentity({ issuer: ISS, subject: 'user_2', email: 'kyle@example.com', emailVerified: true }), null, 'the same email under a new subject is someone else');
  assert.equal(w.accountForIdentity({ issuer: ISS, subject: 'user_1', email: 'moved@example.com', emailVerified: true }).name, 'kyle', 'once pinned, the subject is the identity');

  assert.deepEqual(w.unlinkIdentity('kyle', { issuer: ISS, email: 'kyle@example.com' }), { unlinked: 1, remaining: 0 });
  assert.equal(w.accountForIdentity({ issuer: ISS, subject: 'user_1', email: 'kyle@example.com', emailVerified: true }), null);
  const actions = w.listAudit({ limit: 20 }).map((e) => e.action);
  for (const a of ['identity-linked', 'identity-pinned', 'identity-unlinked']) assert.ok(actions.includes(a), a);
});

test('cli: account link takes the issuer from WEAVE_OIDC_ISSUER alone, or from --issuer', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-oidc-'));
  try {
    const data = join(dir, 'w.db');
    const run = (args, env = {}) => spawnSync(process.execPath, [BIN, '--data', data, ...args], { encoding: 'utf8', env: { ...process.env, WEAVE_OIDC_ISSUER: '', WEAVE_OIDC_CLIENT_ID: '', WEAVE_UPDATE_CHECK: 'off', ...env } });
    assert.equal(run(['account', 'create', 'kyle', '--role', 'admin']).status, 0);
    const bare = run(['account', 'link', 'kyle', '--email', 'kyle@example.com']);
    assert.notEqual(bare.status, 0);
    assert.match(bare.stderr + bare.stdout, /--issuer/);
    const fromEnv = run(['account', 'link', 'kyle', '--email', 'kyle@example.com'], { WEAVE_OIDC_ISSUER: `${ISS}/` });
    assert.equal(fromEnv.status, 0, fromEnv.stderr);
    assert.equal(JSON.parse(fromEnv.stdout).issuer, ISS);
    const flagged = run(['account', 'link', 'kyle', '--email', 'k2@example.com', '--issuer', 'https://other.example']);
    assert.equal(JSON.parse(flagged.stdout).issuer, 'https://other.example');
    assert.equal(JSON.parse(run(['account', 'list']).stdout)[0].identities.length, 2);
    assert.deepEqual(JSON.parse(run(['account', 'unlink', 'kyle', '--email', 'k2@example.com']).stdout), { unlinked: 1, remaining: 1 });
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

async function serve({ idpOptions, link = 'kyle@example.com', configured = true } = {}) {
  const idp = await startIdp(idpOptions);
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  const admin = w.createAccount({ name: 'root', role: 'admin' }).token;
  const reader = w.createAccount({ name: 'eye', role: 'reader' }).token;
  w.createAccount({ name: 'kyle', role: 'writer' });
  if (link) w.linkIdentity('kyle', { issuer: idp.issuer, email: link });
  w.setRequireAuth(true);
  const oidc = configured ? createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' }) : null;
  const { server } = await startServer(w, { port: 0, origin: null, oidc, limits: { options: 1000, failed: 1000 } });
  const base = `http://localhost:${server.address().port}`;
  const call = (method, path, { token, body, cookie } = {}) => fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: ['POST', 'PUT', 'PATCH'].includes(method) ? JSON.stringify(body ?? {}) : undefined,
    redirect: 'manual',
  });
  /* One trip: start at weave, sign in at the provider, come back. */
  const signIn = async (claims, { next } = {}) => {
    const start = await call('GET', `/api/auth/oidc/start${next ? `?next=${encodeURIComponent(next)}` : ''}`);
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
    assert.deepEqual(q.get('scope').split(' ').sort(), ['email', 'openid', 'profile']);
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
    assert.deepEqual([me.account.name, me.role], ['kyle', 'writer']);
    assert.equal(me.account.identities[0].subject, 'user_kyle');
    assert.equal(s.idp.seen.token[0].form.grant_type, 'authorization_code');
    assert.ok(s.idp.seen.token[0].form.code_verifier.length >= 43);
    assert.ok(s.w.listAudit({ limit: 10 }).some((e) => e.action === 'session-created'));
    // Sign out is door B's.
    await s.call('POST', '/api/auth/logout', { cookie });
    assert.equal((await s.call('GET', '/api/spaces', { cookie })).status, 401);
  } finally { s.stop(); }
});

test('routes: claims the id token leaves out are read from userinfo', async () => {
  const s = await serve({ idpOptions: { claimsInIdToken: false } });
  try {
    const { res } = await s.signIn(KYLE);
    assert.equal(res.status, 302);
    assert.equal(s.idp.seen.userinfo, 1);
  } finally { s.stop(); }
});

test('routes: signing in provisions nobody — a stranger, an unverified email and a new subject are refused', async () => {
  const s = await serve();
  try {
    for (const [why, claims] of [
      ['stranger', { sub: 'user_x', email: 'stranger@example.com', email_verified: true }],
      ['unverified', { sub: 'user_kyle', email: 'kyle@example.com', email_verified: false }],
    ]) {
      const { res } = await s.signIn(claims);
      assert.equal(res.status, 403, why);
      assert.equal(res.headers.get('set-cookie'), null, why);
      assert.match(await res.text(), /no account/i, why);
    }
    assert.equal((await s.signIn(KYLE)).res.status, 302);
    const { res } = await s.signIn({ ...KYLE, sub: 'user_impostor' });
    assert.equal(res.status, 403);
    assert.equal(Object.keys(s.w.state.meta.sessions).length, 1);
  } finally { s.stop(); }
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
    assert.equal(s.w.listAccounts().find((a) => a.name === 'kyle').identities[0].subject, null, 'nothing was pinned');
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

test('routes: linking an identity is an admin verb', async () => {
  const s = await serve({ link: null });
  try {
    const body = { issuer: s.idp.issuer, email: 'kyle@example.com' };
    assert.equal((await s.call('POST', '/api/accounts/kyle/identities', { body })).status, 401);
    assert.equal((await s.call('POST', '/api/accounts/kyle/identities', { body, token: s.reader })).status, 403);
    assert.equal((await s.signIn(KYLE)).res.status, 403);
    const made = await s.call('POST', '/api/accounts/kyle/identities', { body: { email: 'kyle@example.com' }, token: s.admin });
    assert.equal(made.status, 201);
    assert.equal((await made.json()).issuer, s.idp.issuer, 'the issuer defaults to the configured provider');
    assert.equal((await s.signIn(KYLE)).res.status, 302);
    const gone = await s.call('DELETE', `/api/accounts/kyle/identities?email=${encodeURIComponent('kyle@example.com')}`, { token: s.admin });
    assert.equal(gone.status, 200);
    assert.equal((await s.signIn(KYLE)).res.status, 403);
  } finally { s.stop(); }
});
