import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startIdp, serveOidc, cookieOf } from './lib/idp.mjs';

const KYLE = { sub: 'user_kyle', email: 'kyle@example.com', email_verified: true };
const DAY = 24 * 3600_000;
const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));

function workspace(name, { issuer, kyle = true }) {
  const w = new Weave();
  w.state.meta.name = name;
  w.createSpace({ name: 'Dev' });
  w.createTable({ space: 'Dev', name: 'Task' });
  const ops = w.createAccount({ name: 'ops', role: 'architect' }).token;
  if (kyle) {
    w.createAccount({ name: 'kyle', role: 'editor' });
    w.redeemIdentityInvite(w.linkIdentity('kyle', { issuer }).code, { issuer, subject: KYLE.sub });
  }
  w.setRequireAuth(true);
  return { w, ops };
}

async function serve() {
  const idp = await startIdp();
  const home = workspace('home', { issuer: idp.issuer });
  const alpha = workspace('alpha', { issuer: idp.issuer });
  const beta = workspace('beta', { issuer: idp.issuer });
  const gamma = workspace('gamma', { issuer: idp.issuer, kyle: false });
  const s = await serveOidc(home.w, idp, { workspaces: { alpha: alpha.w, beta: beta.w, gamma: gamma.w } });
  return { ...s, idp, home, alpha, beta, gamma };
}

function browser(s) {
  const jar = new Map();
  const take = (res) => {
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split('; ');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (!value || attrs.includes('Max-Age=0')) jar.delete(name);
      else jar.set(name, value);
    }
    return res;
  };
  const header = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  return {
    jar,
    call: async (method, path, opts = {}) => take(await s.call(method, path, { ...opts, cookie: header() || undefined })),
    signIn: async (ws) => {
      const start = await s.call('GET', `/w/${ws}/api/auth/oidc/start?next=${encodeURIComponent(`/w/${ws}/`)}`);
      const back = s.idp.approve(start.headers.get('location'), KYLE);
      return take(await s.call('GET', back.pathname + back.search, { cookie: [header(), cookieOf(start)].filter(Boolean).join('; ') }));
    },
  };
}

const nameOf = (w) => `wv_session_${w.state.meta.id}`;

test('engine: removing an account turns its sessions into removal marks, which open nothing and expire with the session (Feature #280)', () => {
  const w = new Weave();
  w.createAccount({ name: 'kyle', role: 'editor' });
  w.createAccount({ name: 'eye', role: 'observer' });
  const k1 = w.createSession('kyle').token;
  const k2 = w.createSession('kyle').token;
  const e1 = w.createSession('eye').token;
  assert.equal(w.removedSession(k1), null);
  w.deleteAccount('kyle');
  assert.equal(w.verifySession(k1), null);
  assert.equal(w.verifySession(k2), null);
  assert.ok(w.removedSession(k1)?.removedAt, 'the removal is remembered against the token');
  assert.equal(w.removedSession('nope'), null);
  assert.equal(w.verifySession(e1).name, 'eye', 'another account keeps its session');
  const marks = Object.values(w.state.meta.sessions).filter((x) => x.removedAt);
  assert.equal(marks.length, 2);
  assert.ok(marks.every((x) => !('accountId' in x) && !('ua' in x)), 'a mark keeps no account and no browser detail');
  assert.ok(w.listAudit({ limit: 10 }).some((e) => e.action === 'session-revoked'));
  for (const x of Object.values(w.state.meta.sessions)) if (x.removedAt) x.expiresAt = new Date(Date.now() - 1).toISOString();
  w.createSession('eye');
  assert.equal(w.removedSession(k1), null, 'a mark is swept once the session it stands for would have expired');
});

