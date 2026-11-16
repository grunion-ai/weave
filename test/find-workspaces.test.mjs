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
import { tempDir } from './lib/temp.mjs';
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
  const dir = tempDir('weave-find-');
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
    assert.deepEqual(me.rows.map((r) => [r.name, r.login]), [['Net', 'Kyle Adriany'], ['acme', 'eve'], ['other', 'dana@example.com']], 'only local memberships are listed, once under the first matching login');
    assert.equal(me.canCreate, false, 'membership does not bypass the closed signup policy');
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

const openAs = async (s, sub, slug, held) => {
  const login = await s.signInAtStart({ sub }, held);
  const open = await s.apex('GET', `/api/start/open/${slug}`, { cookie: login.cookie });
  const landed = await s.follow(open.headers.location);
  return { start: login.cookie, session: cookieOf(landed, [landed.headers['set-cookie']].flat()[0].split('=')[0]) };
};
const openAcme = async (s) => (await openAs(s, 'user_kyle', 'acme')).session;
const signInLink = (slug) => `http://weave.test/api/auth/oidc/start?start=1&fresh=1&next=${encodeURIComponent(`/api/start/open/${slug}`)}`;

test('rail: the grey tiles come from the signed-in account, so a fresh browser shows them from the first sign-in and a stale rail cookie adds nothing (Issue #1821)', async () => {
  const s = await serve();
  try {
    const { session } = await openAs(s, 'user_kyle', 'acme');
    const acme = s.at('acme.weave.test');

    const list = (await acme('GET', '/api/workspaces', { cookie: session })).json();
    assert.deepEqual(list.map((w) => w.name).sort(), ['Net', 'acme', 'weave'], 'the account also opens Net, so Net shows with no rail cookie at all');
    const net = list.find((w) => w.name === 'Net');
    assert.equal(net.held, true, 'a workspace the account opens with no live session here is held');
    assert.equal(net.open, signInLink('Net'), 'its tile opens through the apex sign-in');
    assert.equal(net.host, 'http://net.weave.test/');
    assert.deepEqual(Object.keys(net).sort(), ['held', 'host', 'id', 'name', 'open'], 'a held entry names the workspace and nothing it holds');
    assert.equal(list.find((w) => w.name === 'acme').held, undefined, 'a workspace this host verifies is not held');

    const railed = (await acme('GET', '/api/workspaces', { cookie: `${session}; wv_rail=other,ghost,acme,weave` })).json();
    assert.deepEqual(railed.map((w) => w.name).sort(), ['Net', 'acme', 'weave'], 'a rail cookie naming a workspace the account cannot open adds no tile');

    const second = await openAs(s, 'user_kyle', 'Net');
    const fromNet = (await s.at('net.weave.test')('GET', '/api/workspaces', { cookie: second.session })).json();
    assert.deepEqual(fromNet.map((w) => w.name).sort(), ['Net', 'acme', 'weave'], 'the same person sees the same tiles from another workspace in another fresh browser');
    assert.equal(fromNet.find((w) => w.name === 'acme').held, true);

    const meta = (await acme('GET', '/api/workspace', { cookie: session })).json();
    assert.equal(meta.start, 'http://weave.test/start', 'the workspace page knows where the start page is');
  } finally { s.stop(); }
});

test('rail: a second login in the same browser never sees the workspaces the first login opened (Issue #1821)', async () => {
  const s = await serve();
  try {
    const eve = await openAs(s, 'user_eve', 'acme');
    const dana = await openAs(s, 'user_dana', 'other', eve.start);
    const other = s.at('other.weave.test');
    const list = (await other('GET', '/api/workspaces', { cookie: `${dana.session}; wv_rail=acme,other` })).json();
    assert.deepEqual(list.map((w) => w.name).sort(), ['other', 'weave'], 'acme, opened by eve, does not reach dana');
    assert.equal(list.some((w) => w.held), false);
  } finally { s.stop(); }
});

