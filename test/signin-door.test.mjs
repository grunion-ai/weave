import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { createOidc } from '../src/oidc.js';
import { renderAuthPage } from '../src/auth-page.js';
import { startIdp } from './lib/idp.mjs';

const hit = (port, host, path, { cookie, headers = {} } = {}) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, method: 'GET', path, headers: { Host: host, Accept: 'text/html', ...(cookie ? { Cookie: cookie } : {}), ...headers } }, (res) => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { text += c; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
  });
  req.on('error', reject);
  req.end();
});
const cookieOf = (res, name) => [res.headers['set-cookie'] ?? []].flat().find((c) => c.startsWith(`${name}=`))?.split(';')[0];
const APEX = 'weave.test';
const HOST = 'net.weave.test';

async function serve({ pane = true, open = { on: true, limit: 2 }, base = APEX } = {}) {
  const idp = await startIdp();
  const oidc = createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' });
  const main = new Weave();
  main.state.meta.name = 'Net';
  main.markOnboarded();
  main.createAccount({ name: 'owner', role: 'architect' });
  main.createSpace({ name: 'Sales' });
  const row = main.createEntity(main.createTable({ space: 'Sales', name: 'Deals' }), { name: 'Acme' });
  main.redeemIdentityInvite(main.linkIdentity('owner', { issuer: idp.issuer }).code, { issuer: idp.issuer, subject: 'user_owner', email: 'owner@example.com' });
  main.setRequireAuth(true);
  const harbor = new Weave();
  harbor.state.meta.name = 'harbor';
  harbor.markOnboarded();
  harbor.createAccount({ name: 'skipper', role: 'architect' });
  harbor.setRequireAuth(true);
  const { server, port } = await startServer(main, {
    port: 0, oidc, openSignup: open, workspaces: { harbor },
    ...(base ? { baseDomain: base, origin: `http://${base}` } : { origin: null }),
    ...(pane ? { clerkKey: idp.publishableKey } : {}),
    limits: { options: 1000, failed: 1000, slugs: 1000 },
  });
  const at = (host) => (path, opts) => hit(port, host, path, opts);
  const held = async (who, next = '/start') => {
    const start = await at(APEX)(`/api/auth/oidc/start?start=1&next=${encodeURIComponent(next)}`);
    const back = idp.approve(start.headers.location, who);
    const done = await at(APEX)(back.pathname + back.search, { cookie: cookieOf(start, 'wv_oidc') });
    return { done, cookie: cookieOf(done, 'wv_start') };
  };
  return { idp, main, harbor, row, apex: at(base ? APEX : 'localhost'), host: at(HOST), held, stop: () => { server.close(); idp.stop(); } };
}
const ownerLogin = (idp) => ({ sub: 'user_owner', email: 'owner@example.com', email_verified: true });
const stranger = { sub: 'user_stranger', email: 'stranger@example.com', email_verified: true };
const doorOf = (location) => {
  const u = new URL(location, `http://${APEX}`);
  return { origin: u.origin, path: u.pathname, next: u.searchParams.get('next'), mode: u.searchParams.get('mode') };
};

test('a signed-out visit to a workspace host goes to the apex start page and carries the exact row (Issue #1342)', async () => {
  const s = await serve();
  try {
    const root = await s.host('/');
    assert.equal(root.status, 302);
    const door = await s.host(root.headers.location);
    assert.deepEqual(doorOf(door.headers.location), { origin: `http://${APEX}`, path: '/start', next: '/api/start/open/net', mode: null }, 'the workspace root needs no path');
    const rowLink = `/e/${s.row.id}?view=board`;
    const wall = await s.host(rowLink);
    const rowDoor = await s.host(wall.headers.location);
    const landed = doorOf(rowDoor.headers.location);
    assert.equal(landed.path, '/start');
    assert.equal(landed.next, `/api/start/open/net?path=${encodeURIComponent(rowLink)}`, 'the row and its query ride along');
    assert.equal((await s.apex(rowDoor.headers.location.replace(`http://${APEX}`, ''))).status, 200, 'the apex accepts the door it was sent to');
  } finally { s.stop(); }
});