test('routes: each workspace holds its own session; signing out of one leaves the other answering 200 (Feature #280)', async () => {
  const s = await serve();
  try {
    const b = browser(s);
    assert.equal((await b.signIn('alpha')).status, 302);
    assert.equal((await b.signIn('beta')).status, 302);
    assert.deepEqual([...b.jar.keys()].filter((k) => k.startsWith('wv_session')).sort(), [nameOf(s.alpha.w), nameOf(s.beta.w)].sort(), 'one cookie per workspace, named by its id, and no plain wv_session');
    assert.equal((await b.call('GET', '/w/alpha/api/schema')).status, 200);
    assert.equal((await b.call('GET', '/w/beta/api/schema')).status, 200);
    const alphaOnly = `${nameOf(s.alpha.w)}=${b.jar.get(nameOf(s.alpha.w))}`;
    assert.equal((await s.call('GET', '/w/beta/api/schema', { cookie: alphaOnly })).status, 401, 'alpha\'s cookie does not open beta');

    const bye = await b.call('POST', '/w/alpha/api/auth/logout');
    assert.equal(bye.status, 200);
    const cleared = bye.headers.getSetCookie();
    assert.equal(cleared.length, 1, String(cleared));
    assert.match(cleared[0], new RegExp(`^${nameOf(s.alpha.w)}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0$`));
    assert.equal(s.alpha.w.listSessions('kyle').length, 0, 'alpha\'s session is revoked on the server');
    assert.equal(s.beta.w.listSessions('kyle').length, 1);
    assert.equal((await b.call('GET', '/w/alpha/api/schema')).status, 401);
    const page = await b.call('GET', '/w/alpha/');
    assert.equal(page.status, 302);
    assert.match(page.headers.get('location'), /^\/w\/alpha\/auth\?next=/);
    assert.equal((await b.call('GET', '/w/beta/api/schema')).status, 200, 'beta is still signed in');
    assert.equal((await b.call('GET', '/w/beta/')).status, 200);

    await b.signIn('alpha');
    const everywhere = await b.call('POST', '/w/beta/api/auth/logout?everywhere=1');
    assert.equal(everywhere.status, 200);
    assert.equal(b.jar.size, 0, 'sign out everywhere clears every session this browser holds');
    assert.equal(s.alpha.w.listSessions('kyle').length + s.beta.w.listSessions('kyle').length, 0);
  } finally { s.stop(); }
});

test('routes: idle expiry of one workspace\'s session leaves the other signed in, and a slide renews only that workspace\'s cookie (Feature #280)', async () => {
  const s = await serve();
  try {
    const b = browser(s);
    await b.signIn('alpha');
    await b.signIn('beta');
    const now = Date.now();
    Object.assign(Object.values(s.alpha.w.state.meta.sessions)[0], { lastSeenAt: new Date(now - 31 * DAY).toISOString(), expiresAt: new Date(now - DAY).toISOString() });
    const betaToken = b.jar.get(nameOf(s.beta.w));
    Object.assign(Object.values(s.beta.w.state.meta.sessions)[0], { lastSeenAt: new Date(now - 5 * 60_000).toISOString(), expiresAt: new Date(now + 20 * DAY).toISOString() });
    const idle = await b.call('GET', '/w/alpha/');
    assert.equal(idle.status, 302);
    assert.match(idle.headers.get('location'), /^\/w\/alpha\/auth\?next=/);
    assert.deepEqual(idle.headers.getSetCookie().map((c) => c.split('=')[0]), [nameOf(s.alpha.w)], 'only alpha\'s dead cookie is cleared');
    const used = await b.call('GET', '/w/beta/api/schema');
    assert.equal(used.status, 200);
    assert.deepEqual(used.headers.getSetCookie(), [`${nameOf(s.beta.w)}=${betaToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`]);
    assert.equal((await b.call('GET', '/w/alpha/api/schema')).status, 401);
  } finally { s.stop(); }
});

test('routes: an Architect removing an account revokes its sessions there at once, and the next request gets an access-removed page, never a sign-in redirect (Feature #280)', async () => {
  const s = await serve();
  try {
    const b = browser(s);
    await b.signIn('alpha');
    await b.signIn('beta');
    assert.equal((await s.call('DELETE', '/w/alpha/api/accounts/kyle', { token: s.alpha.ops })).status, 200);
    assert.ok(Object.values(s.alpha.w.state.meta.sessions).every((x) => !x.accountId), 'no live session is left for the removed account');
    for (let i = 0; i < 2; i++) {
      const page = await b.call('GET', '/w/alpha/');
      assert.equal(page.status, 403);
      assert.equal(page.headers.get('location'), null);
      assert.match(page.headers.get('content-type'), /text\/html/);
      assert.equal(page.headers.get('cache-control'), 'no-store');
      const html = await page.text();
      assert.match(html, /Your access to alpha was removed/);
      const links = hrefs(html);
      assert.ok(links.includes('/w/alpha/auth?signed-out=1'), String(links));
      assert.deepEqual(links.filter((h) => /(^|\/)auth$/.test(new URL(h, 'http://x').pathname) && !new URL(h, 'http://x').searchParams.has('signed-out')), [], 'nothing links into the automatic sign-in redirect');
    }
    const api = await b.call('GET', '/w/alpha/api/schema');
    assert.equal(api.status, 403);
    assert.equal((await api.json()).code, 'access-removed');
    assert.equal((await b.call('GET', '/w/beta/api/schema')).status, 200, 'removal in alpha leaves beta alone');
  } finally { s.stop(); }
});

