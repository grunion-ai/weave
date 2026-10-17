import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer, openSignupFromEnv } from '../src/server.js';
import { createOidc } from '../src/oidc.js';
import { createBilling, CLERK_API } from '../src/billing.js';
import { startIdp } from './lib/idp.mjs';

const hit = (port, host, method, path, { cookie, body, token, ua } = {}) => new Promise((resolve, reject) => {
  const payload = body === undefined ? null : JSON.stringify(body);
  const req = request({
    host: '127.0.0.1', port, method, path,
    headers: { Host: host, ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(ua ? { 'User-Agent': ua } : {}), ...(payload ? { 'Content-Type': 'application/json' } : {}) },
  }, (res) => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { text += c; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
  });
  req.on('error', reject);
  req.end(payload ?? undefined);
});
const cookieOf = (res, name) => [res.headers['set-cookie'] ?? []].flat().find((c) => c.startsWith(`${name}=`))?.split(';')[0];

async function serve({ openSignup = { on: false }, billing = null } = {}) {
  const idp = await startIdp();
  const oidc = createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' });
  const dir = mkdtempSync(join(tmpdir(), 'weave-setup-'));
  const taken = new Weave({ path: join(dir, 'harbor.db'), name: 'harbor' });
  taken.state.meta.name = 'harbor';
  taken.setRequireAuth(true);
  taken.save();
  taken.store.close?.();
  const main = new Weave({ path: join(dir, 'workspace.db'), name: 'Net' });
  main.state.meta.name = 'Net';
  main.createAccount({ name: 'Kyle', role: 'architect' });
  main.redeemIdentityInvite(main.linkIdentity('Kyle', { issuer: idp.issuer }).code, { issuer: idp.issuer, subject: 'user_kyle' });
  main.setRequireAuth(true);
  main.save();
  const { server, port } = await startServer(main, { port: 0, baseDomain: 'weave.test', origin: 'http://weave.test', oidc, openSignup, billing, limits: { options: 1000, failed: 1000, slugs: 1000 } });
  const at = (host) => (method, path, opts) => hit(port, host, method, path, opts);
  const apex = at('weave.test');
  const follow = (location, opts) => { const u = new URL(location, 'http://weave.test'); return at(u.host)('GET', u.pathname + u.search, opts); };
  const signIn = async (claims, { next } = {}) => {
    const start = await apex('GET', `/api/auth/oidc/start?start=1${next ? `&next=${encodeURIComponent(next)}` : ''}`);
    const back = idp.approve(start.headers.location, claims);
    const res = await follow(back.href, { cookie: cookieOf(start, 'wv_oidc') });
    return { res, cookie: cookieOf(res, 'wv_start'), start, back };
  };
  const open = (name) => new Weave({ path: join(dir, `${name}.db`) });
  return { dir, at, apex, follow, signIn, idp, open, stop: () => { server.close(); idp.stop(); rmSync(dir, { recursive: true, force: true }); } };
}