test('/auth on a host keeps sign-up mode and a hash route in the destination', async () => {
  const s = await serve();
  try {
    const signup = doorOf((await s.host(`/auth?mode=signup&next=${encodeURIComponent('/#/table/x')}`)).headers.location);
    assert.equal(signup.mode, 'signup');
    assert.equal(signup.next, `/api/start/open/net?path=${encodeURIComponent('/#/table/x')}`);
    const apex = doorOf((await s.apex(`/auth?mode=signup&next=${encodeURIComponent('/w/harbor/')}`)).headers.location);
    assert.deepEqual([apex.path, apex.mode, apex.next], ['/start', 'signup', '/w/harbor/'], 'the apex door keeps both too');
    const path = doorOf((await s.apex('/w/harbor/auth?mode=signup')).headers.location);
    assert.deepEqual([path.path, path.mode, path.next], ['/start', 'signup', '/w/harbor/'], 'and the path-style door');
  } finally { s.stop(); }
});

test('/auth on a host drops a next that leaves the workspace', async () => {
  const s = await serve();
  try {
    for (const evil of ['//evil.test/', '/\\evil.test/', 'https://evil.test/', 'javascript:alert(1)', `http://${HOST}.evil.test/`, '/e/x\r\nSet-Cookie: a=b']) {
      const res = await s.host(`/auth?next=${encodeURIComponent(evil)}`);
      const door = doorOf(res.headers.location);
      assert.equal(door.next, '/api/start/open/net', `${JSON.stringify(evil)} is dropped`);
      assert.equal(door.origin, `http://${APEX}`);
    }
  } finally { s.stop(); }
});

test('/start strips every next that is not a workspace, start or invite link', async () => {
  const s = await serve();
  try {
    for (const evil of ['//evil.test/w/x/', '/\\evil.test/w/x/', 'https://evil.test/w/x/', 'javascript:alert(1)', '/w/x/../../evil', '/evil', '/api/start/open/', '/api/start/open/a/b', '/api/start/open/a#frag', '/api/auth/oidc/start', '/api/auth/oidc/start?next=/x']) {
      const res = await s.apex(`/start?next=${encodeURIComponent(evil)}&mode=signup`);
      assert.equal(res.status, 302, `${evil} refused`);
      assert.equal(res.headers.location, '/start?mode=signup', `${evil} leaves only the mode`);
    }
    for (const good of ['/w/harbor/', '/w/harbor/e/abc?x=1', '/api/start/open/net', `/api/start/open/net?path=${encodeURIComponent('/e/abc')}`]) {
      assert.equal((await s.apex(`/start?next=${encodeURIComponent(good)}`)).status, 200, `${good} accepted`);
    }
  } finally { s.stop(); }
});

test('an invite door accepts only the fields an invite link carries', async () => {
  const s = await serve();
  try {
    const good = '/w/harbor/api/auth/oidc/start?invite=abc&handoff=harbor';
    assert.equal((await s.apex(`/start?next=${encodeURIComponent(good)}`)).status, 200);
    assert.equal((await s.apex(`/start?next=${encodeURIComponent('/api/auth/oidc/start?invite=abc')}`)).status, 200, 'the default workspace invite has no prefix');
    assert.equal((await s.apex(`/start?next=${encodeURIComponent(`${good}&next=${encodeURIComponent('/w/harbor/')}`)}`)).status, 200);
    for (const evil of [`${good}&as=0`, `${good}&fresh=1`, `${good}&pick=1`, `${good}&start=1`, '/w/harbor/api/auth/oidc/start?handoff=harbor', '/w/harbor/api/auth/logout', '//evil.test/api/auth/oidc/start?invite=abc']) {
      const res = await s.apex(`/start?next=${encodeURIComponent(evil)}`);
      assert.equal(res.status, 302, `${evil} refused`);
      assert.equal(res.headers.location, '/start');
    }
  } finally { s.stop(); }
});