test('routes: a plain wv_session cookie opens nothing and is cleared on the next response (Issue #717)', async () => {
  const s = await serve();
  try {
    const b = browser(s);
    const token = s.alpha.w.createSession('kyle').token;
    b.jar.set('wv_session', token);
    const first = await b.call('GET', '/w/alpha/api/schema');
    assert.equal(first.status, 401, 'the plain cookie no longer authenticates');
    assert.deepEqual(first.headers.getSetCookie(), ['wv_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0']);
    assert.deepEqual([...b.jar.keys()], [], 'the browser drops it');
    const bare = await s.call('GET', '/w/alpha/api/schema', { cookie: `wv_session=${token}` });
    assert.equal(bare.status, 401);
    const own = browser(s);
    own.jar.set('wv_session', 'stale');
    own.jar.set(nameOf(s.alpha.w), token);
    const both = await own.call('GET', '/w/alpha/api/schema');
    assert.equal(both.status, 200, 'the per-workspace cookie still opens its workspace');
    assert.deepEqual([...own.jar.keys()], [nameOf(s.alpha.w)], 'and the plain one is cleared beside it');
    const quiet = await own.call('GET', '/w/alpha/api/schema');
    assert.equal(quiet.status, 200);
    assert.deepEqual(quiet.headers.getSetCookie(), [], 'once cleared, nothing more is sent');
  } finally { s.stop(); }
});
test('routes: signing in requires an account on the requested workspace and creates only its session', async () => {
  const s = await serve();
  try {
    const b = browser(s);
    const refused = await b.signIn('gamma');
    assert.equal(refused.status, 403);
    assert.deepEqual([...b.jar.keys()].filter(k => k.startsWith('wv_session')), []);
    assert.equal((await b.signIn('home')).status, 302);
    assert.deepEqual([...b.jar.keys()].filter(k => k.startsWith('wv_session')), [nameOf(s.home.w)]);
    for (const name of ['alpha', 'beta', 'gamma']) {
      assert.equal((await b.call('GET', `/w/${name}/api/schema`)).status, 401);
    }
    assert.equal((await b.call('GET', '/api/schema')).status, 200);
    assert.equal((await b.signIn('alpha')).status, 302);
    assert.equal((await b.call('GET', '/w/alpha/api/schema')).status, 200);
    assert.equal((await b.call('GET', '/w/beta/api/schema')).status, 401);
  } finally { s.stop(); }
});

test('routes: an architect in one workspace signs in with the role held in another', async () => {
  const s = await serve();
  s.home.w.setAccountRole('kyle', 'architect');
  s.alpha.w.setAccountRole('kyle', 'observer');
  try {
    const b = browser(s);
    await b.signIn('home');
    assert.equal((await b.call('GET', '/w/alpha/api/schema')).status, 401);
    await b.signIn('alpha');
    assert.equal((await b.call('GET', '/w/alpha/api/schema')).status, 200);
    const write = await b.call('POST', '/w/alpha/api/spaces', { body: { name: 'Nope' } });
    assert.equal(write.status, 403);
  } finally { s.stop(); }
});

test('routes: all-workspace search requires a session on each protected workspace', async () => {
  const s = await serve();
  try {
    const b = browser(s);
    await b.signIn('home');
    const hits = async q => (await (await b.call('GET', `/api/search?all=1&q=${q}`)).json());
    assert.ok(!(await hits('alpha')).some(r => r.workspace === 'alpha'));
    await b.signIn('alpha');
    assert.ok((await hits('alpha')).some(r => r.workspace === 'alpha'));
    assert.ok(!(await hits('gamma')).some(r => r.workspace === 'gamma'));
  } finally { s.stop(); }
});

test('routes: signing out of a workspace never falls back to another workspace session', async () => {
  const s = await serve();
  try {
    const b = browser(s);
    for (const name of ['home', 'alpha', 'beta']) await b.signIn(name);
    assert.equal((await b.call('POST', '/w/alpha/api/auth/logout')).status, 200);
    assert.equal((await b.call('GET', '/api/schema')).status, 200);
    assert.equal(s.home.w.listSessions('kyle').length, 1);
    assert.equal((await b.call('GET', '/w/alpha/api/schema')).status, 401);
    assert.equal((await b.call('GET', '/w/beta/api/schema')).status, 200);
    await b.signIn('alpha');
    assert.equal((await b.call('GET', '/w/alpha/api/schema')).status, 200);
    const homeCookie = `${nameOf(s.home.w)}=${b.jar.get(nameOf(s.home.w))}`;
    assert.equal((await b.call('POST', '/api/auth/logout?everywhere=1')).status, 200);
    assert.equal(b.jar.size, 0);
    assert.equal((await s.call('GET', '/api/schema', { cookie: homeCookie })).status, 401);
    for (const name of ['alpha', 'beta']) assert.equal((await b.call('GET', `/w/${name}/api/schema`)).status, 401);
  } finally { s.stop(); }
});
