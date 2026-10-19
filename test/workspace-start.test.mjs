import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { createOidc } from '../src/oidc.js';
import { createBilling, CLERK_API } from '../src/billing.js';
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
const cookieOf = (res, name) => [res.headers['set-cookie'] ?? []].flat().find((c) => c.startsWith(`${name}=`))?.split(';')[0];

async function serve({ limits = { options: 1000, failed: 1000, slugs: 1000 }, rootArchitect = true, billing = null } = {}) {
  const idp = await startIdp();
  const oidc = createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' });
  const dir = mkdtempSync(join(tmpdir(), 'weave-start-'));
  const pin = (w, name, role, subject) => {
    w.createAccount({ name, role });
    w.redeemIdentityInvite(w.linkIdentity(name, { issuer: idp.issuer }).code, { issuer: idp.issuer, subject });
  };
  for (const name of ['acme', 'other', 'weave']) {
    const w = new Weave({ path: join(dir, `${name}.db`), name });
    w.state.meta.name = name;
    if (name === 'acme') pin(w, 'eve', 'editor', 'user_eve');
    if (name === 'other') w.createAccount({ name: 'someone', role: 'architect' });
    if (name !== 'weave') w.setRequireAuth(true);
    w.save();
    w.store.close?.();
  }
  const main = new Weave({ path: join(dir, 'workspace.db'), name: 'Net' });
  main.state.meta.name = 'Net';
  const rootToken = main.createAccount({ name: 'Kyle Adriany', role: rootArchitect ? 'architect' : 'editor' }).token;
  main.redeemIdentityInvite(main.linkIdentity('Kyle Adriany', { issuer: idp.issuer }).code, { issuer: idp.issuer, subject: 'user_kyle' });
  main.setRequireAuth(true);
  main.save();
  const { server, port } = await startServer(main, { port: 0, baseDomain: 'weave.test', origin: 'http://weave.test', oidc, limits, billing });
  const at = (host) => (method, path, opts) => hit(port, host, method, path, opts);
  const apex = at('weave.test');
  const follow = (location, opts) => { const u = new URL(location, 'http://weave.test'); return at(u.host)('GET', u.pathname + u.search, opts); };
  const signInAtStart = async (sub, claims = {}) => {
    const start = await apex('GET', '/api/auth/oidc/start?start=1');
    const back = idp.approve(start.headers.location, { sub, ...claims });
    const res = await follow(back.href, { cookie: cookieOf(start, 'wv_oidc') });
    return { res, cookie: cookieOf(res, 'wv_start') };
  };
  return { dir, main, port, at, apex, follow, signInAtStart, rootToken, idp, stop: () => { server.close(); idp.stop(); rmSync(dir, { recursive: true, force: true }); } };
}

test('reserved: weave and grunion join the list, and the docs workspace keeps answering', async () => {
  for (const s of ['weave', 'grunion']) assert.equal(WeaveSlugs.formState(s), 'reserved', s);
  assert.equal(WeaveSlugs.formState('acme'), null);
  assert.equal(WeaveSlugs.formState('Acme'), 'invalid');
  const s = await serve();
  try {
    const t = s.rootToken;
    assert.equal((await s.apex('GET', '/w/weave/api/workspace')).json().name, 'weave');
    assert.equal((await s.at('weave.weave.test')('GET', '/api/workspace')).json().name, 'weave');
    for (const name of ['weave', 'grunion', 'Grunion']) {
      const made = await s.apex('POST', '/api/workspaces', { token: t, body: { name } });
      assert.equal(made.status, 400, name);
      assert.equal(made.json().code, 'slug_reserved');
      assert.equal(made.json().error, WeaveSlugs.apiMessage('reserved', name.toLowerCase()));
    }
    assert.equal((await s.apex('PATCH', '/api/workspace', { token: t, body: { name: 'weave' } })).json().code, 'slug_reserved');
  } finally { s.stop(); }
});