test('the open link lands on a path inside the host and nothing else', async () => {
  const s = await serve();
  try {
    const { cookie } = await s.held(ownerLogin(s.idp));
    const landing = async (path) => {
      const open = await s.apex(`/api/start/open/net?path=${encodeURIComponent(path)}`, { cookie });
      assert.equal(open.status, 302, path);
      const u = new URL(open.headers.location);
      assert.equal(u.host, HOST);
      const handoff = await s.host(u.pathname + u.search);
      return handoff.headers.location;
    };
    const rowLink = `/e/${s.row.id}?view=board`;
    assert.equal(await landing(rowLink), rowLink);
    assert.equal(await landing('/#/table/x'), '/#/table/x');
    for (const evil of ['//evil.test/', '/\\evil.test/', 'https://evil.test/', '/api/auth/logout', '/mcp', '/e/x\r\nSet-Cookie: a=b']) {
      assert.equal(await landing(evil), '/', `${JSON.stringify(evil)} lands on the workspace root`);
    }
  } finally { s.stop(); }
});

test('an invite with no login goes through the start page and resumes after sign-in, without changing the chooser', async () => {
  const s = await serve();
  try {
    const code = s.main.inviteMember({ email: 'stranger@example.com', role: 'editor', issuer: s.idp.issuer }).code;
    const bounced = await s.host(`/api/auth/oidc/start?invite=${code}`);
    const u = new URL(bounced.headers.location);
    assert.equal(u.host, APEX);
    const door = await s.apex(u.pathname + u.search);
    const landed = doorOf(door.headers.location);
    assert.equal(door.status, 302);
    assert.equal(landed.path, '/start');
    assert.equal(landed.next, `/w/Net/api/auth/oidc/start?invite=${code}&handoff=net`);
    assert.equal(s.idp.seen.authorized, 0, 'the hosted page is not reached');
    const page = await s.apex(door.headers.location);
    assert.equal(page.status, 200);
    const { done, cookie } = await s.held(stranger, landed.next);
    assert.equal(done.headers.location, landed.next, 'the held login returns to the invite');
    const chooser = await s.apex(landed.next, { cookie });
    assert.equal(chooser.status, 200, 'the chooser still answers until the next chunk removes it');
    assert.match(chooser.text, /stranger@example\.com/);
  } finally { s.stop(); }
});

test('a used invite still refuses, and a chooser link for another login still reaches the provider', async () => {
  const s = await serve();
  try {
    assert.equal((await s.apex('/w/Net/api/auth/oidc/start?invite=nope&handoff=net')).status, 410);
    const code = s.main.inviteMember({ email: 'stranger@example.com', role: 'editor', issuer: s.idp.issuer }).code;
    const other = await s.apex(`/w/Net/api/auth/oidc/start?invite=${code}&handoff=net&fresh=1&pick=1`);
    assert.equal(new URL(other.headers.location).origin, s.idp.issuer);
  } finally { s.stop(); }
});

test('with no Clerk pane an invite still goes straight to the provider', async () => {
  const s = await serve({ pane: false });
  try {
    const code = s.main.inviteMember({ email: 'stranger@example.com', role: 'editor', issuer: s.idp.issuer }).code;
    const res = await s.apex(`/w/Net/api/auth/oidc/start?invite=${code}&handoff=net`);
    assert.equal(new URL(res.headers.location).origin, s.idp.issuer);
  } finally { s.stop(); }
});

test('/start on a workspace host redirects to the apex and keeps the query (Issue #1343)', async () => {
  const s = await serve();
  try {
    const plain = await s.host('/start');
    assert.equal(plain.status, 302);
    assert.equal(plain.headers.location, `http://${APEX}/start`);
    assert.equal((await s.host('/start?mode=signup')).headers.location, `http://${APEX}/start?mode=signup`);
  } finally { s.stop(); }
});

test('a held login that opens no account on a start link goes back to the start page, not a refusal', async () => {
  const s = await serve();
  try {
    const link = '/api/start/open/harbor';
    const member = await s.held(ownerLogin(s.idp), '/api/start/open/net');
    assert.equal(member.done.headers.location, '/api/start/open/net', 'a member goes straight on');
    const outsider = await s.held(stranger, link);
    assert.equal(outsider.done.status, 302);
    assert.equal(outsider.done.headers.location, `/start?next=${encodeURIComponent(link)}`);
    assert.ok(outsider.cookie, 'the login stays held');
  } finally { s.stop(); }
});

