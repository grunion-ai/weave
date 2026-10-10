import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { createOidc } from '../src/oidc.js';
import { startIdp } from './lib/idp.mjs';
await import('../public/slug-core.js');
const { WeaveSlugs } = globalThis;

const hit = (port, host, method, path, { cookie, body, token } = {}) => new Promise((resolve, reject) => {
  const payload = body === undefined ? null : JSON.stringify(body);
  const req = request({
    host: '127.0.0.1', port, method, path,
    headers: { Host: host, ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(payload ? { 'Content-Type': 'application/json' } : {}) },
  }, (res) => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { text += c; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
  });
  req.on('error', reject);
  req.end(payload ?? undefined);
});
const setCookies = (res) => [res.headers['set-cookie'] ?? []].flat();
const cookieOf = (res, name) => setCookies(res).find((c) => c.startsWith(`${name}=`))?.split(';')[0];
const cookieLine = (res, name) => setCookies(res).find((c) => c.startsWith(`${name}=`));

async function serve({ withOidc = true } = {}) {
  const idp = await startIdp();
  const oidc = withOidc ? createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' }) : null;
  const dir = mkdtempSync(join(tmpdir(), 'weave-find-'));
  const pin = (w, name, role, subject) => {
    w.createAccount({ name, role });
    w.redeemIdentityInvite(w.linkIdentity(name, { issuer: idp.issuer }).code, { issuer: idp.issuer, subject });
  };
  let inviteCode;
  for (const name of ['acme', 'other', 'weave']) {
    const w = new Weave({ path: join(dir, `${name}.db`), name });
    w.state.meta.name = name;
    if (name === 'acme') { pin(w, 'eve', 'editor', 'user_eve'); pin(w, 'kyle', 'architect', 'user_kyle'); }
    if (name === 'other') {
      pin(w, 'dana', 'editor', 'user_dana');
      w.createAccount({ name: 'someone', role: 'architect' });
      inviteCode = w.linkIdentity('someone', { issuer: idp.issuer }).code;
    }
    if (name !== 'weave') w.setRequireAuth(true);
    w.save();
    w.store.close?.();
  }
  const main = new Weave({ path: join(dir, 'workspace.db'), name: 'Net' });
  main.state.meta.name = 'Net';
  main.createAccount({ name: 'Kyle Adriany', role: 'architect' });
  main.redeemIdentityInvite(main.linkIdentity('Kyle Adriany', { issuer: idp.issuer }).code, { issuer: idp.issuer, subject: 'user_kyle' });
  main.setRequireAuth(true);
  main.save();
  const { server, port } = await startServer(main, { port: 0, baseDomain: 'weave.test', origin: 'http://weave.test', oidc, limits: { options: 1000, failed: 1000, slugs: 1000 } });
  const at = (host) => (method, path, opts) => hit(port, host, method, path, opts);
  const apex = at('weave.test');
  const follow = (location, opts) => { const u = new URL(location, 'http://weave.test'); return at(u.host)('GET', u.pathname + u.search, opts); };
  const signInAtStart = async (claims, cookie) => {
    const start = await apex('GET', '/api/auth/oidc/start?start=1&fresh=1', { cookie });
    const back = idp.approve(start.headers.location, claims);
    const res = await follow(back.href, { cookie: [cookie, cookieOf(start, 'wv_oidc')].filter(Boolean).join('; ') });
    return { res, cookie: cookieOf(res, 'wv_start') ?? cookie };
  };
  return { dir, port, at, apex, follow, signInAtStart, idp, inviteCode, stop: () => { server.close(); idp.stop(); rmSync(dir, { recursive: true, force: true }); } };
}

test('start: each sign-in adds a login to the one start cookie; the rows are the union, each naming the login that opens it', async () => {
  const s = await serve();
  try {
    const first = await s.signInAtStart({ sub: 'user_eve' });
    let me = (await s.apex('GET', '/api/start', { cookie: first.cookie })).json();
    assert.deepEqual(me.rows.map((r) => [r.kind, r.name, r.login]), [['workspace', 'acme', 'eve']]);
    assert.deepEqual(me.logins, ['eve'], 'a login with no verified address is named by an account it opens');

    const second = await s.signInAtStart({ sub: 'user_dana', email: 'Dana@Example.com', email_verified: true }, first.cookie);
    assert.equal(second.cookie, first.cookie, 'the second sign-in keeps the browser on the same start cookie');
    me = (await s.apex('GET', '/api/start', { cookie: second.cookie })).json();
    assert.deepEqual(me.logins, ['eve', 'dana@example.com']);
    assert.deepEqual(me.rows.map((r) => [r.name, r.login]), [['acme', 'eve'], ['other', 'dana@example.com']]);

    const again = await s.signInAtStart({ sub: 'user_eve' }, second.cookie);
    me = (await s.apex('GET', '/api/start', { cookie: again.cookie })).json();
    assert.deepEqual(me.logins, ['eve', 'dana@example.com'], 'the same login twice is one login');

    const kyle = await s.signInAtStart({ sub: 'user_kyle' }, again.cookie);
    me = (await s.apex('GET', '/api/start', { cookie: kyle.cookie })).json();
    assert.deepEqual(me.rows.map((r) => [r.name, r.login]), [['Net', 'Kyle Adriany'], ['acme', 'eve'], ['other', 'dana@example.com'], ['weave', 'Kyle Adriany']], 'a workspace two logins open is listed once, under the first; the root architect opens the docs workspace too');
    assert.equal(me.canCreate, true, 'the root architect among the logins may create');
  } finally { s.stop(); }
});