test('availability: answers available, taken, reserved and invalid, only to a signed-in account, rate limited', async () => {
  const s = await serve({ limits: { options: 1000, failed: 1000, slugs: 6 } });
  try {
    const t = s.rootToken;
    const check = (slug) => s.apex('GET', `/api/workspaces/slug?slug=${encodeURIComponent(slug)}`, { token: t });
    assert.equal((await s.apex('GET', '/api/workspaces/slug?slug=acme')).status, 401, 'signed out learns nothing');
    const states = {};
    for (const slug of ['harbor-launch', 'acme', 'api', 'Not Valid']) states[slug] = (await check(slug)).json();
    assert.deepEqual(Object.fromEntries(Object.entries(states).map(([k, v]) => [k, v.state])), { 'harbor-launch': 'available', acme: 'taken', api: 'reserved', 'Not Valid': 'invalid' });
    assert.equal(states.acme.base, 'weave.test');
    await check('x1');
    await check('x2');
    assert.equal((await check('x3')).status, 429);
  } finally { s.stop(); }
});

test('create: the server re-checks, so a slug lost to a race is slug_taken with the same guidance', async () => {
  const s = await serve();
  try {
    const t = s.rootToken;
    assert.equal((await s.apex('GET', '/api/workspaces/slug?slug=harbor', { token: t })).json().state, 'available');
    assert.equal((await s.apex('POST', '/api/workspaces', { token: t, body: { name: 'Harbor', slug: 'harbor' } })).status, 201);
    const lost = await s.apex('POST', '/api/workspaces', { token: t, body: { name: 'Harbor Two', slug: 'harbor' } });
    assert.equal(lost.status, 409);
    assert.deepEqual(lost.json(), { error: WeaveSlugs.apiMessage('taken', 'harbor'), code: 'slug_taken' });
    const bad = await s.apex('POST', '/api/workspaces', { token: t, body: { name: 'Harbor', slug: 'Har bor' } });
    assert.deepEqual([bad.status, bad.json().code], [400, 'slug_invalid'], 'a given slug is checked as typed, never folded');
    const titled = await s.apex('POST', '/api/workspaces', { token: t, body: { name: 'Design Crew', slug: 'crew' } });
    assert.equal(titled.json().name, 'crew');
    assert.equal((await s.apex('GET', '/w/crew/api/workspace')).status, 401, 'a new workspace on a public origin is walled from the start');
    const crew = new Weave({ path: join(s.dir, 'crew.db') });
    assert.deepEqual([crew.state.meta.title, crew.state.meta.requireAuth], ['Design Crew', true]);
    crew.store.close?.();
    const viaMcp = await s.apex('POST', '/api/mcp', { token: t, body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'weave_workspace', arguments: { action: 'update', name: 'harbor' } } } });
    assert.equal(viaMcp.json().result.isError, true);
    assert.match(viaMcp.json().result.content[0].text, /belongs to another workspace\. Try the name of the person, team, project or mascot/);
  } finally { s.stop(); }
});

test('resume: a signed-in start visit goes straight to the last workspace and its last page (Issue #977)', async () => {
  const s = await serve();
  try {
    const kyle = await s.signInAtStart('user_kyle');
    assert.equal((await s.apex('POST', '/api/start/workspaces', { cookie: kyle.cookie, body: { name: 'Harbor', slug: 'harbor' } })).status, 201);
    await s.follow((await s.apex('GET', '/api/start/open/harbor', { cookie: kyle.cookie })).headers.location);
    const start = await s.apex('GET', '/start', { cookie: kyle.cookie });
    assert.deepEqual([start.status, start.headers.location], [302, '/api/start/open/harbor?to=resume']);
    const open = await s.apex('GET', start.headers.location, { cookie: kyle.cookie });
    assert.equal(new URL(open.headers.location).host, 'harbor.weave.test');
    const landed = await s.follow(open.headers.location);
    assert.deepEqual([landed.status, landed.headers.location], [302, '/#/resume'], 'the workspace app turns the mark into the last page it had open');
    const picked = await s.apex('GET', '/start?pick=1', { cookie: kyle.cookie });
    assert.equal(picked.status, 200, 'the in-app switcher can still ask for the list');
  } finally { s.stop(); }
});