test('rail: on one host the logins held at the start page add their workspaces too (Issue #1821)', async () => {
  const s = await serve();
  try {
    const eve = await openAs(s, 'user_eve', 'acme');
    const dana = await s.signInAtStart({ sub: 'user_dana' }, eve.start);
    const apex = (await s.apex('GET', '/w/acme/api/workspaces', { cookie: `${dana.cookie}; ${eve.session}` })).json();
    const held = apex.filter((w) => w.held).map((w) => w.name).sort();
    assert.ok(held.includes('other'), 'dana, held under the start cookie, adds other');
    assert.equal(held.includes('Net'), false, 'no held login has an account on Net');
  } finally { s.stop(); }
});

test('rail: a grey tile opens through the apex sign-in, so a login held at the start page mints no session on its own (Issue #1822)', async () => {
  const s = await serve();
  try {
    const kyle = await openAs(s, 'user_kyle', 'acme');
    const tile = (await s.at('acme.weave.test')('GET', '/api/workspaces', { cookie: kyle.session })).json().find((w) => w.name === 'Net');
    const u = new URL(tile.open);
    assert.equal(u.host, 'weave.test');
    const click = await s.apex('GET', u.pathname + u.search, { cookie: kyle.start });
    assert.equal(click.status, 302);
    assert.equal(new URL(click.headers.location).origin, new URL(s.idp.issuer).origin, 'the click goes to the identity provider');
    assert.match(new URL(click.headers.location).searchParams.get('prompt') ?? '', /\blogin\b/, 'the provider is asked to sign the person in again');
    assert.deepEqual(setCookies(click).map((c) => c.split('=')[0]), ['wv_oidc'], 'no workspace session comes back from the click');

    const back = s.idp.approve(click.headers.location, { sub: 'user_kyle' });
    const done = await s.follow(back.href, { cookie: `${kyle.start}; ${cookieOf(click, 'wv_oidc')}` });
    assert.equal(done.headers.location, '/api/start/open/Net', 'after the sign-in the open link runs');
    const open = await s.apex('GET', done.headers.location, { cookie: cookieOf(done, 'wv_start') });
    const landed = await s.follow(open.headers.location);
    const session = cookieOf(landed, [landed.headers['set-cookie']].flat()[0].split('=')[0]);
    assert.equal((await s.at('net.weave.test')('GET', '/api/auth/me', { cookie: session })).json().account.name, 'Kyle Adriany');

    const fromStart = await s.apex('GET', '/api/start/open/Net', { cookie: kyle.start });
    assert.equal(fromStart.status, 302, 'the start page open link still opens right after a sign-in');
    assert.equal(new URL(fromStart.headers.location).host, 'net.weave.test');
  } finally { s.stop(); }
});

test('recency: a workspace page load moves its name to the front of wv_recent; API and asset requests leave it alone (Feature #349)', async () => {
  const s = await serve();
  try {
    const session = await openAcme(s);
    const acme = s.at('acme.weave.test');
    const first = await acme('GET', '/', { cookie: session });
    assert.equal(first.status, 200);
    const line = cookieLine(first, 'wv_recent');
    assert.ok(line, 'the workspace page sets wv_recent');
    assert.equal(line.split(';')[0], 'wv_recent=acme');
    assert.match(line, /; Domain=\.weave\.test(;|$)/, 'every workspace host reads the same recency');
    assert.match(line, /; Path=\/(;|$)/);
    assert.match(line, /; SameSite=Lax(;|$)/);
    assert.match(line, /; HttpOnly/);
    assert.match(line, new RegExp(`; Max-Age=${Weave.SESSION_TTL_MS / 1000}(;|$)`), 'it lives as long as the rail');

    const again = await acme('GET', '/', { cookie: `${session}; wv_recent=other,acme,weave,acme` });
    assert.equal(cookieOf(again, 'wv_recent'), 'wv_recent=acme,other,weave', 'the opened workspace moves to the front, each name once');

    for (const path of ['/api/workspaces', '/api/workspace', '/app.js', '/style.css']) {
      const res = await acme('GET', path, { cookie: `${session}; wv_recent=other` });
      assert.equal(cookieLine(res, 'wv_recent'), undefined, `${path} does not stamp recency`);
    }

    const long = Array.from({ length: 80 }, (_, i) => `w${i}`).join(',');
    const capped = cookieOf(await acme('GET', '/', { cookie: `${session}; wv_recent=${long}` }), 'wv_recent').split('=')[1].split(',');
    assert.equal(capped.length, 50, 'the cookie keeps the fifty most recent names');
    assert.equal(capped[0], 'acme');
  } finally { s.stop(); }
});