test('rail: the start page sets a rail cookie for the whole base domain naming the workspaces found, docs workspace excluded', async () => {
  const s = await serve();
  try {
    const eve = await s.signInAtStart({ sub: 'user_eve' });
    const dana = await s.signInAtStart({ sub: 'user_dana' }, eve.cookie);
    const res = await s.apex('GET', '/api/start', { cookie: dana.cookie });
    const rail = cookieLine(res, 'wv_rail');
    assert.ok(rail, 'GET /api/start sets wv_rail');
    assert.equal(rail.split(';')[0], 'wv_rail=acme,other');
    assert.match(rail, /; Domain=\.weave\.test(;|$)/, 'every workspace host reads the rail');
    assert.match(rail, /; Path=\/(;|$)/);
    assert.match(rail, /; SameSite=Lax(;|$)/);
    assert.match(rail, /; HttpOnly/, 'only the server reads it');
  } finally { s.stop(); }
});

test('open: the start page opens a workspace with whichever held login has the account there', async () => {
  const s = await serve();
  try {
    const eve = await s.signInAtStart({ sub: 'user_eve' });
    const both = await s.signInAtStart({ sub: 'user_dana' }, eve.cookie);
    for (const [slug, host, name] of [['acme', 'acme.weave.test', 'eve'], ['other', 'other.weave.test', 'dana']]) {
      const open = await s.apex('GET', `/api/start/open/${slug}`, { cookie: both.cookie });
      assert.equal(open.status, 302, `${slug} opens`);
      const landed = await s.follow(open.headers.location);
      const session = cookieOf(landed, [landed.headers['set-cookie']].flat()[0].split('=')[0]);
      const me = (await s.at(host)('GET', '/api/auth/me', { cookie: session })).json();
      assert.equal(me.account.name, name, `${slug} opened as the login that has an account there`);
    }
    assert.equal((await s.apex('GET', '/api/start/open/Net', { cookie: both.cookie })).status, 403, 'a workspace no held login opens is refused');
  } finally { s.stop(); }
});

test('rail: a workspace host lists the held workspaces from the rail cookie as chips that open through the start page', async () => {
  const s = await serve();
  try {
    const eve = await s.signInAtStart({ sub: 'user_eve' });
    const open = await s.apex('GET', '/api/start/open/acme', { cookie: eve.cookie });
    const landed = await s.follow(open.headers.location);
    const session = cookieOf(landed, [landed.headers['set-cookie']].flat()[0].split('=')[0]);
    const acme = s.at('acme.weave.test');

    const bare = (await acme('GET', '/api/workspaces', { cookie: session })).json();
    assert.deepEqual(bare.map((w) => w.name).sort(), ['acme', 'weave'], 'without a rail cookie this host knows only its own session');

    const list = (await acme('GET', '/api/workspaces', { cookie: `${session}; wv_rail=other,ghost,acme,weave` })).json();
    assert.deepEqual(list.map((w) => w.name).sort(), ['acme', 'other', 'weave']);
    const other = list.find((w) => w.name === 'other');
    assert.equal(other.held, true, 'a rail entry this host cannot verify is marked held');
    assert.equal(other.open, 'http://weave.test/api/start/open/other', 'its chip opens through the apex start page');
    assert.equal(other.host, 'http://other.weave.test/');
    assert.equal(list.find((w) => w.name === 'acme').held, undefined, 'a workspace this host verifies is not held');
    assert.equal(list.find((w) => w.name === 'ghost'), undefined, 'an unknown rail entry is dropped');

    const meta = (await acme('GET', '/api/workspace', { cookie: session })).json();
    assert.equal(meta.start, 'http://weave.test/start', 'the workspace page knows where the start page is');
  } finally { s.stop(); }
});

test('rail: without an identity provider there is no start page to point at', async () => {
  const s = await serve({ withOidc: false });
  try {
    const meta = (await s.at('weave.weave.test')('GET', '/api/workspace')).json();
    assert.equal('start' in meta, false);
  } finally { s.stop(); }
});