test('resume: a deep link wins over the last workspace (Issue #977)', async () => {
  const s = await serve();
  try {
    const kyle = await s.signInAtStart('user_kyle');
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const moved = await s.apex('GET', `/e/${id}`, { cookie: kyle.cookie });
    assert.deepEqual([moved.status, moved.headers.location], [301, `http://net.weave.test/e/${id}`]);
  } finally { s.stop(); }
});

test('resume: a gone or revoked last workspace falls back to the first one this sign-in opens (Issue #977)', async () => {
  const s = await serve();
  try {
    const other = new Weave({ path: join(s.dir, 'other.db') });
    other.createAccount({ name: 'eve', role: 'editor' });
    other.redeemIdentityInvite(other.linkIdentity('eve', { issuer: s.idp.issuer }).code, { issuer: s.idp.issuer, subject: 'user_eve' });
    other.store.close?.();
    const eve = await s.signInAtStart('user_eve');
    await s.follow((await s.apex('GET', '/api/start/open/other', { cookie: eve.cookie })).headers.location);
    assert.equal((await s.apex('GET', '/start', { cookie: eve.cookie })).headers.location, '/api/start/open/other?to=resume');
    const revoke = new Weave({ path: join(s.dir, 'other.db') });
    revoke.deleteAccount('eve');
    revoke.store.close?.();
    assert.equal((await s.apex('GET', '/start', { cookie: eve.cookie })).headers.location, '/api/start/open/acme?to=resume');
  } finally { s.stop(); }
});

test('resume: a sign-in with no workspaces still gets the start page and its empty state (Issue #977)', async () => {
  const s = await serve();
  try {
    const nobody = await s.signInAtStart('user_nobody');
    const page = await s.apex('GET', '/start', { cookie: nobody.cookie });
    assert.equal(page.status, 200);
    assert.deepEqual((await s.apex('GET', '/api/start', { cookie: nobody.cookie })).json().rows, []);
  } finally { s.stop(); }
});

test('start: the apex shows nothing until sign-in, then lists the workspaces this identity opens', async () => {
  const s = await serve();
  try {
    const root = await s.apex('GET', '/');
    assert.deepEqual([root.status, root.headers.location], [302, '/start'], 'a signed-out apex goes to start');
    const page = await s.apex('GET', '/start');
    assert.equal(page.status, 200);
    assert.ok(!/acme|other|Net\b/.test(page.text), 'the page names no workspace');
    assert.deepEqual((await s.apex('GET', '/api/start')).json(), { signedIn: false, provider: 'Clerk' });
    assert.equal((await s.apex('GET', '/api/start/slug?slug=acme')).status, 401);
    assert.equal((await s.at('acme.weave.test')('GET', '/api/start')).status, 404, 'start lives at the apex only');

    const eve = await s.signInAtStart('user_eve');
    assert.deepEqual([eve.res.status, eve.res.headers.location], [302, '/start']);
    assert.match([eve.res.headers['set-cookie']].flat().join('\n'), /wv_start=[\w-]{40,}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=1800/);
    const list = (await s.apex('GET', '/api/start', { cookie: eve.cookie })).json();
    const acmeId = list.rows[0]?.id;
    assert.match(String(acmeId), /^[0-9a-f-]{36}$/, 'each row carries the workspace id the rail tints its letter tile from');
    assert.deepEqual(list.rows, [{ kind: 'workspace', name: 'acme', id: acmeId, title: 'acme', login: 'eve', host: 'acme.weave.test', role: 'editor', logo: null, seenAt: null, open: '/api/start/open/acme', trial: null }]);
    assert.deepEqual([list.signedIn, list.canCreate, list.accountName, list.base], [true, false, 'eve', 'weave.test']);

    const open = await s.apex('GET', list.rows[0].open, { cookie: eve.cookie });
    assert.equal(open.status, 302);
    const handoff = new URL(open.headers.location);
    assert.equal(handoff.host, 'acme.weave.test');
    const landed = await s.follow(handoff.href);
    const session = cookieOf(landed, [landed.headers['set-cookie']].flat()[0].split('=')[0]);
    assert.equal((await s.at('acme.weave.test')('GET', '/api/spaces', { cookie: session })).status, 200);
    assert.equal((await s.apex('GET', '/api/start/open/other', { cookie: eve.cookie })).status, 403, 'a workspace this identity cannot open');
    assert.equal((await s.apex('POST', '/api/start/workspaces', { cookie: eve.cookie, body: { name: 'Eve', slug: 'eve' } })).status, 403, 'creating needs the right to manage workspaces');

    const nobody = await s.signInAtStart('user_nobody');
    const empty = (await s.apex('GET', '/api/start', { cookie: nobody.cookie })).json();
    assert.deepEqual([empty.rows, empty.canCreate], [[], false], 'with billing off a stranger still cannot create');
    assert.equal((await s.apex('POST', '/api/start/workspaces', { cookie: nobody.cookie, body: { name: 'Mine', slug: 'mine' } })).status, 403);
  } finally { s.stop(); }
});

