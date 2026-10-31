import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer, hostAllowed, hostCheckFor, baseDomainFromEnv } from '../src/server.js';
import { workspaceSlug, hostSlugRefusal } from '../src/workspace-name.js';
import { createOidc } from '../src/oidc.js';
import { startIdp } from './lib/idp.mjs';
import { tempDir } from './lib/temp.mjs';

const BASE = 'weave.test';

const hit = (port, host, method, path, { cookie, body } = {}) => new Promise((resolve, reject) => {
  const payload = body === undefined ? null : JSON.stringify(body);
  const req = request({
    host: '127.0.0.1', port, method, path,
    headers: { Host: host, ...(cookie ? { Cookie: cookie } : {}), ...(payload ? { 'Content-Type': 'application/json' } : {}) },
  }, (res) => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { text += c; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
  });
  req.on('error', reject);
  req.end(payload ?? undefined);
});

async function serveHub({ baseDomain = BASE, oidc = null, origin = null, before = () => {} } = {}) {
  const dir = tempDir('weave-hosts-');
  before(dir);
  const main = new Weave({ path: join(dir, 'workspace.db'), name: 'Net' });
  main.state.meta.name = 'Net';
  main.save();
  const { server, port } = await startServer(main, { port: 0, baseDomain, origin, oidc, limits: { options: 1000, failed: 1000 } });
  const at = (host) => (method, path, opts) => hit(port, host, method, path, opts);
  return { dir, main, port, at, stop: () => { server.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('slug rules: a workspace slug is a DNS label, and the reserved names are refused', () => {
  assert.equal(workspaceSlug('ops_hub-2'), 'ops-hub-2', 'an underscore folds to a hyphen');
  assert.equal(workspaceSlug('x'.repeat(80)).length, 63, 'at most 63 characters');
  assert.equal(workspaceSlug('-Acme-'), 'acme');
  for (const ok of ['net', 'a', 'acme-team', '9lives', 'x'.repeat(63)]) assert.equal(hostSlugRefusal(ok), null, ok);
  for (const bad of ['www', 'app', 'api', 'mcp', 'auth', 'docs', 'status', 'admin', 'mail', 'clerk', 'accounts', 'clkmail', 'clk', 'clk2', '_dmarc', 'xn--bcher-kva', '-a', 'a-', 'a_b', 'A', 'x'.repeat(64), '']) {
    assert.ok(hostSlugRefusal(bad), JSON.stringify(bad));
  }
});

test('config: WEAVE_BASE_DOMAIN is a bare host name, and unset is null', () => {
  assert.equal(baseDomainFromEnv({}), null);
  assert.equal(baseDomainFromEnv({ WEAVE_BASE_DOMAIN: ' Weave.Example.com ' }), 'weave.example.com');
  for (const bad of ['https://weave.example.com', 'weave.example.com/x', 'weave example', 'weave.example.com:443']) {
    assert.throws(() => baseDomainFromEnv({ WEAVE_BASE_DOMAIN: bad }), /WEAVE_BASE_DOMAIN/, bad);
  }
  assert.equal(hostCheckFor({ host: '0.0.0.0', env: { WEAVE_BASE_DOMAIN: BASE } }).enforce, true);
});

test('allowed hosts: one label under the base domain answers only when the base domain is set', () => {
  assert.equal(hostAllowed('net.weave.test', {}), false);
  assert.equal(hostAllowed('net.weave.test', { baseDomain: BASE }), true);
  assert.equal(hostAllowed('NET.weave.test:443', { baseDomain: BASE }), true);
  assert.equal(hostAllowed('weave.test', { baseDomain: BASE }), true);
  for (const h of ['a.b.weave.test', 'evilweave.test', 'weave.test.evil.example', 'evil.example']) {
    assert.equal(hostAllowed(h, { baseDomain: BASE }), false, h);
  }
});

test('host routing: <slug>.<base> serves that workspace, the apex the default, /w/ everywhere, unknown 404', async () => {
  const s = await serveHub();
  try {
    assert.equal((await s.at('weave.test')('POST', '/api/workspaces', { body: { name: 'Acme' } })).status, 201);
    const acme = s.at('acme.weave.test');
    assert.equal((await acme('GET', '/api/workspace')).json().name, 'acme');
    assert.equal((await s.at('ACME.weave.test')('GET', '/api/workspace')).json().name, 'acme');
    assert.equal((await s.at('weave.test')('GET', '/api/workspace')).json().name, 'Net', 'the apex keeps the default workspace');
    assert.equal((await s.at('net.weave.test')('GET', '/api/workspace')).json().name, 'Net', 'net reaches the default workspace named Net');
    assert.equal((await acme('GET', '/w/Net/api/workspace')).json().name, 'Net', '/w/<slug>/ works on a slug host');
    assert.equal((await s.at('weave.test')('GET', '/w/acme/api/workspace')).json().name, 'acme');
    const id = s.main.state.meta.id;
    assert.equal((await acme('GET', `/w/${id}/api/workspace`)).json().name, 'Net', '/w/<id>/ too');

    const missing = await s.at('nosuch.weave.test')('GET', '/api/workspace');
    assert.equal(missing.status, 404);
    assert.ok(!/nosuch|acme|Net/i.test(missing.text), `a 404 names no workspace: ${missing.text}`);
    assert.equal((await s.at('nosuch.weave.test')('GET', '/')).status, 404);
    assert.equal((await s.at(`${id}.weave.test`)('GET', '/api/workspace')).status, 404, 'a host answers to a slug, never an id');
    assert.equal((await s.at('a.b.weave.test')('GET', '/api/workspace')).status, 421);
    assert.equal((await s.at('evil.example')('GET', '/api/workspace')).status, 421);
    const listed = (await s.at('weave.test')('GET', '/api/workspaces')).json();
    assert.equal(listed.find((x) => x.name === 'acme').host, 'http://acme.weave.test/', 'each workspace names its canonical host');
    const shell = await s.at('weave.test')('GET', '/w/acme/');
    assert.match(shell.text, /<meta property="og:url" content="http:\/\/acme\.weave\.test\/">/, 'the canonical URL is the workspace host');
    assert.equal((await s.at('nosuch.weave.test')('GET', '/api/health')).status, 404, 'an unknown slug answers nothing, health included');
  } finally { s.stop(); }
});

test('host routing: a bare /e/ link on a host that does not hold the row moves to the host that does', async () => {
  const s = await serveHub();
  try {
    assert.equal((await s.at('weave.test')('POST', '/api/workspaces', { body: { name: 'Acme' } })).status, 201);
    const acme = s.at('acme.weave.test');
    assert.equal((await acme('POST', '/api/spaces', { body: { name: 'Ops' } })).status, 201);
    assert.equal((await acme('POST', '/api/tables', { body: { space: 'Ops', name: 'Task' } })).status, 201);
    const made = await acme('POST', '/api/tables/Task/entities', { body: { values: { Name: 'over there' } } });
    assert.equal(made.status, 201, made.text);
    const row = made.json();
    assert.equal(row.url, `/e/${row.id}`, 'the host names the workspace, so the link carries none');

    const moved = await s.at('net.weave.test')('GET', `/e/${row.id}`);
    assert.equal(moved.status, 301);
    assert.equal(moved.headers.location, `http://acme.weave.test/e/${row.id}`, 'the row\'s own host, same path');
    assert.equal((await acme('GET', `/e/${row.id}`)).status, 200, 'its own host serves it');
  } finally { s.stop(); }
});

test('host routing: with no base domain a slug host is refused as before', async () => {
  const s = await serveHub({ baseDomain: null });
  try {
    assert.equal((await s.at('net.weave.test')('GET', '/api/workspace')).status, 421);
    assert.equal((await s.at('127.0.0.1')('GET', '/api/workspace')).json().name, 'Net');
  } finally { s.stop(); }
});

test('slugs over HTTP: create and rename refuse reserved names; a rename leaves a 301 alias that nobody else can claim', async () => {
  const s = await serveHub();
  const apex = s.at('weave.test');
  try {
    assert.equal((await apex('POST', '/api/workspaces', { body: { name: 'api' } })).status, 400);
    assert.equal((await apex('POST', '/api/workspaces', { body: { name: 'Ops_Hub' } })).json().name, 'ops-hub');
    assert.equal((await apex('POST', '/api/workspaces', { body: { name: 'acme' } })).status, 201);
    assert.equal((await apex('PATCH', '/w/acme/api/workspace', { body: { name: 'www' } })).status, 400);

    const renamed = await apex('PATCH', '/w/acme/api/workspace', { body: { name: 'Acme Two' } });
    assert.equal(renamed.json().name, 'acme-two');
    const moved = await s.at('acme.weave.test')('GET', '/api/spaces?x=1');
    assert.equal(moved.status, 301);
    assert.equal(moved.headers.location, 'http://acme-two.weave.test/api/spaces?x=1');
    assert.equal((await s.at('acme-two.weave.test')('GET', '/api/workspace')).json().name, 'acme-two');

    assert.equal((await apex('POST', '/api/workspaces', { body: { name: 'acme' } })).status, 409, 'a released slug stays held');
    assert.equal((await apex('PATCH', '/w/ops-hub/api/workspace', { body: { name: 'acme' } })).status, 409);
    assert.equal((await apex('PATCH', '/w/acme-two/api/workspace', { body: { name: 'acme' } })).json().name, 'acme', 'the holder may take its old slug back');
    assert.equal((await s.at('acme.weave.test')('GET', '/api/workspace')).json().name, 'acme');
    assert.equal((await s.at('acme-two.weave.test')('GET', '/api/workspace')).status, 301);
  } finally { s.stop(); }
});

test('engine: a rename keeps the old slug as an alias across a reopen', () => {
  const dir = tempDir('weave-hosts-');
  try {
    const path = join(dir, 'acme.db');
    const w = new Weave({ path, name: 'acme' });
    w.updateWorkspace({ name: 'beta' });
    w.updateWorkspace({ name: 'gamma' });
    assert.throws(() => w.updateWorkspace({ name: 'docs' }), /reserved/);
    w.store.close?.();
    const again = new Weave({ path });
    assert.deepEqual([again.state.meta.name, again.state.meta.aliases], ['gamma', ['acme', 'beta']]);
    again.store.close?.();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

async function serveSignIn() {
  const idp = await startIdp();
  const oidc = createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' });
  const ids = {};
  const before = (dir) => {
    for (const name of ['acme', 'other']) {
      const ws = new Weave({ path: join(dir, `${name}.db`), name });
      ids[name] = ws.state.meta.id;
      ws.state.meta.name = name;
      ws.createAccount({ name: 'kyle', role: 'writer' });
      if (name === 'acme') ws.redeemIdentityInvite(ws.linkIdentity('kyle', { issuer: idp.issuer }).code, { issuer: idp.issuer, subject: 'user_kyle' });
      ws.setRequireAuth(true);
      ws.save();
      ws.store.close?.();
    }
  };
  const s = await serveHub({ oidc, origin: 'http://weave.test', before });
  return { ...s, idp, ids, stop: () => { s.stop(); idp.stop(); } };
}

const follow = async (s, location, opts) => {
  const u = new URL(location);
  return s.at(u.host)('GET', u.pathname + u.search, opts);
};
const cookieOf = (res, name) => [res.headers['set-cookie'] ?? []].flat().find((c) => c.startsWith(`${name}=`));

test('central sign-in: a slug host signs in at the apex and gets back a single-use code for its own host-only cookie', async () => {
  const s = await serveSignIn();
  const acme = s.at('acme.weave.test');
  try {
    assert.equal((await acme('GET', '/api/spaces')).status, 401);
    const wall = await acme('GET', '/');
    assert.equal(wall.status, 302);
    const auth = await acme('GET', wall.headers.location);
    assert.equal(auth.status, 302);
    const start = await acme('GET', auth.headers.location);
    assert.equal(start.status, 302);
    const toApex = new URL(start.headers.location);
    assert.equal(toApex.host, 'weave.test', 'sign-in starts at the apex');
    assert.equal(toApex.searchParams.get('handoff'), 'acme');

    const apexStart = await follow(s, start.headers.location);
    const authorize = apexStart.headers.location;
    assert.equal(new URL(authorize).searchParams.get('redirect_uri'), 'http://weave.test/api/auth/oidc/callback', 'the one redirect URI the provider holds');
    const trip = cookieOf(apexStart, 'wv_oidc').split(';')[0];
    const back = s.idp.approve(authorize, { sub: 'user_kyle' });
    const callback = await follow(s, back.href, { cookie: trip });
    assert.equal(callback.status, 302);
    const apexCookies = [callback.headers['set-cookie'] ?? []].flat();
    assert.deepEqual(apexCookies.filter((c) => c.startsWith('wv_session')), [], 'the apex sets no session for a slug host');
    assert.deepEqual(apexCookies.map((c) => c.split('=')[0]).sort(), ['wv_rail', 'wv_start'], 'only the start and rail cookies that find my workspaces keeps');
    const handoff = new URL(callback.headers.location);
    assert.equal(handoff.host, 'acme.weave.test');
    assert.equal(handoff.pathname, '/api/auth/handoff');
    const code = handoff.searchParams.get('code');
    assert.ok(code.length >= 32);

    const landed = await follow(s, handoff.href);
    assert.equal(landed.status, 302);
    assert.equal(landed.headers.location, '/');
    const session = cookieOf(landed, `wv_session_`) ?? [landed.headers['set-cookie']].flat()[0];
    assert.match(session, /^wv_session_[0-9a-f-]+=[\w-]{40,}; HttpOnly; SameSite=Lax; Path=\//);
    assert.ok(!/Domain=/i.test(session), 'host-only: no Domain attribute');
    const cookie = session.split(';')[0];
    assert.equal((await acme('GET', '/api/spaces', { cookie })).status, 200);
    assert.equal((await acme('GET', '/api/auth/me', { cookie })).json().account.name, 'kyle');

    assert.equal((await follow(s, handoff.href)).status, 400, 'single use');
    assert.equal((await acme('GET', '/api/auth/handoff?code=made-up')).status, 400);
  } finally { s.stop(); }
});

test('central sign-in: a code answers only on its own host and only for 60 seconds; a stranger is refused at the apex', async () => {
  const s = await serveSignIn();
  try {
    const codeFor = async (claims) => {
      const start = await s.at('acme.weave.test')('GET', '/api/auth/oidc/start?next=%2F%23%2Fx');
      const apexStart = await follow(s, start.headers.location);
      const back = s.idp.approve(apexStart.headers.location, claims);
      return follow(s, back.href, { cookie: cookieOf(apexStart, 'wv_oidc').split(';')[0] });
    };
    const first = new URL((await codeFor({ sub: 'user_kyle' })).headers.location);
    assert.equal((await s.at('other.weave.test')('GET', first.pathname + first.search)).status, 400, 'another host cannot redeem it');
    assert.equal((await follow(s, first.href)).status, 400, 'and the try spent it');

    mock.timers.enable({ apis: ['Date'], now: Date.now() });
    try {
      const late = new URL((await codeFor({ sub: 'user_kyle' })).headers.location);
      mock.timers.tick(61_000);
      assert.equal((await follow(s, late.href)).status, 400, 'expired after 60 s');
    } finally { mock.timers.reset(); }

    const fine = new URL((await codeFor({ sub: 'user_kyle' })).headers.location);
    const landed = await follow(s, fine.href);
    assert.equal(landed.headers.location, '/#/x', 'next comes back with the code');

    const stranger = await codeFor({ sub: 'user_x' });
    assert.equal(stranger.status, 403, 'an identity with no account is refused as today');
    assert.match(stranger.text, /No access to acme/);

    const bogus = await s.at('weave.test')('GET', '/w/acme/api/auth/oidc/start?handoff=evil');
    assert.equal(bogus.status, 400, 'a handoff names a workspace host, nothing else');
  } finally { s.stop(); }
});

const signIn = async (s, host, sub = 'user_kyle') => {
  const start = await s.at(host)('GET', '/api/auth/oidc/start');
  const apexStart = await follow(s, start.headers.location);
  const back = s.idp.approve(apexStart.headers.location, { sub });
  const handoff = await follow(s, back.href, { cookie: cookieOf(apexStart, 'wv_oidc').split(';')[0] });
  return sessionOf(await follow(s, handoff.headers.location));
};
const sessionOf = (res) => [res.headers['set-cookie'] ?? []].flat().find((c) => c.startsWith('wv_session_'))?.split(';')[0];

test('rail hop: a session on one workspace host hands itself to another workspace host it opens (Issue #1263)', async () => {
  const s = await serveSignIn();
  try {
    s.main.createAccount({ name: 'kyle', role: 'writer' });
    s.main.redeemIdentityInvite(s.main.linkIdentity('kyle', { issuer: s.idp.issuer }).code, { issuer: s.idp.issuer, subject: 'user_kyle' });
    s.main.save();
    const net = s.at('net.weave.test');
    const acme = s.at('acme.weave.test');
    const cookie = await signIn(s, 'net.weave.test');
    const listed = (await net('GET', '/api/workspaces', { cookie })).json().find((w) => w.name === 'acme');
    assert.equal(listed.held, undefined, 'acme opens from the net host, so its chip is not held');
    assert.equal(listed.host, 'http://acme.weave.test/');

    const hop = await net('GET', '/api/auth/open/acme', { cookie });
    assert.equal(hop.status, 302);
    const to = new URL(hop.headers.location);
    assert.equal(to.host, 'acme.weave.test', 'the hop lands on the workspace host');
    assert.equal(to.pathname, '/api/auth/handoff');
    const landed = await follow(s, to.href);
    assert.equal(landed.status, 302);
    assert.equal(landed.headers.location, '/');
    const there = sessionOf(landed);
    assert.ok(there && there !== cookie, 'the acme host gets its own host-only session');
    assert.equal((await acme('GET', '/api/spaces', { cookie: there })).status, 200, 'signed in on the acme host');
    assert.equal((await follow(s, to.href)).status, 400, 'the hop code is single use');

    const cold = await net('GET', '/api/auth/open/acme');
    assert.deepEqual([cold.status, cold.headers.location], [302, 'http://acme.weave.test/'], 'no session: the bare host, which signs in on its own');
    const shut = await net('GET', '/api/auth/open/other', { cookie });
    assert.deepEqual([shut.status, shut.headers.location], [302, 'http://other.weave.test/'], 'a session that does not open other hands nothing over');
    assert.equal((await net('GET', '/api/auth/open/ACME', { cookie })).headers.location.startsWith('http://acme.weave.test/api/auth/handoff?code='), true, 'the slug is case-blind');
    assert.equal((await net('GET', '/api/auth/open/nosuch', { cookie })).status, 404);

    const marked = await follow(s, (await net('GET', '/api/auth/open/acme?trashed=old-pipe', { cookie })).headers.location);
    assert.equal(marked.headers.location, '/?trashed=old-pipe', 'the hop carries the trashed marker to the landing page (Feature #347)');
    const coldMarked = await net('GET', '/api/auth/open/acme?trashed=old-pipe');
    assert.equal(coldMarked.headers.location, 'http://acme.weave.test/?trashed=old-pipe', 'the bare-host hop carries it too');
    const junk = await follow(s, (await net('GET', `/api/auth/open/acme?trashed=${encodeURIComponent('x/../y?z')}`, { cookie })).headers.location);
    assert.equal(junk.headers.location, '/', 'a marker that is not a workspace name is dropped');
  } finally { s.stop(); }
});

test('rail hop: with no base domain there is no hop route', async () => {
  const s = await serveHub({ baseDomain: null });
  try {
    assert.equal((await s.at('127.0.0.1')('GET', '/api/auth/open/Net')).status, 404);
  } finally { s.stop(); }
});

test('host routing: a /w/ page asked on another workspace host moves to that workspace host (Issue #1263)', async () => {
  const s = await serveSignIn();
  try {
    const acme = s.at('acme.weave.test');
    const row = '0b6a3c1e-2f4d-4e8a-9c7b-1d2e3f4a5b6c';
    for (const [method, path, to] of [
      ['GET', '/w/other/', 'http://other.weave.test/'],
      ['HEAD', '/w/other/', 'http://other.weave.test/'],
      ['GET', '/w/other', 'http://other.weave.test/'],
      ['GET', `/w/${s.ids.other}/e/${row}?x=1`, `http://other.weave.test/e/${row}?x=1`],
      ['GET', '/w/Net/', 'http://net.weave.test/'],
    ]) {
      const moved = await acme(method, path);
      assert.deepEqual([moved.status, moved.headers.location], [301, to], `${method} ${path}`);
    }
    for (const [host, path] of [
      ['acme.weave.test', '/w/other/api/workspace'],
      ['acme.weave.test', '/w/other/app.js'],
      ['acme.weave.test', '/w/other/mcp'],
      ['acme.weave.test', '/w/acme/'],
      ['weave.test', '/w/other/'],
    ]) {
      assert.notEqual((await s.at(host)('GET', path)).status, 301, `${host}${path} stays put`);
    }
    assert.notEqual((await acme('POST', '/w/other/api/spaces', { body: { name: 'x' } })).status, 301, 'a write is never moved');
  } finally { s.stop(); }
});

test('host routing: without sign-in configured a /w/ page on another host is served in place as before', async () => {
  const s = await serveHub();
  try {
    assert.equal((await s.at('weave.test')('POST', '/api/workspaces', { body: { name: 'Acme' } })).status, 201);
    assert.equal((await s.at('acme.weave.test')('GET', '/w/Net/')).status, 200);
  } finally { s.stop(); }
});

test('mcp per host: the slug host names itself in the challenge and the protected-resource metadata', async () => {
  const s = await serveSignIn();
  try {
    const acme = s.at('acme.weave.test');
    const meta = await acme('GET', '/.well-known/oauth-protected-resource/mcp');
    assert.equal(meta.status, 200);
    assert.equal(meta.json().resource, 'http://acme.weave.test/mcp');
    const door = await acme('POST', '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    assert.equal(door.status, 401);
    assert.equal(door.headers['www-authenticate'], 'Bearer resource_metadata="http://acme.weave.test/.well-known/oauth-protected-resource/mcp"');
    assert.equal((await s.at('weave.test')('GET', '/.well-known/oauth-protected-resource/mcp')).json().resource, 'http://weave.test/mcp', 'the apex is unchanged');
  } finally { s.stop(); }
});