test('auto: a plain sign-in at a workspace also records the login at the apex and draws the rail, so find my workspaces runs itself', async () => {
  const s = await serve();
  try {
    const acme = s.at('acme.weave.test');
    const bounce = await acme('GET', '/api/auth/oidc/start');
    assert.equal(bounce.status, 302);
    const start = await s.follow(bounce.headers.location);
    const back = s.idp.approve(start.headers.location, { sub: 'user_eve' });
    const res = await s.follow(back.href, { cookie: cookieOf(start, 'wv_oidc') });
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /^http:\/\/acme\.weave\.test\/api\/auth\/handoff\?code=/);
    assert.equal(cookieOf(res, 'wv_rail'), 'wv_rail=acme', 'the hand-off carries the rail');
    const held = cookieOf(res, 'wv_start');
    assert.ok(held, 'the hand-off carries the start cookie');
    const me = (await s.apex('GET', '/api/start', { cookie: held })).json();
    assert.deepEqual(me.rows.map((r) => [r.name, r.login]), [['acme', 'eve']]);
  } finally { s.stop(); }
});

test('invite: a browser that already holds a login is offered accept-as or another login; accept-as needs no provider trip', async () => {
  const s = await serve();
  try {
    const eve = await s.signInAtStart({ sub: 'user_eve' });
    const path = `/w/other/api/auth/oidc/start?handoff=other&invite=${encodeURIComponent(s.inviteCode)}&next=%2F`;
    const page = await s.apex('GET', path, { cookie: eve.cookie });
    assert.equal(page.status, 200);
    assert.match(page.headers['content-type'], /text\/html/);
    assert.match(page.text, /Accept as eve/);
    assert.match(page.text, /Use another login/);
    const hrefs = [...page.text.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    const asEve = hrefs.find((h) => /(\?|&)as=0(&|$)/.test(h));
    const another = hrefs.find((h) => /(\?|&)pick=1(&|$)/.test(h));
    assert.ok(asEve && asEve.includes(`invite=${encodeURIComponent(s.inviteCode)}`), 'accept-as keeps the invite');
    assert.ok(another && /(\?|&)fresh=1(&|$)/.test(another), 'another login asks the provider for its account picker');

    const cold = await s.apex('GET', path);
    assert.equal(cold.status, 302, 'with no held login the invite goes straight to the provider');
    assert.equal(new URL(cold.headers.location).origin, new URL(s.idp.issuer).origin);

    const picker = await s.follow(another, { cookie: eve.cookie });
    assert.equal(picker.status, 302);
    const to = new URL(picker.headers.location);
    assert.equal(to.origin, new URL(s.idp.issuer).origin, 'another login goes to the provider');
    assert.match(to.searchParams.get('prompt') ?? '', /login/);

    const accepted = await s.follow(asEve, { cookie: eve.cookie });
    assert.equal(accepted.status, 302);
    assert.match(accepted.headers.location, /^http:\/\/other\.weave\.test\/api\/auth\/handoff\?code=/);
    assert.equal(cookieOf(accepted, 'wv_rail'), 'wv_rail=acme,other', 'the rail grows by the accepted workspace');
    const landed = await s.follow(accepted.headers.location);
    const session = cookieOf(landed, [landed.headers['set-cookie']].flat()[0].split('=')[0]);
    const me = (await s.at('other.weave.test')('GET', '/api/auth/me', { cookie: session })).json();
    assert.equal(me.account.name, 'someone', 'the invite bound eve to the account it was sent for');
    assert.equal((await s.follow(asEve, { cookie: eve.cookie })).status, 410, 'the invite is single use');
  } finally { s.stop(); }
});

test('sign out: the start page forgets every held login and the rail', async () => {
  const s = await serve();
  try {
    const eve = await s.signInAtStart({ sub: 'user_eve' });
    const out = await s.apex('POST', '/api/start/signout', { cookie: eve.cookie, body: {} });
    assert.equal(out.status, 200);
    assert.match(cookieLine(out, 'wv_start'), /Max-Age=0/);
    assert.match(cookieLine(out, 'wv_rail'), /Max-Age=0/);
    assert.match(cookieLine(out, 'wv_rail'), /Domain=\.weave\.test/);
    assert.equal((await s.apex('GET', '/api/start', { cookie: eve.cookie })).json().signedIn, false);
  } finally { s.stop(); }
});

test('copy: the start page and the rail menu read their words from slug-core', () => {
  for (const key of ['addLogin', 'find', 'signOut', 'newWorkspace', 'acceptAs', 'otherLogin', 'chooserTitle']) {
    assert.equal(typeof WeaveSlugs.COPY.start[key], 'string', key);
  }
  assert.match(WeaveSlugs.COPY.start.acceptAs, /\{login\}/);
  assert.match(WeaveSlugs.COPY.start.chooserTitle, /\{workspace\}/);
});