test('start: rows name host and role, show the logo through the start door, and the last opened sorts first (Issue #964)', async () => {
  const s = await serve();
  try {
    const kyle = await s.signInAtStart('user_kyle');
    for (const [name, slug] of [['Harbor', 'harbor'], ['Dock', 'dock']]) {
      assert.equal((await s.apex('POST', '/api/start/workspaces', { cookie: kyle.cookie, body: { name, slug } })).status, 201);
    }
    const before = (await s.apex('GET', '/api/start', { cookie: kyle.cookie })).json().rows;
    const row = (rows, name) => rows.find((r) => r.name === name);
    assert.deepEqual([row(before, 'harbor').role, row(before, 'harbor').host, row(before, 'harbor').title], ['architect', 'harbor.weave.test', 'Harbor']);
    assert.equal(row(before, 'acme').role, 'architect', 'a hub-root architect opens acme as an architect');
    assert.ok(before.every((r) => r.seenAt === null), 'nothing opened yet');

    const opened = await s.apex('GET', row(before, 'harbor').open, { cookie: kyle.cookie });
    await s.follow(opened.headers.location);
    const after = (await s.apex('GET', '/api/start', { cookie: kyle.cookie })).json().rows;
    assert.equal(after[0].name, 'harbor', 'the workspace opened last leads the list');
    assert.match(after[0].seenAt, /^\d{4}-\d\d-\d\dT/);
    assert.deepEqual(after.slice(1).map((r) => r.name), before.filter((r) => r.name !== 'harbor').map((r) => r.name), 'the rest keep their order');

    const acme = new Weave({ path: join(s.dir, 'acme.db') });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    acme.setWorkspaceLogo({ name: 'logo.png', mime: 'image/png', bytes: png.toString('base64') });
    acme.store.close?.();
    const eve = await s.signInAtStart('user_eve');
    const [acmeRow] = (await s.apex('GET', '/api/start', { cookie: eve.cookie })).json().rows;
    assert.match(acmeRow.logo, /^\/api\/start\/logo\/acme\?v=[0-9a-f]{8}$/);
    const logo = await s.apex('GET', acmeRow.logo, { cookie: eve.cookie });
    assert.deepEqual([logo.status, logo.headers['content-type']], [200, 'image/png']);
    const nobody = await s.signInAtStart('user_nobody');
    assert.equal((await s.apex('GET', acmeRow.logo, { cookie: nobody.cookie })).status, 403, 'only a sign-in that opens the workspace sees its logo');
    assert.equal((await s.apex('GET', acmeRow.logo)).status, 401);
    assert.equal((await s.apex('GET', '/api/start/logo/harbor', { cookie: kyle.cookie })).status, 404, 'no logo, no bytes');
  } finally { s.stop(); }
});

