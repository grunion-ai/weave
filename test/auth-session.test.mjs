/* Door B, end to end without a browser (Feature #222 part 2, Feature #208,
   Feature #141 §3): the engine's invite → credential → session model, and
   the routes that drive it — invite, register, a session cookie that opens
   the wall, sign out, the wall closed again; expiry, revocation, the rate
   limits, and the two ways a caller's standing is read (Bearer wins). The
   authenticator is test/lib/authenticator.mjs, a key pair in software. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer, originFromEnv, trustProxyFromEnv } from '../src/server.js';
import { b64url } from '../src/webauthn.js';
import { keyPair, registration, assertion } from './lib/authenticator.mjs';

/* ---------------------------------------------------------------- engine */
test('engine: an invite is one-time and short-lived, and stores only its hash', () => {
  const w = new Weave();
  const { account } = w.createAccount({ name: 'kyle', role: 'admin' });
  const inv = w.createInvite('kyle', { ttlMs: 60_000 });
  assert.equal(inv.account.id, account.id);
  assert.ok(!JSON.stringify(w.state.meta.invites).includes(inv.token), 'the raw invite token is not at rest');
  assert.equal(w.readInvite(inv.token).name, 'kyle', 'reading does not consume');
  assert.equal(w.consumeInvite(inv.token).name, 'kyle');
  assert.equal(w.readInvite(inv.token), null, 'consumed');
  assert.throws(() => w.consumeInvite(inv.token), /not valid or has expired/);
  const dead = w.createInvite('kyle', { ttlMs: 1000 });
  w.state.meta.invites[Object.keys(w.state.meta.invites)[0]].expiresAt = new Date(Date.now() - 1).toISOString();
  assert.equal(w.readInvite(dead.token), null, 'expired');
  assert.throws(() => w.createInvite('nobody'), /not found/);
  assert.deepEqual(w.listAudit({ limit: 5 }).map((e) => e.action).filter((a) => a.startsWith('invite')), ['invite-created', 'invite-consumed', 'invite-created']);
});

