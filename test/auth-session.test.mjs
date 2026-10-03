/* The browser session, end to end without a browser (Feature #222 part 2,
   Feature #208, Feature #141 §3). Door B introduced it for passkeys; since
   Feature #243 removed the passkey door, the session is minted by the
   provider door (Feature #212) and this file drives it through the provider
   in software, test/lib/idp.mjs. What stays pinned: a session cookie that
   opens the wall, sign out, the wall closed again; sliding expiry,
   revocation by id, all, or all-but-this; the rate limits; and the two ways
   a caller's standing is read (Bearer wins). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer, originFromEnv, trustProxyFromEnv } from '../src/server.js';
import { createOidc } from '../src/oidc.js';
import { startIdp } from './lib/idp.mjs';

/* ---------------------------------------------------------------- engine */
test('engine: a session is a hash at rest with a sliding 30-day expiry; revoke by id, all, or all-but-this', () => {
  const w = new Weave();
  w.createAccount({ name: 'kyle', role: 'admin' });
  const s1 = w.createSession('kyle', { ua: 'Safari on iPhone' });
  const s2 = w.createSession('kyle', { ua: 'Chrome on Mac' });
  assert.ok(!JSON.stringify(w.state.meta.sessions).includes(s1.token), 'the raw session token is not at rest');
  const me = w.verifySession(s1.token);
  assert.equal(me.name, 'kyle');
  assert.equal(me.role, 'architect');
  assert.ok(!('tokenHash' in me));
  assert.equal(w.verifySession('nope'), null);
  // Sliding: an old lastSeenAt is refreshed on use, and expiresAt moves with it.
  const h1 = me.sessionId;
  const row = w.state.meta.sessions[h1];
  row.lastSeenAt = new Date(Date.now() - 10 * 60_000).toISOString();
  row.expiresAt = new Date(Date.now() + 60_000).toISOString();
  w.verifySession(s1.token);
  assert.ok(Date.parse(row.expiresAt) > Date.now() + 29 * 24 * 3600_000, 'expiry slid 30 days out');
  // Expired: gone on the next verify.
  row.expiresAt = new Date(Date.now() - 1).toISOString();
  assert.equal(w.verifySession(s1.token), null);
  assert.ok(!(h1 in w.state.meta.sessions));
  assert.equal(w.listSessions('kyle').length, 1);
  assert.equal(w.listSessions('kyle')[0].ua, 'Chrome on Mac');
  const s3 = w.createSession('kyle');
  const h3 = w.verifySession(s3.token).sessionId;
  assert.deepEqual(w.revokeSession('kyle', { all: true, except: h3 }), { revoked: 1 });
  assert.equal(w.verifySession(s2.token), null);
  assert.equal(w.verifySession(s3.token).name, 'kyle');
  assert.deepEqual(w.revokeSession('kyle', { id: h3.slice(0, 12) }), { revoked: 1 }, 'a prefix of the id is enough');
  assert.throws(() => w.revokeSession('kyle', { id: 'zzz' }), /not found/);
  assert.deepEqual(w.revokeSession('kyle', { all: true }), { revoked: 0 });
  const actions = w.listAudit({ limit: 20 }).map((e) => e.action);
  assert.equal(actions.filter((a) => a === 'session-created').length, 3);
  assert.equal(actions.filter((a) => a === 'session-revoked').length, 2);
});

test('engine: sessions never leave through an export', () => {
  const w = new Weave();
  w.createAccount({ name: 'kyle', role: 'admin' });
  w.createSession('kyle');
  const dump = w.exportJSON();
  assert.equal(dump.meta.sessions, undefined);
  const far = new Weave();
  far.importJSON(dump);
  assert.equal(far.listAccounts()[0].name, 'kyle');
  assert.equal(far.state.meta.sessions, undefined);
});

/* ---------------------------------------------------------------- routes */
const KYLE = { sub: 'user_kyle', email: 'kyle@example.com', email_verified: true };
const EYE = { sub: 'user_eye', email: 'eye@example.com', email_verified: true };

/* limits: the suites drive dozens of sign-ins from one IP; the rate-limit
   case passes the real numbers back in. */