test('apex: a browser at the apex root gets the start page signed in or not, Net moves to its host, /api and /mcp stay', async () => {
  const s = await serve();
  try {
    const t = s.rootToken;
    const kyle = await s.signInAtStart('user_kyle');
    assert.deepEqual([(await s.apex('GET', '/', { cookie: kyle.cookie })).status, (await s.apex('GET', '/', { cookie: kyle.cookie })).headers.location], [302, '/start']);
    assert.match((await s.apex('GET', '/start', { cookie: kyle.cookie })).headers.location, /^\/api\/start\/open\/[^/?]+\?to=resume$/, 'signed in, the start page hands straight on to a workspace');
    assert.equal((await s.apex('GET', '/', { token: t })).headers.location, '/start');
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const moved = await s.apex('GET', `/e/${id}`);
    assert.deepEqual([moved.status, moved.headers.location], [301, `http://net.weave.test/e/${id}`]);
    assert.equal((await s.apex('GET', '/api/workspace', { token: t })).json().name, 'Net', 'the apex API still answers for Net');
    assert.equal((await s.apex('POST', '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })).status, 401, 'and so does its MCP door');
    assert.equal((await s.apex('POST', '/mcp', { token: t, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })).status, 200);
    assert.equal((await s.at('net.weave.test')('GET', '/api/workspace', { token: t })).json().name, 'Net');
    assert.notEqual((await s.at('net.weave.test')('GET', '/')).headers.location, '/start', 'the Net host serves Net, not the start page');
    assert.equal((await s.apex('GET', '/w/weave/api/workspace')).json().name, 'weave', '/w/weave keeps working on the apex');
  } finally { s.stop(); }
});

test('start: an architect creates a workspace from a name and a slug, and becomes its architect', async () => {
  const s = await serve();
  try {
    const { cookie } = await s.signInAtStart('user_kyle');
    const list = (await s.apex('GET', '/api/start', { cookie })).json();
    assert.equal(list.canCreate, true);
    assert.equal(list.accountName, 'Kyle Adriany');
    assert.ok(list.rows.some((r) => r.name === 'Net') && list.rows.some((r) => r.name === 'acme'), 'a hub-root account opens every workspace, as the wall does');
    assert.equal((await s.apex('GET', '/api/start/slug?slug=acme', { cookie })).json().state, 'taken');
    assert.equal((await s.apex('POST', '/api/start/workspaces', { cookie, body: { name: 'Acme', slug: 'acme' } })).json().code, 'slug_taken');
    const made = await s.apex('POST', '/api/start/workspaces', { cookie, body: { name: 'Harbor Launch', slug: 'harbor-launch' } });
    assert.equal(made.status, 201);
    const { name, open, mcp, table, templateError } = made.json();
    assert.deepEqual({ name, open, mcp, table, templateError }, { name: 'harbor-launch', open: '/api/start/open/harbor-launch', mcp: 'http://harbor-launch.weave.test/mcp', table: null, templateError: null });
    const w = new Weave({ path: join(s.dir, 'harbor-launch.db') });
    const owner = w.listAccounts()[0];
    assert.deepEqual([owner.name, Weave.roleName(owner.role), owner.identities[0].subject], ['Kyle Adriany', 'architect', 'user_kyle']);
    assert.equal(w.getWorkspace().title, 'Harbor Launch');
    w.store.close?.();
  } finally { s.stop(); }
});

const clerkAt = (routes) => async (url, init = {}) => {
  const hit = routes[`${init.method ?? 'GET'} ${String(url).slice(CLERK_API.length).split('?')[0]}`];
  const [status, body] = hit ?? [404, { errors: [{ code: 'resource_not_found' }] }];
  return new Response(JSON.stringify(body), { status });
};
const SOLO = [200, { subscription_items: [{ status: 'active', plan: { slug: 'solo' } }] }];

test('start: with billing on, a new person creates a first workspace and is its Observer-only Architect until the solo plan', async () => {
  const routes = {};
  const billing = createBilling({ secretKey: 'clerk-test', soloPlan: 'solo', teamPlan: 'team', trialDays: 0, fetch: clerkAt(routes) });
  const s = await serve({ billing });
  try {
    const dana = await s.signInAtStart('user_dana', { email: 'dana@example.com', email_verified: true });
    const list = (await s.apex('GET', '/api/start', { cookie: dana.cookie })).json();
    assert.deepEqual([list.rows, list.canCreate, list.accountName], [[], true, 'dana']);
    const made = await s.apex('POST', '/api/start/workspaces', { cookie: dana.cookie, body: { name: 'Dana Desk', slug: 'dana-desk' } });
    assert.equal(made.status, 201);
    assert.deepEqual([made.json().name, made.json().open], ['dana-desk', '/api/start/open/dana-desk']);
    const w = new Weave({ path: join(s.dir, 'dana-desk.db') });
    const owner = w.listAccounts()[0];
    assert.deepEqual([w.listAccounts().length, owner.name, Weave.roleName(owner.role), owner.identities[0].subject], [1, 'dana', 'architect', 'user_dana']);
    w.store.close?.();

    const listed = (await s.apex('GET', '/api/start', { cookie: dana.cookie })).json();
    assert.deepEqual(listed.rows.map((r) => r.name), ['dana-desk']);
    const landed = await s.follow((await s.apex('GET', listed.rows[0].open, { cookie: dana.cookie })).headers.location);
    const session = cookieOf(landed, [landed.headers['set-cookie']].flat()[0].split('=')[0]);
    const desk = s.at('dana-desk.weave.test');
    assert.equal((await desk('GET', '/api/spaces', { cookie: session })).status, 200, 'reading is free');
    const unpaid = await desk('POST', '/api/spaces', { cookie: session, body: { name: 'Plans' } });
    assert.deepEqual([unpaid.status, unpaid.json().code], [402, 'seat-required'], 'no solo plan yet, so the Architect works as an Observer');

    const waiting = await s.apex('POST', '/api/start/workspaces', { cookie: dana.cookie, body: { name: 'Second', slug: 'dana-two' } });
    assert.deepEqual([waiting.status, waiting.json().code, waiting.json().waiting], [402, 'plan-required', 'dana-desk'], 'one unpaid workspace per identity');
    routes['GET /users/user_dana/billing/subscription'] = [500, {}];
    billing.forget();
    const down = await s.apex('POST', '/api/start/workspaces', { cookie: dana.cookie, body: { name: 'Second', slug: 'dana-two' } });
    assert.deepEqual([down.status, down.json().code], [503, 'billing-unavailable'], 'Clerk down never grants a free create');

    routes['GET /users/user_dana/billing/subscription'] = SOLO;
    billing.forget();
    assert.equal((await desk('POST', '/api/spaces', { cookie: session, body: { name: 'Plans' } })).status, 201, 'the solo plan seats the Architect');
    assert.equal((await s.apex('POST', '/api/start/workspaces', { cookie: dana.cookie, body: { name: 'Second', slug: 'dana-two' } })).status, 201, 'with the first workspace paid, another may start');

    const kyle = await s.signInAtStart('user_kyle');
    for (const slug of ['kyle-one', 'kyle-two']) assert.equal((await s.apex('POST', '/api/start/workspaces', { cookie: kyle.cookie, body: { name: slug, slug } })).status, 201, 'a hub-root architect is not held to the limit');
  } finally { s.stop(); }
});

test('start: the page and the in-app form read their words from slug-core, the one copy file', () => {
  const html = readFileSync(new URL('../public/start.html', import.meta.url), 'utf8');
  assert.match(html, /<script src="\/slug-core\.js"><\/script>/);
  assert.match(html, /<script src="\/slug-form\.js"><\/script>/);
  const form = readFileSync(new URL('../public/slug-form.js', import.meta.url), 'utf8');
  for (const line of [WeaveSlugs.COPY.taken, WeaveSlugs.COPY.chipLead, WeaveSlugs.COPY.submit]) assert.ok(!form.includes(line), `slug-form.js repeats copy: ${line}`);
  const index = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.ok(index.indexOf('/slug-form.js') > -1 && index.indexOf('/slug-form.js') < index.indexOf('/app.js'));
});