test('engine: credentials live on the account row; the list keeps the public key out and the hash never in', () => {
  const w = new Weave();
  w.createAccount({ name: 'kyle', role: 'admin' });
  const cred = w.addCredential('kyle', { id: 'cred-1', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' }, alg: -7, transports: ['internal'], label: 'iPhone' });
  assert.equal(cred.counter, 0);
  assert.throws(() => w.addCredential('kyle', { id: 'cred-1', publicKeyJwk: {}, alg: -7 }), /already registered/);
  assert.throws(() => w.addCredential('kyle', { id: 'cred-2', publicKeyJwk: {}, alg: -8 }), /supported alg/);
  const listed = w.listAccounts()[0];
  assert.ok(!('tokenHash' in listed));
  assert.deepEqual(listed.credentials.map((c) => [c.id, c.label, 'publicKeyJwk' in c]), [['cred-1', 'iPhone', false]]);
  assert.equal(w.credentialById('cred-1').account.name, 'kyle');
  assert.equal(w.credentialById('nope'), null);
  w.useCredential('cred-1', { counter: 9 });
  assert.equal(w.credentialById('cred-1').credential.counter, 9);
  assert.ok(w.credentialById('cred-1').credential.lastUsedAt);
  assert.deepEqual(w.removeCredential('kyle', 'cred-1'), { id: 'cred-1', removed: true, remaining: 0 });
  assert.throws(() => w.removeCredential('kyle', 'cred-1'), /not found/);
  const actions = w.listAudit({ limit: 10 }).map((e) => e.action);
  assert.ok(actions.includes('credential-added') && actions.includes('credential-removed'));
});

test('engine: a session is a hash at rest with a sliding 30-day expiry; revoke by id, all, or all-but-this', () => {
  const w = new Weave();
  w.createAccount({ name: 'kyle', role: 'admin' });
  const s1 = w.createSession('kyle', { ua: 'Safari on iPhone' });
  const s2 = w.createSession('kyle', { ua: 'Chrome on Mac' });
  assert.ok(!JSON.stringify(w.state.meta.sessions).includes(s1.token), 'the raw session token is not at rest');
  const me = w.verifySession(s1.token);
  assert.equal(me.name, 'kyle');
  assert.equal(me.role, 'admin');
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

test('engine: sessions and invites never leave through an export; credentials (public keys) do', () => {
  const w = new Weave();
  w.createAccount({ name: 'kyle', role: 'admin' });
  w.addCredential('kyle', { id: 'c1', publicKeyJwk: { kty: 'EC' }, alg: -7 });
  w.createSession('kyle');
  w.createInvite('kyle');
  const dump = w.exportJSON();
  assert.equal(dump.meta.sessions, undefined);
  assert.equal(dump.meta.invites, undefined);
  assert.equal(Object.values(dump.meta.accounts)[0].credentials[0].id, 'c1');
  const far = new Weave();
  far.importJSON(dump);
  assert.equal(far.credentialById('c1').account.name, 'kyle');
});

/* ---------------------------------------------------------------- routes */
/* limits: the suites drive dozens of ceremonies from one IP; the rate-limit
   case passes the real numbers back in. */
async function serve({ requireAuth = true, origin, limits = { options: 1000, failed: 1000 } } = {}) {
  const w = new Weave();
  w.createSpace({ name: 'Dev' });
  const db = w.createTable({ space: 'Dev', name: 'Task' });
  const task = w.createEntity(db.id, { Name: 'One' });
  const admin = w.createAccount({ name: 'root', role: 'admin' }).token;
  w.createAccount({ name: 'kyle', role: 'admin' });
  w.createAccount({ name: 'eye', role: 'reader' });
  if (requireAuth) w.setRequireAuth(true);
  const { server } = await startServer(w, { port: 0, origin: origin ?? null, limits });
  const port = server.address().port;
  // localhost, not 127.0.0.1: the RP ID a passkey can carry.
  const base = `http://localhost:${port}`;
  const call = (method, path, { token, body, cookie, headers = {} } = {}) => fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: ['POST', 'PUT', 'PATCH'].includes(method) ? JSON.stringify(body ?? {}) : undefined,
    redirect: 'manual',
  });
  const cookieOf = (res) => (res.headers.get('set-cookie') ?? '').split(';')[0];
  return { w, task, admin, base, call, cookieOf, stop: () => server.close() };
}

/* Drives the two ceremonies against a running server with the software
   authenticator. Returns the cookie and the key for later assertions. */
async function register(s, { invite, cookie, key = keyPair(), label = 'Test device', origin = s.base } = {}) {
  const opts = await s.call('POST', '/api/auth/register/options', { body: { invite, label }, cookie });
  if (!opts.ok) return { res: opts };
  const { id, options } = await opts.json();
  const reg = registration({ key, challenge: options.challenge, origin, rpId: new URL(origin).hostname });
  const res = await s.call('POST', '/api/auth/register/verify', { body: { id, response: reg.response, label }, cookie });
  return { res, key, credId: reg.credId, options, cookie: s.cookieOf(res) };
}
async function login(s, { key, credId, counter = 1, origin = s.base, tamper } = {}) {
  const opts = await s.call('POST', '/api/auth/login/options', { body: {} });
  if (!opts.ok) return { res: opts };
  const { id, options } = await opts.json();
  const res = await s.call('POST', '/api/auth/login/verify', { body: { id, response: assertion({ key, credId, challenge: options.challenge, origin, rpId: new URL(origin).hostname, counter, tamper }) } });
  return { res, options, cookie: s.cookieOf(res) };
}

test('routes: invite → register → session cookie opens the wall → logout → the wall is back', async () => {
  const s = await serve();
  try {
    // The wall, with the sign-in page as its door.
    const walled = await s.call('GET', `/e/${s.task.id}/doc.html`);
    assert.equal(walled.status, 401);
    assert.match(await walled.text(), /href="\/auth\?next=/);
    assert.equal((await s.call('GET', '/auth')).status, 200, 'the sign-in page is open');
    assert.match(await (await s.call('GET', '/auth?invite=x')).text(), /Register this device/);
    // No invite, no session: registration is refused.
    assert.equal((await register(s, {})).res.status, 401);
    const { token } = s.w.createInvite('kyle');
    const opts = await s.call('POST', '/api/auth/register/options', { body: { invite: token } });
    assert.equal(opts.status, 200);
    const { options } = await opts.json();
    assert.equal(options.rp.id, 'localhost');
    assert.equal(options.user.name, 'kyle');
    assert.equal(options.authenticatorSelection.residentKey, 'required');
    assert.equal(options.attestation, 'none');
    assert.deepEqual(options.pubKeyCredParams.map((p) => p.alg), [-7, -257]);
    const reg = await register(s, { invite: token, label: 'Phone' });
    const regBody = await reg.res.json();
    assert.equal(reg.res.status, 200, JSON.stringify(regBody));
    const setCookie = reg.res.headers.get('set-cookie');
    assert.match(setCookie, /^wv_session=[A-Za-z0-9_-]+; HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000$/, 'no Secure on http');
    assert.equal(regBody.account.name, 'kyle');
    assert.equal(s.w.readInvite(token), null, 'the invite is spent');
    assert.equal(s.w.listAccounts().find((a) => a.name === 'kyle').credentials[0].label, 'Phone');
    // The cookie is a way through the wall, on pages and on the API.
    assert.equal((await s.call('GET', `/e/${s.task.id}/doc.html`, { cookie: reg.cookie })).status, 200);
    assert.equal((await s.call('GET', '/api/schema', { cookie: reg.cookie })).status, 200);
    const me = await (await s.call('GET', '/api/auth/me', { cookie: reg.cookie })).json();
    assert.equal(me.account.name, 'kyle');
    assert.equal(me.role, 'admin');
    assert.equal(me.sessions.length, 1);
    assert.equal(me.sessions[0].current, true);
    assert.equal(me.credentials.length, 1);
    assert.ok(!('publicKeyJwk' in me.credentials[0]));
    // A write lands under the account's name.
    const row = await (await s.call('POST', '/api/tables/Task/entities', { cookie: reg.cookie, body: { name: 'By cookie' } })).json();
    assert.equal(s.w.getEntity(row.id).createdBy, 'kyle');
    // Sign out: the cookie is cleared and the wall is back.
    const bye = await s.call('POST', '/api/auth/logout', { cookie: reg.cookie });
    assert.match(bye.headers.get('set-cookie'), /^wv_session=; .*Max-Age=0/);
    const after = await s.call('GET', `/e/${s.task.id}/doc.html`, { cookie: reg.cookie });
    assert.equal(after.status, 302, 'a dead cookie on a page redirects to the sign-in page');
    assert.match(after.headers.get('location'), /^\/auth\?next=%2Fe%2F/);
    assert.equal((await s.call('GET', '/api/schema', { cookie: reg.cookie })).status, 401, 'a dead cookie on the API is a JSON 401');
    // Sign in again with the passkey: discoverable, no username.
    const back = await login(s, { key: reg.key, credId: reg.credId, counter: 1 });
    assert.equal(back.res.status, 200);
    assert.equal((await s.call('GET', '/api/schema', { cookie: back.cookie })).status, 200);
    assert.equal(s.w.listAccounts().find((a) => a.name === 'kyle').credentials[0].counter, 1);
  } finally { s.stop(); }
});

test('routes: an assertion is refused for a wrong origin, a replayed counter, a tampered signature, a spent challenge, an unknown credential', async () => {
  const s = await serve();
  try {
    const reg = await register(s, { invite: s.w.createInvite('kyle').token });
    assert.equal(reg.res.status, 200);
    const args = { key: reg.key, credId: reg.credId };
    assert.equal((await login(s, { ...args, counter: 1, origin: 'http://evil.localhost:1' })).res.status, 400);
    assert.equal((await login(s, { ...args, counter: 1, tamper: 'signature' })).res.status, 403);
    assert.equal((await login(s, { ...args, counter: 2 })).res.status, 200);
    assert.equal((await login(s, { ...args, counter: 2 })).res.status, 403, 'counter did not advance');
    assert.equal((await login(s, { ...args, counter: 1 })).res.status, 403, 'counter went backwards');
    assert.equal((await login(s, { key: keyPair(), credId: Buffer.from('unknown-cred') })).res.status, 401);
    // A challenge is one-shot: replaying a verified body is refused.
    const opts = await (await s.call('POST', '/api/auth/login/options')).json();
    const body = { id: opts.id, response: assertion({ ...args, challenge: opts.options.challenge, origin: s.base, rpId: 'localhost', counter: 3 }) };
    assert.equal((await s.call('POST', '/api/auth/login/verify', { body })).status, 200);
    assert.equal((await s.call('POST', '/api/auth/login/verify', { body })).status, 400, 'the challenge is spent');
    // Registration too: a second passkey with the same id is refused, and a wrong origin at registration.
    const dup = await register(s, { cookie: reg.cookie, key: reg.key });
    assert.equal(dup.res.status, 200, 'a signed-in account adds a second device');
    const wrong = await register(s, { cookie: reg.cookie, origin: 'https://weave.example.com' });
    assert.equal(wrong.res.status, 400);
    assert.match((await wrong.res.json()).error, /Origin mismatch/);
  } finally { s.stop(); }
});

test('routes: Bearer wins when both are present; a reader session is read-only; the You verbs revoke sessions and remove credentials', async () => {
  const s = await serve();
  try {
    const kyle = await register(s, { invite: s.w.createInvite('kyle').token });
    // Bearer names root even with kyle's cookie along.
    const me = await (await s.call('GET', '/api/auth/me', { cookie: kyle.cookie, token: s.admin })).json();
    assert.equal(me.account.name, 'root');
    // A reader's session: pages yes, writes no, sign-out yes.
    const eye = await register(s, { invite: s.w.createInvite('eye').token });
    assert.equal((await s.call('GET', `/e/${s.task.id}/doc.md`, { cookie: eye.cookie })).status, 200);
    assert.equal((await s.call('POST', '/api/tables/Task/entities', { cookie: eye.cookie, body: { name: 'x' } })).status, 403);
    assert.equal((await s.call('POST', '/api/auth/logout', { cookie: eye.cookie })).status, 200);
    // Sessions: a second sign-in, then "others" ends it and this one stays.
    const again = await login(s, { key: kyle.key, credId: kyle.credId, counter: 1 });
    assert.equal((await (await s.call('GET', '/api/auth/me', { cookie: kyle.cookie })).json()).sessions.length, 2);
    assert.deepEqual(await (await s.call('DELETE', '/api/auth/sessions/others', { cookie: kyle.cookie })).json(), { revoked: 1 });
    assert.equal((await s.call('GET', '/api/schema', { cookie: again.cookie })).status, 401);
    assert.equal((await s.call('GET', '/api/schema', { cookie: kyle.cookie })).status, 200);
    // One by id.
    const third = await login(s, { key: kyle.key, credId: kyle.credId, counter: 2 });
    const other = (await (await s.call('GET', '/api/auth/me', { cookie: kyle.cookie })).json()).sessions.find((x) => !x.current);
    assert.deepEqual(await (await s.call('DELETE', `/api/auth/sessions/${other.id}`, { cookie: kyle.cookie })).json(), { revoked: 1 });
    assert.equal((await s.call('GET', '/api/schema', { cookie: third.cookie })).status, 401);
    // Credentials: removed, the passkey no longer signs in.
    const credId = b64url.encode(kyle.credId);
    assert.equal((await s.call('DELETE', `/api/auth/credentials/${encodeURIComponent(credId)}`, { cookie: kyle.cookie })).status, 200);
    assert.equal((await login(s, { key: kyle.key, credId: kyle.credId, counter: 3 })).res.status, 401);
    // Anonymous: the self-service verbs are 401, not 404.
    assert.equal((await s.call('GET', '/api/auth/me')).status, 401);
    assert.equal((await s.call('DELETE', '/api/auth/sessions/others')).status, 401);
  } finally { s.stop(); }
});

test('routes: with requireAuth off the page is open, a session still names the actor, and the cookie is Secure under an https origin', async () => {
  const s = await serve({ requireAuth: false, origin: 'https://weave.example.com' });
  try {
    assert.equal((await s.call('GET', '/')).status, 200);
    const opts = await (await s.call('POST', '/api/auth/register/options', { body: { invite: s.w.createInvite('kyle').token } })).json();
    assert.equal(opts.options.rp.id, 'weave.example.com', 'RP ID is the origin\'s hostname');
    const reg = await register(s, { invite: s.w.createInvite('kyle').token, origin: 'https://weave.example.com' });
    assert.equal(reg.res.status, 200);
    assert.match(reg.res.headers.get('set-cookie'), /; Secure$/);
    const row = await (await s.call('POST', '/api/tables/Task/entities', { cookie: reg.cookie, body: { name: 'named' } })).json();
    assert.equal(s.w.getEntity(row.id).createdBy, 'kyle');
  } finally { s.stop(); }
});

test('routes: rate limits — 10 options a minute per IP, 5 failed verifies; X-Forwarded-For only counts behind a trusted proxy', async () => {
  const s = await serve({ limits: null });
  try {
    let last;
    for (let i = 0; i < 10; i++) last = await s.call('POST', '/api/auth/login/options');
    assert.equal(last.status, 200);
    const eleventh = await s.call('POST', '/api/auth/login/options');
    assert.equal(eleventh.status, 429);
    assert.equal((await eleventh.json()).code, 'rate-limited');
    // Not trusting the proxy: a forged X-Forwarded-For does not buy a fresh bucket.
    assert.equal((await s.call('POST', '/api/auth/login/options', { headers: { 'X-Forwarded-For': '203.0.113.9' } })).status, 429);
    // Failed verifies: five bad ids, then the sixth is refused before it is read.
    for (let i = 0; i < 5; i++) assert.equal((await s.call('POST', '/api/auth/login/verify', { body: { id: 'nope' } })).status, 400);
    assert.equal((await s.call('POST', '/api/auth/login/verify', { body: { id: 'nope' } })).status, 429);
  } finally { s.stop(); }
  const proxied = await serve({ limits: null });
  try {
    proxied.stop();
    const { server } = await startServer(proxied.w, { port: 0, trustProxy: true });
    const base = `http://localhost:${server.address().port}`;
    try {
      for (let i = 0; i < 10; i++) await fetch(base + '/api/auth/login/options', { method: 'POST', headers: { 'X-Forwarded-For': '203.0.113.1' } });
      assert.equal((await fetch(base + '/api/auth/login/options', { method: 'POST', headers: { 'X-Forwarded-For': '203.0.113.1' } })).status, 429);
      assert.equal((await fetch(base + '/api/auth/login/options', { method: 'POST', headers: { 'X-Forwarded-For': '203.0.113.2' } })).status, 200, 'another client behind the proxy has its own bucket');
    } finally { server.close(); }
  } finally { /* closed above */ }
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