test('recency: GET /api/workspaces sorts by wv_recent, held chips included, and keeps the old order for names it does not hold (Feature #349)', async () => {
  const s = await serve();
  try {
    const session = await openAcme(s);
    const acme = s.at('acme.weave.test');
    const cookie = session;
    const names = async (extra = '') => (await acme('GET', '/api/workspaces', { cookie: cookie + extra })).json();
    const natural = (await names()).map((w) => w.name);
    assert.deepEqual([...natural].sort(), ['Net', 'acme', 'weave']);

    const byRecent = await names('; wv_recent=weave,net');
    assert.deepEqual(byRecent.map((w) => w.name), ['weave', 'Net', 'acme']);
    assert.equal(byRecent[1].held, true, 'a held chip takes its place by the same rule');

    const one = await names('; wv_recent=acme,ghost');
    assert.deepEqual(one.map((w) => w.name), ['acme', ...natural.filter((n) => n !== 'acme')], 'names the cookie does not hold keep their order after the named ones');

    const heldFirst = await names('; wv_recent=net');
    assert.deepEqual(heldFirst.map((w) => w.name), ['Net', ...natural.filter((n) => n !== 'Net')]);
  } finally { s.stop(); }
});

test('recency: on one host with no base domain and no sign-in, /w/<name>/ page loads drive the order (Feature #349)', async () => {
  const dir = tempDir('weave-recent-');
  for (const name of ['acme', 'other']) {
    const w = new Weave({ path: join(dir, `${name}.db`), name });
    w.state.meta.name = name;
    w.save();
    w.store.close?.();
  }
  const main = new Weave({ path: join(dir, 'workspace.db'), name: 'Net' });
  main.state.meta.name = 'Net';
  main.save();
  const { server, port } = await startServer(main, { port: 0 });
  const get = (path, cookie) => hit(port, `127.0.0.1:${port}`, 'GET', path, { cookie });
  try {
    const page = await get('/w/other/');
    assert.equal(page.status, 200);
    const line = cookieLine(page, 'wv_recent');
    assert.equal(line?.split(';')[0], 'wv_recent=other');
    assert.match(line, /; Path=\/(;|$)/, 'every /w/<name>/ path reads it');
    assert.doesNotMatch(line, /Domain=/, 'one host keeps a host-only cookie');

    assert.equal(cookieOf(await get('/w/acme/', 'wv_recent=other'), 'wv_recent'), 'wv_recent=acme,other');
    const root = (await get('/api/workspaces')).json();
    const rootName = root.find((w) => w.default).name.toLowerCase();
    assert.equal(cookieOf(await get('/', 'wv_recent=acme,other'), 'wv_recent'), `wv_recent=${rootName},acme,other`, 'the root page stamps the default workspace');

    const api = await get('/w/acme/api/workspaces', 'wv_recent=other,acme');
    assert.equal(cookieLine(api, 'wv_recent'), undefined);
    const natural = root.map((w) => w.name);
    assert.deepEqual(api.json().map((w) => w.name), ['other', 'acme', ...natural.filter((n) => !['other', 'acme'].includes(n))]);
  } finally {
    server.close();
    main.store.close?.();
    rmSync(dir, { recursive: true, force: true });
  }
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