async function serve({ requireAuth = true, origin, limits = { options: 1000, failed: 1000 }, trustProxy } = {}) {
  const idp = await startIdp();
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  const db = w.createTable({ space: 'Dev', name: 'Task' });
  const task = w.createEntity(db.id, { Name: 'One' });
  const admin = w.createAccount({ name: 'root', role: 'admin' }).token;
  w.createAccount({ name: 'kyle', role: 'admin' });
  w.createAccount({ name: 'eye', role: 'reader' });
  for (const [name, who] of [['kyle', KYLE], ['eye', EYE]]) w.redeemIdentityInvite(w.linkIdentity(name, { issuer: idp.issuer }).code, { issuer: idp.issuer, subject: who.sub });
  if (requireAuth) w.setRequireAuth(true);
  const oidc = createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' });
  const { server } = await startServer(w, { port: 0, origin: origin ?? null, limits, oidc, ...(trustProxy ? { trustProxy } : {}) });
  const port = server.address().port;
  // localhost, not 127.0.0.1: the loopback origin the callback comes back to.
  const base = `http://localhost:${port}`;
  const call = (method, path, { token, body, cookie, headers = {} } = {}) => fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: ['POST', 'PUT', 'PATCH'].includes(method) ? JSON.stringify(body ?? {}) : undefined,
    redirect: 'manual',
  });
  const cookieOf = (res) => (res.headers.get('set-cookie') ?? '').split(';')[0];
  /* One trip through the provider; returns the callback's answer and the
     session cookie it set. */
  const signIn = async (claims) => {
    const start = await call('GET', '/api/auth/oidc/start');
    const back = idp.approve(start.headers.get('location'), claims);
    const res = await call('GET', back.pathname + back.search, { cookie: cookieOf(start) });
    return { res, cookie: cookieOf(res) };
  };
  return { w, task, admin, base, call, cookieOf, signIn, stop: () => { server.close(); idp.stop(); } };
}

test('routes: a provider sign-in sets a session cookie that opens the wall; logout closes it again', async () => {
  const s = await serve();
  try {
    // The wall sends a signed-out browser to the sign-in door (Issue #569).
    const walled = await s.call('GET', `/e/${s.task.id}/doc.html`);
    assert.equal(walled.status, 302);
    assert.equal(walled.headers.get('location'), `/auth?next=${encodeURIComponent(`/e/${s.task.id}/doc.html`)}`);
    const door = await s.call('GET', '/auth');
    assert.equal(door.status, 302, 'the sign-in door is open and goes straight to the provider');
    assert.equal(door.headers.get('location'), '/api/auth/oidc/start');
    const kyle = await s.signIn(KYLE);
    assert.equal(kyle.res.status, 302);
    assert.match(kyle.res.headers.get('set-cookie'), /^wv_session=[A-Za-z0-9_-]+; HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000$/, 'no Secure on http');
    // The cookie is a way through the wall, on pages and on the API.
    assert.equal((await s.call('GET', `/e/${s.task.id}/doc.html`, { cookie: kyle.cookie })).status, 200);
    assert.equal((await s.call('GET', '/api/schema', { cookie: kyle.cookie })).status, 200);
    const me = await (await s.call('GET', '/api/auth/me', { cookie: kyle.cookie })).json();
    assert.equal(me.account.name, 'kyle');
    assert.equal(me.role, 'architect');
    assert.equal(me.sessions.length, 1);
    assert.equal(me.sessions[0].current, true);
    // A write lands under the account's name.
    const row = await (await s.call('POST', '/api/tables/Task/entities', { cookie: kyle.cookie, body: { name: 'By cookie' } })).json();
    assert.equal(s.w.getEntity(row.id).createdBy, 'kyle');
    // Sign out: the cookie is cleared and the wall is back.
    const bye = await s.call('POST', '/api/auth/logout', { cookie: kyle.cookie });
    assert.match(bye.headers.get('set-cookie'), /^wv_session=; .*Max-Age=0/);
    const after = await s.call('GET', `/e/${s.task.id}/doc.html`, { cookie: kyle.cookie });
    assert.equal(after.status, 302, 'a dead cookie on a page redirects to the sign-in page');
    assert.match(after.headers.get('location'), /^\/auth\?next=%2Fe%2F/);
    assert.equal((await s.call('GET', '/api/schema', { cookie: kyle.cookie })).status, 401, 'a dead cookie on the API is a JSON 401');
    // Sign in again through the provider.
    const back = await s.signIn(KYLE);
    assert.equal((await s.call('GET', '/api/schema', { cookie: back.cookie })).status, 200);
  } finally { s.stop(); }
});