test('an empty hub root lets the first sign-in create, and the owner takes its name from the login', async () => {
  const idp = await startIdp();
  const oidc = createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' });
  const dir = mkdtempSync(join(tmpdir(), 'weave-setup-empty-'));
  const main = new Weave({ path: join(dir, 'workspace.db'), name: 'Net' });
  main.save();
  const { server, port } = await startServer(main, { port: 0, oidc, limits: { options: 1000, failed: 1000, slugs: 1000 } });
  try {
    const apex = (method, path, opts) => hit(port, `localhost:${port}`, method, path, opts);
    const start = await apex('GET', '/api/auth/oidc/start?start=1');
    const back = idp.approve(start.headers.location, { sub: 'first', email: 'first@example.com', email_verified: true });
    const res = await hit(port, `localhost:${port}`, 'GET', back.pathname + back.search, { cookie: cookieOf(start, 'wv_oidc') });
    const cookie = cookieOf(res, 'wv_start');
    const made = await apex('POST', '/api/start/workspaces', { cookie, body: { quick: true } });
    assert.equal(made.status, 201, made.text);
    assert.equal(made.json().name, 'first');
  } finally { server.close(); idp.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test('Clerk pane: the start API offers the Clerk script only when the key names the sign-in issuer', async () => {
  const { clerkKeyFromEnv } = await import('../src/server.js');
  assert.equal(clerkKeyFromEnv({}), null);
  assert.equal(clerkKeyFromEnv({ WEAVE_CLERK_PUBLISHABLE_KEY: 'sk_live_nope' }), null);
  const liveKey = `pk_live_${Buffer.from('clerk.weave.grunion.ai$').toString('base64')}`;
  assert.equal(clerkKeyFromEnv({ WEAVE_CLERK_PUBLISHABLE_KEY: ` ${liveKey} ` }), liveKey);
  const idp = await startIdp();
  const oidc = createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' });
  const main = new Weave();
  const serveWith = async (clerkKey) => {
    const { server, port } = await startServer(main, { port: 0, oidc, clerkKey });
    const res = await hit(port, `localhost:${port}`, 'GET', '/api/start');
    server.close();
    return res.json();
  };
  try {
    const matched = await serveWith(idp.publishableKey);
    assert.deepEqual(matched.clerk, { publishableKey: idp.publishableKey, script: `${idp.issuer}/npm/@clerk/clerk-js@6/dist/clerk.browser.js` });
    const other = await serveWith(`pk_test_${Buffer.from('clerk.someone-else.dev$').toString('base64')}`);
    assert.equal(other.clerk, undefined, 'a key for another Clerk instance is ignored');
    assert.equal((await serveWith(null)).clerk, undefined);
  } finally { idp.stop(); }
});

test('apex sign-up always starts onboarding: /auth goes to /start, and a sign-in begun anywhere on the apex returns there', async () => {
  const s = await serve({ openSignup: { on: true, limit: 1 } });
  try {
    for (const q of ['', '?signed-out=1', '?next=%2F']) {
      const auth = await s.apex('GET', `/auth${q}`);
      assert.deepEqual([auth.status, auth.headers.location], [302, '/start'], `/auth${q}`);
    }
    const start = await s.apex('GET', '/api/auth/oidc/start');
    const back = s.idp.approve(start.headers.location, { sub: 'user_fresh', email: 'fresh@example.com', email_verified: true });
    const res = await s.follow(back.href, { cookie: cookieOf(start, 'wv_oidc') });
    assert.deepEqual([res.status, res.headers.location], [302, '/start'], 'a new person lands in onboarding, never on No access');
    const me = (await s.apex('GET', '/api/start', { cookie: cookieOf(res, 'wv_start') })).json();
    assert.deepEqual([me.signedIn, me.canCreate, me.rows.length], [true, true, 0]);
    const host = await s.at('harbor.weave.test')('GET', '/auth');
    assert.notEqual(host.headers.location, '/start', 'a workspace host keeps its own sign-in');
  } finally { s.stop(); }
});

test('env: open sign-up is off unless the operator turns it on, with a per-person limit', () => {
  assert.deepEqual(openSignupFromEnv({}), { on: false, limit: 1 });
  assert.deepEqual(openSignupFromEnv({ WEAVE_OPEN_SIGNUP: '1' }), { on: true, limit: 1 });
  assert.deepEqual(openSignupFromEnv({ WEAVE_OPEN_SIGNUP: 'true', WEAVE_SIGNUP_LIMIT: '3' }), { on: true, limit: 3 });
  assert.deepEqual(openSignupFromEnv({ WEAVE_OPEN_SIGNUP: 'no', WEAVE_SIGNUP_LIMIT: 'lots' }), { on: false, limit: 1 });
});

test('closed sign-up: a stranger signs in, sees no workspace and cannot create one', async () => {
  const s = await serve();
  try {
    const { cookie } = await s.signIn({ sub: 'user_new', email: 'ada@example.com', email_verified: true });
    const me = (await s.apex('GET', '/api/start', { cookie })).json();
    assert.deepEqual([me.signedIn, me.canCreate, me.openSignup, me.rows], [true, false, false, []]);
    const refused = await s.apex('POST', '/api/start/workspaces', { cookie, body: { name: 'Ada', slug: 'ada' } });
    assert.deepEqual([refused.status, refused.json().code], [403, 'signup_closed']);
  } finally { s.stop(); }
});

test('open sign-up: a stranger creates one workspace from a template, owns it, and the modal never asks again', async () => {
  const s = await serve({ openSignup: { on: true, limit: 1 } });
  try {
    const { cookie } = await s.signIn({ sub: 'user_new', email: 'ada.park@example.com', email_verified: true });
    const me = (await s.apex('GET', '/api/start', { cookie })).json();
    assert.deepEqual([me.canCreate, me.openSignup, me.accountName], [true, true, 'ada.park']);
    const made = await s.apex('POST', '/api/start/workspaces', { cookie, body: { name: 'Ada Sales', slug: 'ada-sales', template: 'crm' } });
    assert.equal(made.status, 201);
    const body = made.json();
    assert.equal(body.name, 'ada-sales');
    assert.equal(body.open, '/api/start/open/ada-sales');
    assert.equal(body.mcp, 'http://ada-sales.weave.test/mcp');
    assert.equal(body.templateError, null);
    assert.ok(body.table, 'the first table to open');
    assert.ok(body.built.tables.length >= 2, 'the build names its tables for the animation');
    const w = s.open('ada-sales');
    const owner = w.listAccounts()[0];
    assert.deepEqual([owner.name, Weave.roleName(owner.role), owner.identities[0].subject], ['ada.park', 'architect', 'user_new']);
    assert.ok(w.onboardedAt(owner.id), 'setup counts as onboarding, so the in-app modal stays shut (Issue #911)');
    assert.ok(w.listTables().some((t) => t.id === body.table));
    assert.equal(w.state.meta.requireAuth, true);
    w.store.close?.();
    const again = await s.apex('POST', '/api/start/workspaces', { cookie, body: { name: 'Second', slug: 'second' } });
    assert.deepEqual([again.status, again.json().code], [403, 'signup_limit']);
    const after = (await s.apex('GET', '/api/start', { cookie })).json();
    assert.equal(after.canCreate, false, 'the limit shows before the person tries');
    assert.deepEqual(after.rows.map((r) => r.name), ['ada-sales']);
  } finally { s.stop(); }
});

test('quick setup: skip makes an empty workspace named for the person, on a free address', async () => {
  const s = await serve({ openSignup: { on: true, limit: 1 } });
  try {
    const { cookie } = await s.signIn({ sub: 'user_h', email: 'harbor@example.com', email_verified: true });
    const made = await s.apex('POST', '/api/start/workspaces', { cookie, body: { quick: true } });
    assert.equal(made.status, 201);
    assert.equal(made.json().name, 'harbor-2', 'harbor is taken, so the next free address');
    assert.equal(made.json().table, null);
    const w = s.open('harbor-2');
    assert.equal(w.listTables().filter((t) => !t.system).length, 0);
    w.store.close?.();
  } finally { s.stop(); }
});

test('create: an unknown template is refused before any workspace exists; a taken address keeps its code', async () => {
  const s = await serve({ openSignup: { on: true, limit: 1 } });
  try {
    const { cookie } = await s.signIn({ sub: 'user_x', email: 'x@example.com', email_verified: true });
    const bad = await s.apex('POST', '/api/start/workspaces', { cookie, body: { name: 'X', slug: 'x', template: 'nope' } });
    assert.deepEqual([bad.status, bad.json().code], [400, 'invalid']);
    assert.equal((await s.apex('GET', '/api/start/slug?slug=x', { cookie })).json().state, 'available');
    const lost = await s.apex('POST', '/api/start/workspaces', { cookie, body: { name: 'Harbor', slug: 'harbor' } });
    assert.deepEqual([lost.status, lost.json().code], [409, 'slug_taken']);
    assert.equal((await s.apex('GET', '/api/start', { cookie })).json().canCreate, true, 'a refused create spends nothing');
  } finally { s.stop(); }
});

test('agent step: the pane learns when the person first reaches the workspace over OAuth MCP', async () => {
  const s = await serve({ openSignup: { on: true, limit: 1 } });
  try {
    const { cookie } = await s.signIn({ sub: 'user_a', email: 'a@example.com', email_verified: true });
    const made = (await s.apex('POST', '/api/start/workspaces', { cookie, body: { name: 'Alpha', slug: 'alpha', template: 'tasks' } })).json();
    const seen = () => s.apex('GET', '/api/start/workspaces/alpha/agent', { cookie });
    assert.deepEqual((await seen()).json(), { connected: false, at: null, client: null });
    const host = s.at('alpha.weave.test');
    const anonymous = await host('POST', '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    assert.equal(anonymous.status, 401);
    assert.match(anonymous.headers['www-authenticate'], /resource_metadata="http:\/\/alpha\.weave\.test\/\.well-known\/oauth-protected-resource\/mcp"/);
    const token = s.idp.mint({ sub: 'user_a' });
    const listed = await host('POST', '/mcp', { token, ua: 'Claude-User', body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    assert.equal(listed.status, 200);
    const now = (await seen()).json();
    assert.deepEqual([now.connected, now.client], [true, 'Claude-User']);
    assert.ok(Date.parse(now.at));
    const other = await s.signIn({ sub: 'user_b', email: 'b@example.com', email_verified: true });
    assert.equal((await s.apex('GET', '/api/start/workspaces/alpha/agent', { cookie: other.cookie })).status, 403);
    assert.ok(made.mcp.endsWith('/mcp'));
  } finally { s.stop(); }
});

test('start sign-in: failures come back to the setup pane as a code, and next keeps a setup choice', async () => {
  const s = await serve({ openSignup: { on: true, limit: 1 } });
  try {
    const kept = await s.signIn({ sub: 'user_k' }, { next: '/start?setup=skip' });
    assert.deepEqual([kept.res.status, kept.res.headers.location], [302, '/start?setup=skip']);
    const elsewhere = await s.signIn({ sub: 'user_k' }, { next: '/w/Net/' });
    assert.equal(elsewhere.res.headers.location, '/start', 'a start sign-in only returns to the start page');
    const start = await s.apex('GET', '/api/auth/oidc/start?start=1');
    const back = new URL(start.headers.location);
    const q = back.searchParams;
    const denied = await s.follow(`${q.get('redirect_uri')}?state=${q.get('state')}&error=access_denied`, { cookie: cookieOf(start, 'wv_oidc') });
    assert.deepEqual([denied.status, denied.headers.location], [302, '/start?error=signin_failed']);
    s.idp.tamper('signature');
    const forged = await s.signIn({ sub: 'user_k' });
    assert.deepEqual([forged.res.status, forged.res.headers.location], [302, '/start?error=signin_unverified']);
  } finally { s.stop(); }
});

const clerkAt = (routes) => async (url, init = {}) => {
  const hit = routes[`${init.method ?? 'GET'} ${String(url).slice(CLERK_API.length).split('?')[0]}`];
  const [status, body] = hit ?? [404, { errors: [{ code: 'resource_not_found' }] }];
  return new Response(JSON.stringify(body), { status });
};
const rpc = (method, params = {}) => ({ jsonrpc: '2.0', id: 1, method, params });

test('billing on: a workspace made at /start opens on a trial, the AI app works, and /api/start names the trial and the wait', async () => {
  const billing = createBilling({ secretKey: 'clerk-test', soloPlan: 'solo', teamPlan: 'team', fetch: clerkAt({}) });
  const s = await serve({ openSignup: { on: true, limit: 1 }, billing });
  try {
    const { cookie } = await s.signIn({ sub: 'user_ada', email: 'ada@example.com', email_verified: true });
    const before = (await s.apex('GET', '/api/start', { cookie })).json();
    assert.deepEqual([before.canCreate, before.waiting], [true, null]);
    const made = await s.apex('POST', '/api/start/workspaces', { cookie, body: { name: 'Ada Sales', slug: 'ada-sales', template: 'crm' } });
    assert.equal(made.status, 201, made.text);
    const after = (await s.apex('GET', '/api/start', { cookie })).json();
    assert.equal(after.waiting, 'ada-sales', 'the person learns about the one-trial limit before naming a second workspace');
    assert.equal(after.rows[0].trial.daysLeft, 14);
    assert.ok(Date.parse(after.rows[0].trial.endsAt) > Date.now());
    const handed = await s.apex('GET', `${after.rows[0].open}?to=billing`, { cookie });
    assert.equal((await s.follow(handed.headers.location)).headers.location, '/billing', 'the waiting notice opens the workspace on its billing page');

    const host = s.at('ada-sales.weave.test');
    const token = s.idp.mint({ sub: 'user_ada' });
    assert.equal((await host('POST', '/mcp', { token, ua: 'Claude-User', body: rpc('initialize') })).status, 200);
    const wrote = await host('POST', '/mcp', { token, body: rpc('tools/call', { name: 'weave_create_entity', arguments: { db: made.json().table, name: 'Acme Corp' } }) });
    assert.equal(wrote.status, 200, wrote.text);
    assert.notEqual(wrote.json().result.isError, true, wrote.text);
    assert.equal((await s.apex('GET', '/api/start/workspaces/ada-sales/agent', { cookie })).json().connected, true);

    const second = await s.apex('POST', '/api/start/workspaces', { cookie, body: { name: 'Second', slug: 'ada-two' } });
    assert.deepEqual([second.status, second.json().code, second.json().waiting, second.json().billing], [402, 'plan-required', 'ada-sales', 'http://ada-sales.weave.test/billing']);
  } finally { s.stop(); }
});

test('agent step: a call weave refused never counts as a connected AI app (Issue #915)', async () => {
  const routes = { 'GET /users/user_bo/billing/subscription': [500, {}] };
  const billing = createBilling({ secretKey: 'clerk-test', soloPlan: 'solo', teamPlan: 'team', trialDays: 0, fetch: clerkAt(routes) });
  const s = await serve({ openSignup: { on: true, limit: 1 }, billing });
  try {
    const { cookie } = await s.signIn({ sub: 'user_bo', email: 'bo@example.com', email_verified: true });
    assert.equal((await s.apex('POST', '/api/start/workspaces', { cookie, body: { name: 'Bo', slug: 'bo' } })).status, 201);
    const host = s.at('bo.weave.test');
    const token = s.idp.mint({ sub: 'user_bo' });
    const seen = async () => (await s.apex('GET', '/api/start/workspaces/bo/agent', { cookie })).json().connected;
    assert.equal((await host('POST', '/mcp', { token, body: rpc('initialize') })).status, 503);
    assert.equal(await seen(), false, 'a 503 is not a connection');
    delete routes['GET /users/user_bo/billing/subscription'];
    billing.forget();
    const read = await host('POST', '/mcp', { token, body: rpc('tools/list') });
    assert.equal(read.status, 200, 'after the trial an unseated Architect\'s agent still reads (Issue #916)');
    assert.equal(await seen(), true);
  } finally { s.stop(); }
});