test('a path-style door trip that opens no account returns to the start page with the login held', async () => {
  const s = await serve();
  try {
    const link = '/w/harbor/e/abc';
    const start = await s.apex(`/w/harbor/api/auth/oidc/start?door=1&next=${encodeURIComponent(link)}`);
    const back = s.idp.approve(start.headers.location, stranger);
    const done = await s.apex(back.pathname + back.search, { cookie: cookieOf(start, 'wv_oidc') });
    assert.equal(done.status, 302);
    assert.equal(done.headers.location, `/start?next=${encodeURIComponent(link)}`);
    assert.ok(cookieOf(done, 'wv_start'), 'the login stays held so the start page can name the workspace');
    const plain = await s.apex(`/w/harbor/api/auth/oidc/start?next=${encodeURIComponent(link)}`);
    const plainBack = s.idp.approve(plain.headers.location, stranger);
    const refused = await s.apex(plainBack.pathname + plainBack.search, { cookie: cookieOf(plain, 'wv_oidc') });
    assert.equal(refused.status, 403, 'other doors keep the refusal page until the recovery chunk');
  } finally { s.stop(); }
});

test('/start takes a redirect_url only on the provider\'s OAuth path', async () => {
  const s = await serve();
  try {
    const issuer = s.idp.issuer;
    const good = `${issuer}/oauth/authorize?client_id=dyn_1&state=x`;
    assert.equal((await s.apex(`/start?redirect_url=${encodeURIComponent(good)}`)).status, 200);
    const issuerHost = new URL(issuer).host;
    for (const evil of ['https://evil.test/oauth/authorize', '//evil.test/oauth/authorize', `${issuer}.evil.test/oauth/authorize`, `http://${issuerHost}@evil.test/oauth/authorize`, `${issuer}/sign-out`, `${issuer}/oauth/../sign-out`, 'javascript:alert(1)', '/oauth/authorize', `http://evil.test\\@${issuerHost}/oauth/authorize`]) {
      const res = await s.apex(`/start?redirect_url=${encodeURIComponent(evil)}`);
      assert.equal(res.status, 302, `${evil} refused`);
      assert.equal(res.headers.location, '/start');
    }
  } finally { s.stop(); }
});

test('with no Clerk pane /start ignores a redirect_url', async () => {
  const s = await serve({ pane: false });
  try {
    const res = await s.apex(`/start?redirect_url=${encodeURIComponent(`${s.idp.issuer}/oauth/authorize`)}`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/start');
  } finally { s.stop(); }
});

test('the sign-in page names no vendor and no operator, and links sign-up when open sign-up is on (Issue #1335)', async () => {
  const s = await serve();
  try {
    const page = await s.host('/auth?signed-out=1');
    assert.equal(page.status, 200);
    assert.doesNotMatch(page.text, /Sign in with Clerk/);
    assert.doesNotMatch(page.text, /operator/i);
    assert.doesNotMatch(page.text, /linked to your Clerk/);
    assert.match(page.text, /id="signup"[^>]*href="http:\/\/weave\.test\/start\?mode=signup"/);
    assert.match(page.text, /Create an account/);
    assert.match(page.text, /id="oidc"[^>]*href="\/auth"/, 'with the start page available, Sign in goes through it');
  } finally { s.stop(); }
  const closed = await serve({ open: { on: false } });
  try {
    const page = await closed.host('/auth?signed-out=1');
    assert.doesNotMatch(page.text, /id="signup"/);
    assert.match(page.text, /workspace architect/);
  } finally { closed.stop(); }
});

test('a self-hosted server with no pane keeps the page and its provider door', async () => {
  const s = await serve({ pane: false, base: null, open: { on: true, limit: 1 } });
  try {
    const page = await s.apex('/w/harbor/auth?signed-out=1');
    assert.equal(page.status, 200);
    assert.match(page.text, /id="oidc"[^>]*href="\/w\/harbor\/api\/auth\/oidc\/start"/);
    assert.match(page.text, /id="signup"[^>]*href="\/start\?mode=signup"/);
  } finally { s.stop(); }
});

test('renderAuthPage leaves no sign-in section action behind when no provider is set', () => {
  const html = renderAuthPage({ workspace: 'Solo' });
  assert.doesNotMatch(html, /id="oidc"/);
  assert.doesNotMatch(html, /id="signup"/);
  assert.match(html, /WEAVE_OIDC_ISSUER/);
});