test('routes: Bearer wins when both are present; a reader session is read-only; the You verbs list and revoke sessions', async () => {
  const s = await serve();
  try {
    const kyle = await s.signIn(KYLE);
    // Bearer names root even with kyle's cookie along.
    const me = await (await s.call('GET', '/api/auth/me', { cookie: kyle.cookie, token: s.admin })).json();
    assert.equal(me.account.name, 'root');
    // A reader's session: pages yes, writes no, sign-out yes.
    const eye = await s.signIn(EYE);
    assert.equal((await s.call('GET', `/e/${s.task.id}/doc.md`, { cookie: eye.cookie })).status, 200);
    assert.equal((await s.call('POST', '/api/tables/Task/entities', { cookie: eye.cookie, body: { name: 'x' } })).status, 403);
    assert.equal((await s.call('POST', '/api/auth/logout', { cookie: eye.cookie })).status, 200);
    // Sessions: a second sign-in, then "others" ends it and this one stays.
    const again = await s.signIn(KYLE);
    assert.equal((await (await s.call('GET', '/api/auth/me', { cookie: kyle.cookie })).json()).sessions.length, 2);
    assert.deepEqual(await (await s.call('DELETE', '/api/auth/sessions/others', { cookie: kyle.cookie })).json(), { revoked: 1 });
    assert.equal((await s.call('GET', '/api/schema', { cookie: again.cookie })).status, 401);
    assert.equal((await s.call('GET', '/api/schema', { cookie: kyle.cookie })).status, 200);
    // One by id.
    const third = await s.signIn(KYLE);
    const other = (await (await s.call('GET', '/api/auth/me', { cookie: kyle.cookie })).json()).sessions.find((x) => !x.current);
    assert.deepEqual(await (await s.call('DELETE', `/api/auth/sessions/${other.id}`, { cookie: kyle.cookie })).json(), { revoked: 1 });
    assert.equal((await s.call('GET', '/api/schema', { cookie: third.cookie })).status, 401);
    // The operator's verbs reach the same sessions: list, then revoke all.
    assert.equal(s.w.listSessions('kyle').length, 1);
    assert.deepEqual(s.w.revokeSession('kyle', { all: true }), { revoked: 1 });
    assert.equal((await s.call('GET', '/api/schema', { cookie: kyle.cookie })).status, 401);
    // Anonymous: the self-service verbs are 401, not 404.
    assert.equal((await s.call('GET', '/api/auth/me')).status, 401);
    assert.equal((await s.call('DELETE', '/api/auth/sessions/others')).status, 401);
  } finally { s.stop(); }
});

test('routes: with requireAuth off the page is open, a session still names the actor, and the cookie is Secure under an https origin', async () => {
  const s = await serve({ requireAuth: false, origin: 'https://weave.example.com' });
  try {
    assert.equal((await s.call('GET', '/')).status, 200);
    const kyle = await s.signIn(KYLE);
    assert.equal(kyle.res.status, 302);
    assert.match(kyle.res.headers.get('set-cookie'), /; Secure$/);
    const row = await (await s.call('POST', '/api/tables/Task/entities', { cookie: kyle.cookie, body: { name: 'named' } })).json();
    assert.equal(s.w.getEntity(row.id).createdBy, 'kyle');
  } finally { s.stop(); }
});

test('routes: rate limits — 10 sign-in starts a minute per IP, 5 failed callbacks; X-Forwarded-For only counts behind a trusted proxy', async () => {
  const s = await serve({ limits: null });
  try {
    let last;
    for (let i = 0; i < 10; i++) last = await s.call('GET', '/api/auth/oidc/start');
    assert.equal(last.status, 302);
    const eleventh = await s.call('GET', '/api/auth/oidc/start');
    assert.equal(eleventh.status, 429);
    assert.equal((await eleventh.json()).code, 'rate-limited');
    // Not trusting the proxy: a forged X-Forwarded-For does not buy a fresh bucket.
    assert.equal((await s.call('GET', '/api/auth/oidc/start', { headers: { 'X-Forwarded-For': '203.0.113.9' } })).status, 429);
    // Failed callbacks: five made-up states, then the sixth is refused before it is read.
    for (let i = 0; i < 5; i++) assert.equal((await s.call('GET', '/api/auth/oidc/callback?code=x&state=nope')).status, 400);
    assert.equal((await s.call('GET', '/api/auth/oidc/callback?code=x&state=nope')).status, 429);
  } finally { s.stop(); }
  const proxied = await serve({ limits: null, trustProxy: true });
  try {
    for (let i = 0; i < 10; i++) await proxied.call('GET', '/api/auth/oidc/start', { headers: { 'X-Forwarded-For': '203.0.113.1' } });
    assert.equal((await proxied.call('GET', '/api/auth/oidc/start', { headers: { 'X-Forwarded-For': '203.0.113.1' } })).status, 429);
    assert.equal((await proxied.call('GET', '/api/auth/oidc/start', { headers: { 'X-Forwarded-For': '203.0.113.2' } })).status, 302, 'another client behind the proxy has its own bucket');
  } finally { proxied.stop(); }
});

test('WEAVE_ORIGIN is read as a bare origin, and refused otherwise; WEAVE_TRUST_PROXY is a switch', () => {
  assert.equal(originFromEnv({}), null);
  assert.equal(originFromEnv({ WEAVE_ORIGIN: 'https://weave.example.com' }), 'https://weave.example.com');
  assert.equal(originFromEnv({ WEAVE_ORIGIN: 'https://weave.example.com/' }), 'https://weave.example.com');
  assert.throws(() => originFromEnv({ WEAVE_ORIGIN: 'weave.example.com' }), /absolute URL/);
  assert.throws(() => originFromEnv({ WEAVE_ORIGIN: 'https://weave.example.com/w/uno' }), /bare origin/);
  assert.equal(trustProxyFromEnv({}), false);
  assert.equal(trustProxyFromEnv({ WEAVE_TRUST_PROXY: '1' }), true);
});
