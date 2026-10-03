/* The built-in passkey door is gone (Feature #243). Sign-in is one OpenID
   Connect provider (door C, Feature #212) on the session machinery door B
   introduced; the hand-rolled WebAuthn ceremonies, invites and credential
   verbs went with Kyle's "rip out our hard coded passkey handing now we've
   switched to clerk" (2026-09-29). What this file pins:
   - the four ceremony routes and the credential delete answer as unknown
     routes, with or without a token;
   - the sign-in page carries no passkey or register-device control and still
     offers the provider;
   - the CLI refuses `account invite` and `account remove-credential`, and its
     help does not list them;
   - an account row that still carries a pre-removal credentials[] loads,
     lists, exports and signs in through the provider without error;
   - nothing under src/, bin/ or public/ imports or names webauthn. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { createOidc } from '../src/oidc.js';
import { renderAuthPage } from '../src/auth-page.js';
import { startIdp } from './lib/idp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'weave.js');

const PASSKEY_ROUTES = [
  ['POST', '/api/auth/register/options'],
  ['POST', '/api/auth/register/verify'],
  ['POST', '/api/auth/login/options'],
  ['POST', '/api/auth/login/verify'],
  ['DELETE', '/api/auth/credentials/abc'],
];

/* A pre-removal account row: what a workspace that once registered a
   passkey still holds. */
const OLD_CREDENTIAL = { id: 'cred-old', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' }, alg: -7, counter: 4, transports: ['internal'], label: 'Old phone', createdAt: '2026-09-01T00:00:00.000Z', lastUsedAt: null };

async function serve({ requireAuth = true } = {}) {
  const idp = await startIdp();
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  const admin = w.createAccount({ name: 'root', role: 'admin' }).token;
  const kyle = w.createAccount({ name: 'kyle', role: 'admin' });
  w.state.meta.accounts[kyle.account.id].credentials = [structuredClone(OLD_CREDENTIAL)];
  w.save();
  w.linkIdentity('kyle', { issuer: idp.issuer, email: 'kyle@example.com' });
  if (requireAuth) w.setRequireAuth(true);
  const oidc = createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' });
  const { server } = await startServer(w, { port: 0, origin: null, oidc, limits: { options: 1000, failed: 1000 } });
  const base = `http://localhost:${server.address().port}`;
  const call = (method, path, { token, body, cookie } = {}) => fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: ['POST', 'PUT', 'PATCH'].includes(method) ? JSON.stringify(body ?? {}) : undefined,
    redirect: 'manual',
  });
  const cookieOf = (res) => (res.headers.get('set-cookie') ?? '').split(';')[0];
  const signIn = async (claims) => {
    const start = await call('GET', '/api/auth/oidc/start');
    const back = idp.approve(start.headers.get('location'), claims);
    const res = await call('GET', back.pathname + back.search, { cookie: cookieOf(start) });
    return { res, cookie: cookieOf(res) };
  };
  return { w, idp, admin, base, call, signIn, stop: () => { server.close(); idp.stop(); } };
}

test('routes: the passkey ceremonies and the credential delete are unknown routes, with or without a token', async () => {
  for (const requireAuth of [true, false]) {
    const s = await serve({ requireAuth });
    try {
      for (const [method, path] of PASSKEY_ROUTES) {
        for (const token of [null, s.admin]) {
          const res = await s.call(method, path, { token, body: {} });
          assert.equal(res.status, 404, `${method} ${path} (requireAuth ${requireAuth}, ${token ? 'token' : 'anonymous'}) answered ${res.status}`);
          assert.equal((await res.json()).code, 'not-found');
        }
      }
    } finally { s.stop(); }
  }
});

