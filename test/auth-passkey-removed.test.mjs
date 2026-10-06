import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Weave } from '../src/engine.js';
import { renderAuthPage } from '../src/auth-page.js';
import { startIdp, serveOidc } from './lib/idp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'weave.js');

const PASSKEY_ROUTES = [
  ['POST', '/api/auth/register/options'],
  ['POST', '/api/auth/register/verify'],
  ['POST', '/api/auth/login/options'],
  ['POST', '/api/auth/login/verify'],
  ['DELETE', '/api/auth/credentials/abc'],
];

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
  w.redeemIdentityInvite(w.linkIdentity('kyle', { issuer: idp.issuer }).code, { issuer: idp.issuer, subject: 'user_kyle' });
  if (requireAuth) w.setRequireAuth(true);
  return { w, idp, admin, ...await serveOidc(w, idp, { limits: { options: 1000, failed: 1000 } }) };
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
    const start = await s.call('GET', kept.headers.get('location'));
    assert.equal(start.status, 302);
    const to = new URL(start.headers.get('location'));
    assert.equal(to.origin + to.pathname, `${s.idp.issuer}/oauth/authorize`);
    const wall = await s.call('GET', '/e/nope/doc.html');
    assert.equal(wall.status, 302);
    const hop = await s.call('GET', wall.headers.get('location'));
    assert.equal(hop.status, 302);
    assert.match(hop.headers.get('location'), /^\/api\/auth\/oidc\/start\?next=%2Fe%2Fnope%2Fdoc\.html$/);
    const dead = await s.call('GET', '/auth', { cookie: 'wv_session=nope' });
    assert.equal(dead.status, 302);
    assert.equal(dead.headers.get('location'), '/api/auth/oidc/start');
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
  assert.equal(listed.role, 'architect');
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