test('page: the sign-in page has no passkey or register-device control and still offers the provider', async () => {
  for (const html of [renderAuthPage({ workspace: 'w', provider: 'Clerk' }), renderAuthPage({ workspace: 'w' })]) {
    for (const gone of [/passkey/i, /Register this device/i, /Add this device/i, /webauthn/i, /PublicKeyCredential/, /navigator\.credentials/, /invite/i, /\/login\//, /\/register\//, /\/credentials\//]) {
      assert.doesNotMatch(html, gone, `the page still carries ${gone}`);
    }
    assert.match(html, /Sign out/, 'sign-out stays');
    assert.match(html, /id="sessions"/, 'the session list stays');
  }
  assert.match(renderAuthPage({ mount: '/w/docs', workspace: 'w', provider: 'Clerk' }), /id="oidc"[^>]*href="\/w\/docs\/api\/auth\/oidc\/start"[^>]*>Sign in with Clerk</);
  const s = await serve();
  try {
    const page = await (await s.call('GET', '/auth?signed-out=1')).text();
    assert.match(page, /Sign in with Clerk/);
    assert.doesNotMatch(page, /passkey|Register this device/i);
    const wall = await (await s.call('GET', '/', { token: 'wv_bogus' })).text();
    assert.doesNotMatch(wall, /passkey/i, 'the wall page no longer points at passkeys');
    assert.match(wall, /Sign in with Clerk/);
  } finally { s.stop(); }
});

/* Kyle, 2026-10-02 (Issue #569): "remove this page a redirect directly to
   clerk login". With a provider, a signed-out browser never sees the wall
   page: it gets a 302 to /auth, which goes on to the provider. An API
   caller keeps the JSON 401, and a bad Bearer token keeps the 401 page,
   since sign-in is no answer to a wrong token and the header would follow
   the redirect round. */
test('routes: with a provider, the wall sends a signed-out browser to sign-in; the API keeps its 401', async () => {
  const s = await serve();
  try {
    const name = s.w.state.meta.name;
    for (const [path, next] of [['/', '/'], ['/e/nope/doc.html', '/e/nope/doc.html'], [`/w/${name}/`, `/w/${name}/`]]) {
      const res = await s.call('GET', path);
      assert.equal(res.status, 302, `${path} answered ${res.status}`);
      const prefix = path.startsWith('/w/') ? `/w/${name}` : '';
      assert.equal(res.headers.get('location'), `${prefix}/auth?next=${encodeURIComponent(next)}`);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.equal(await res.text(), '', 'no wall page');
    }
    const api = await s.call('GET', '/api/schema');
    assert.equal(api.status, 401);
    assert.equal((await api.json()).code, 'unauthorized');
    const bad = await s.call('GET', '/e/nope/doc.html', { token: 'wv_bogus' });
    assert.equal(bad.status, 401);
    assert.match(await bad.text(), /This workspace requires authentication/);
  } finally { s.stop(); }
});

/* Kyle, 2026-10-01: the sign-in page at /auth sends people straight to the
   provider. A signed-out browser gets a 302 to the start route, ?next kept,
   and never sees an intermediate page. The page itself is for a signed-in
   visitor (sessions, sign out) and for the moment right after sign-out,
   where an automatic trip to the provider would sign the person straight
   back in on the provider's own session. */
test('routes: a signed-out visit to /auth goes straight to the provider, keeping ?next', async () => {
  const s = await serve();
  try {
    const bare = await s.call('GET', '/auth');
    assert.equal(bare.status, 302);
    assert.equal(bare.headers.get('location'), '/api/auth/oidc/start');
    assert.equal(bare.headers.get('cache-control'), 'no-store');
    assert.equal(await bare.text(), '', 'no intermediate page');
    const kept = await s.call('GET', '/auth?next=' + encodeURIComponent('/#/Dev/Task'));
    assert.equal(kept.headers.get('location'), '/api/auth/oidc/start?next=' + encodeURIComponent('/#/Dev/Task'));
    for (const bad of ['//evil.example/x', 'https://evil.example/', '/\\evil.example']) {
      const r = await s.call('GET', '/auth?next=' + encodeURIComponent(bad));
      assert.equal(r.headers.get('location'), '/api/auth/oidc/start', `${bad} is not carried`);
    }
    // The start route it lands on goes on to the provider with that ?next.
    const start = await s.call('GET', kept.headers.get('location'));
    assert.equal(start.status, 302);
    const to = new URL(start.headers.get('location'));
    assert.equal(to.origin + to.pathname, `${s.idp.issuer}/oauth/authorize`);
    // From the wall: a signed-out page lands on the provider in three hops.
    const wall = await s.call('GET', '/e/nope/doc.html');
    assert.equal(wall.status, 302);
    const hop = await s.call('GET', wall.headers.get('location'));
    assert.equal(hop.status, 302);
    assert.match(hop.headers.get('location'), /^\/api\/auth\/oidc\/start\?next=%2Fe%2Fnope%2Fdoc\.html$/);
    // A dead session cookie is signed out too.
    const dead = await s.call('GET', '/auth', { cookie: 'wv_session=nope' });
    assert.equal(dead.status, 302);
    assert.equal(dead.headers.get('location'), '/api/auth/oidc/start');
    // A typed 127.0.0.1 moves to localhost first, where the redirect URI lives.
    const port = new URL(s.base).port;
    const ip = await fetch(`http://127.0.0.1:${port}/auth?next=%2Fx`, { redirect: 'manual' });
    assert.equal(ip.status, 302);
    assert.equal(ip.headers.get('location'), `http://localhost:${port}/auth?next=%2Fx`);
  } finally { s.stop(); }
});

test('routes: a signed-in visit to /auth, and the visit right after sign-out, get the page', async () => {
  const s = await serve();
  try {
    const { cookie } = await s.signIn({ sub: 'user_kyle', email: 'kyle@example.com', email_verified: true });
    const mine = await s.call('GET', '/auth', { cookie });
    assert.equal(mine.status, 200);
    assert.match(await mine.text(), /id="sessions"/);
    const after = await s.call('GET', '/auth?signed-out=1');
    assert.equal(after.status, 200);
    const page = await after.text();
    assert.match(page, /Sign in with Clerk/);
    assert.doesNotMatch(page, /passkey/i);
  } finally { s.stop(); }
  // Sign-out lands on that page rather than reloading into the provider.
  const html = renderAuthPage({ workspace: 'w', provider: 'Clerk' });
  assert.match(html, /\/auth\?signed-out=1/);
  assert.doesNotMatch(html, /location\.reload\(\)/);
});

test('cli: account invite and account remove-credential are unknown subcommands, and help does not list them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weave-nopasskey-'));
  try {
    const data = join(dir, 'w.db');
    const run = (args) => spawnSync(process.execPath, [BIN, '--data', data, ...args], { encoding: 'utf8', env: { ...process.env, WEAVE_UPDATE_CHECK: 'off' } });
    assert.equal(run(['account', 'create', 'kyle', '--role', 'admin']).status, 0);
    for (const sub of ['invite', 'remove-credential']) {
      const r = run(['account', sub, 'kyle', 'x']);
      assert.notEqual(r.status, 0, `account ${sub} still runs`);
      assert.match(r.stderr + r.stdout, new RegExp(`Unknown account subcommand '${sub}'`));
      assert.doesNotMatch((r.stderr + r.stdout).match(/Try: .*/)?.[0] ?? '', /invite|remove-credential/, 'the hint does not offer it');
    }
    const help = run(['help']).stdout;
    assert.match(help, /account sessions/);
    assert.match(help, /account revoke-session/);
    assert.match(help, /account link/);
    for (const gone of [/account invite/, /remove-credential/, /passkey/i]) assert.doesNotMatch(help, gone);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('data: an account that still carries credentials[] loads, lists, exports and imports without error', () => {
  const w = new Weave();
  const { account } = w.createAccount({ name: 'kyle', role: 'admin' });
  w.state.meta.accounts[account.id].credentials = [structuredClone(OLD_CREDENTIAL)];
  w.state.meta.invites = { deadbeef: { accountId: account.id, expiresAt: '2026-09-01T00:00:00.000Z' } };
  const listed = w.listAccounts().find((a) => a.name === 'kyle');
  assert.equal(listed.role, 'admin');
  assert.ok(!('credentials' in listed), 'the listing no longer shows stored passkeys');
  assert.ok(!('tokenHash' in listed));
  assert.deepEqual(w.state.meta.accounts[account.id].credentials, [OLD_CREDENTIAL], 'the stored data is left in place');
  const far = new Weave();
  far.importJSON(w.exportJSON());
  assert.equal(far.listAccounts()[0].name, 'kyle');
  const s = far.createSession('kyle');
  assert.equal(far.verifySession(s.token).name, 'kyle');
  for (const gone of ['createInvite', 'readInvite', 'consumeInvite', 'addCredential', 'removeCredential', 'credentialById', 'useCredential']) {
    assert.equal(typeof Weave.prototype[gone], 'undefined', `Weave#${gone} is still there`);
  }
});

test('routes: an account holding an old passkey signs in through the provider, and /api/auth/me carries no credentials', async () => {
  const s = await serve();
  try {
    const { res, cookie } = await s.signIn({ sub: 'user_kyle', email: 'kyle@example.com', email_verified: true });
    assert.equal(res.status, 302);
    const me = await (await s.call('GET', '/api/auth/me', { cookie })).json();
    assert.equal(me.account.name, 'kyle');
    assert.ok(!('credentials' in me), '/api/auth/me no longer lists passkeys');
    assert.ok(!('credentials' in me.account));
    const list = await (await s.call('GET', '/api/accounts', { token: s.admin })).json();
    assert.ok(list.every((a) => !('credentials' in a)));
  } finally { s.stop(); }
});

test('source: nothing under src/, bin/ or public/ imports or names webauthn', () => {
  assert.ok(!existsSync(join(ROOT, 'src/webauthn.js')), 'src/webauthn.js is gone');
  const walk = (d) => readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    if (n === 'vendor' || n === 'node_modules') return [];
    return statSync(p).isDirectory() ? walk(p) : /\.(m?js|html|css)$/.test(n) ? [p] : [];
  });
  const hits = ['src', 'bin', 'public'].flatMap((d) => walk(join(ROOT, d)))
    .filter((p) => /webauthn/i.test(readFileSync(p, 'utf8')))
    .map((p) => relative(ROOT, p));
  assert.deepEqual(hits, []);
});
