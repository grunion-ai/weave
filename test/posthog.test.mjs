import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer, request } from 'node:http';
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer, posthogFromEnv } from '../src/server.js';
import { createOidc } from '../src/oidc.js';
import { PRIVACY } from '../src/legal.js';
import { startIdp, serveOidc } from './lib/idp.mjs';
import '../public/consent.js';
import { tempDir } from './lib/temp.mjs';

const { consentCookie, OPTIONS, BANNER } = globalThis.WeaveConsent;

const hit = (port, method, path, { cookie, body, type, headers = {} } = {}) => new Promise((resolve, reject) => {
  const req = request({
    host: '127.0.0.1', port, method, path,
    headers: { Host: `localhost:${port}`, ...(cookie ? { Cookie: cookie } : {}), ...(type ? { 'Content-Type': type } : {}), ...headers },
  }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) });
    });
  });
  req.on('error', reject);
  req.end(body ?? undefined);
});
const cookieOf = (res, name) => [res.headers['set-cookie'] ?? []].flat().find((c) => c.startsWith(`${name}=`))?.split(';')[0];

async function upstream() {
  const seen = [];
  const server = createHttpServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, type: req.headers['content-type'] ?? null, forwarded: req.headers['x-forwarded-for'] ?? null, cookie: req.headers.cookie ?? null, body: Buffer.concat(chunks) });
      if (req.url.startsWith('/static/')) {
        res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'public, max-age=60' });
        return res.end('window.fake = 1;');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"status":1}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { seen, host: `http://127.0.0.1:${server.address().port}`, stop: () => server.close() };
}

async function serve({ posthog = null } = {}) {
  const idp = await startIdp();
  const oidc = createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' });
  const dir = tempDir('weave-posthog-');
  const main = new Weave({ path: join(dir, 'workspace.db'), name: 'Net' });
  main.state.meta.name = 'Net';
  main.createAccount({ name: 'operator', role: 'architect' });
  main.setRequireAuth(true);
  main.save();
  const { server, port } = await startServer(main, { port: 0, oidc, posthog, openSignup: { on: true, limit: 2 }, limits: { options: 1000, failed: 1000, slugs: 1000 } });
  const signIn = async (claims) => {
    const start = await hit(port, 'GET', '/api/auth/oidc/start?start=1');
    const back = idp.approve(start.headers.location, claims);
    const res = await hit(port, 'GET', back.pathname + back.search, { cookie: cookieOf(start, 'wv_oidc') });
    return cookieOf(res, 'wv_start');
  };
  return { port, signIn, stop: () => { server.close(); idp.stop(); rmSync(dir, { recursive: true, force: true }); } };
}

test('posthogFromEnv reads POSTHOG_KEY and POSTHOG_HOST at runtime and refuses anything but a phc_ key', () => {
  assert.equal(posthogFromEnv({}), null);
  assert.equal(posthogFromEnv({ POSTHOG_KEY: '  ' }), null);
  assert.equal(posthogFromEnv({ POSTHOG_KEY: 'sk_live_nope' }), null);
  assert.deepEqual(posthogFromEnv({ POSTHOG_KEY: ' phc_test ' }), { key: 'phc_test', host: 'https://us.i.posthog.com', assets: 'https://us-assets.i.posthog.com' });
  assert.deepEqual(posthogFromEnv({ POSTHOG_KEY: 'phc_test', POSTHOG_HOST: 'https://eu.i.posthog.com/' }), { key: 'phc_test', host: 'https://eu.i.posthog.com', assets: 'https://eu-assets.i.posthog.com' });
  assert.deepEqual(posthogFromEnv({ POSTHOG_KEY: 'phc_test', POSTHOG_HOST: 'http://127.0.0.1:9' }), { key: 'phc_test', host: 'http://127.0.0.1:9', assets: 'http://127.0.0.1:9' });
});

test('with no key: /ingest is 404, the boot payloads carry no analytics and the pages load no consent script', async () => {
  const s = await serve();
  try {
    assert.equal((await hit(s.port, 'POST', '/ingest/e/', { body: '{}', type: 'application/json' })).status, 404);
    for (const path of ['/ingest/static/array.js', '/ingest']) assert.equal((await hit(s.port, 'GET', path)).status, 404, path);
    const anon = (await hit(s.port, 'GET', '/api/start')).json();
    assert.equal(anon.analytics, undefined);
    const cookie = await s.signIn({ sub: 'user_nokey', email: 'nokey@example.com', email_verified: true });
    const me = (await hit(s.port, 'GET', '/api/start', { cookie })).json();
    assert.equal(me.signedIn, true);
    assert.equal(me.analytics, undefined);
    const start = (await hit(s.port, 'GET', '/start')).text;
    assert.doesNotMatch(start, /phc_|posthog/i);
    const auth = await hit(s.port, 'GET', '/auth?signed-out=1');
    assert.equal(auth.status, 200);
    assert.doesNotMatch(auth.text, /consent\.js|data-consent-open|phc_/);
  } finally { s.stop(); }
});

test('with a key: /api/start carries the key, and the Clerk user id once signed in, never the email', async () => {
  const up = await upstream();
  const s = await serve({ posthog: { key: 'phc_test', host: up.host, assets: up.host } });
  try {
    const anon = (await hit(s.port, 'GET', '/api/start')).json();
    assert.deepEqual(anon.analytics, { key: 'phc_test' });
    const cookie = await s.signIn({ sub: 'user_clerk_1', email: 'ada@example.com', email_verified: true });
    const me = (await hit(s.port, 'GET', '/api/start', { cookie })).json();
    assert.deepEqual(me.analytics, { key: 'phc_test', user: 'user_clerk_1' });
    assert.doesNotMatch(JSON.stringify(me.analytics), /ada@example\.com/);
    const auth = await hit(s.port, 'GET', '/auth?signed-out=1');
    assert.match(auth.text, /<script src="\/consent\.js[^"]*" data-posthog-key="phc_test"><\/script>/);
    assert.match(auth.text, /<a href="\/privacy#cookies" data-consent-open>Cookies<\/a>/);
    assert.equal(up.seen.length, 0, 'serving pages sends nothing to PostHog');
  } finally { s.stop(); up.stop(); }
});

test('with a key: /ingest is an open door that forwards to PostHog, static and array paths to the assets host', async () => {
  const up = await upstream();
  const assets = await upstream();
  const s = await serve({ posthog: { key: 'phc_test', host: up.host, assets: assets.host } });
  try {
    const body = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xff, 0x01]);
    const res = await hit(s.port, 'POST', '/ingest/e/?compression=gzip-js&ver=1.0', { body, type: 'text/plain', cookie: 'wv_start=secret; grunion_consent=granted' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), { status: 1 });
    const sent = up.seen.at(-1);
    assert.equal(sent.method, 'POST');
    assert.equal(sent.url, '/e/?compression=gzip-js&ver=1.0');
    assert.equal(sent.type, 'text/plain');
    assert.deepEqual([...sent.body], [...body], 'the body goes through byte for byte');
    assert.equal(sent.cookie, null, 'weave cookies never leave for PostHog');
    assert.ok(sent.forwarded, 'the client address rides X-Forwarded-For');
    const flags = await hit(s.port, 'GET', '/ingest/flags/?v=2');
    assert.equal(flags.status, 200);
    assert.equal(up.seen.at(-1).url, '/flags/?v=2');
    const script = await hit(s.port, 'GET', '/ingest/static/array.js');
    assert.equal(script.status, 200);
    assert.equal(script.text, 'window.fake = 1;');
    assert.match(script.headers['content-type'], /javascript/);
    assert.equal(assets.seen.at(-1).url, '/static/array.js');
    await hit(s.port, 'GET', '/ingest/array/phc_test/config.js');
    assert.equal(assets.seen.at(-1).url, '/array/phc_test/config.js');
    assert.equal(up.seen.filter((r) => r.url.startsWith('/static/')).length, 0);
  } finally { s.stop(); up.stop(); assets.stop(); }
});

test('/ingest answers 502 when PostHog does not answer', async () => {
  const s = await serve({ posthog: { key: 'phc_test', host: 'http://127.0.0.1:9', assets: 'http://127.0.0.1:9' } });
  try {
    const res = await hit(s.port, 'POST', '/ingest/e/', { body: '{}', type: 'application/json' });
    assert.equal(res.status, 502);
  } finally { s.stop(); }
});

test('the consent cookie spans .grunion.ai on grunion hosts and stays host-only elsewhere', () => {
  for (const hostname of ['grunion.ai', 'weave.grunion.ai', 'acme.weave.grunion.ai']) {
    assert.equal(consentCookie('granted', { hostname, https: true }), 'grunion_consent=granted; Path=/; Max-Age=31536000; SameSite=Lax; Domain=.grunion.ai; Secure');
  }
  assert.equal(consentCookie('denied', { hostname: 'localhost', https: false }), 'grunion_consent=denied; Path=/; Max-Age=31536000; SameSite=Lax');
  assert.equal(consentCookie('denied', { hostname: 'weave.example.com', https: true }), 'grunion_consent=denied; Path=/; Max-Age=31536000; SameSite=Lax; Secure');
  assert.equal(consentCookie('granted', { hostname: 'notgrunion.ai', https: true }), 'grunion_consent=granted; Path=/; Max-Age=31536000; SameSite=Lax; Secure');
});

test('PostHog runs with the shared contract settings and the banner says what it records', () => {
  assert.deepEqual(OPTIONS, {
    api_host: '/ingest',
    ui_host: 'https://us.posthog.com',
    persistence: 'localStorage+cookie',
    cross_subdomain_cookie: true,
    disable_session_recording: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    autocapture: false,
    capture_pageview: true,
    capture_pageleave: false,
    opt_out_capturing_by_default: true,
  });
  assert.ok(!('cookieless_mode' in OPTIONS), 'no cookieless mode: nothing runs without consent');
  assert.equal(BANNER, 'If you accept, PostHog records pages viewed, calls to action clicked, the link that brought you here and how far you get in weave setup. One cookie choice covers grunion.ai and weave.grunion.ai.');
});

test('no PostHog project key sits in source', () => {
  const root = join(import.meta.dirname, '..');
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    if (['node_modules', 'vendor', '.git'].includes(name)) return [];
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
  const files = ['src', 'public', 'bin', 'scripts', 'test', 'docs'].flatMap((d) => walk(join(root, d))).filter((f) => /\.(m?js|html|json|md|css)$/.test(f));
  for (const file of files) assert.doesNotMatch(readFileSync(file, 'utf8'), /phc_(?!test\b)[A-Za-z0-9]{20,}/, file);
});

test('the privacy policy names PostHog, links its cookies section and carries no em dash', async () => {
  assert.match(PRIVACY, /\*Effective date: 2026-10-16\*/);
  assert.match(PRIVACY, /\* \*\*PostHog\*\* \(PostHog Inc\., US\) provides product analytics, only with your consent/);
  assert.match(PRIVACY, /We use PostHog Cloud \(US region\) for product analytics, and we load it only after you click Accept/);
  assert.match(PRIVACY, /Signed-in use of the app also records named actions \(creating a workspace, table, row or agent token, using a template, sending or accepting an invite\) and daily return visits, never their content\./);
  assert.ok(!PRIVACY.includes('—'));
  const s = await serve();
  try {
    const html = (await hit(s.port, 'GET', '/privacy')).text;
    assert.match(html, /<h3 id="cookies">Cookies<\/h3>/);
  } finally { s.stop(); }
});

async function appServer(posthog) {
  const idp = await startIdp();
  const dir = tempDir('weave-posthog-app-');
  const w = new Weave({ path: join(dir, 'workspace.db'), name: 'Net' });
  w.createAccount({ name: 'operator', role: 'architect' });
  w.createAccount({ name: 'ada', role: 'editor' });
  w.setRequireAuth(true);
  w.save();
  const s = await serveOidc(w, idp, { posthog });
  const invite = () => w.linkIdentity('ada', { issuer: idp.issuer }).code;
  return { ...s, invite, stop: () => { s.stop(); rmSync(dir, { recursive: true, force: true }); } };
}

test('the app shell loads no consent script and /api/auth/me carries no analytics without a key', async () => {
  const s = await appServer(null);
  try {
    const { res, cookie } = await s.signIn({ sub: 'user_app_nokey', email: 'nokey@example.com', email_verified: true }, { invite: s.invite(), next: '/#/' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/#/', 'no key leaves the redirect alone');
    const page = await s.call('GET', '/', { cookie });
    assert.equal(page.status, 200);
    const shell = await page.text();
    assert.match(shell, /\/app\.js/);
    assert.doesNotMatch(shell, /consent\.js|data-posthog-key|phc_/);
    const me = await (await s.call('GET', '/api/auth/me', { cookie })).json();
    assert.equal(me.account.name, 'ada');
    assert.equal(me.analytics, undefined);
  } finally { s.stop(); }
});

test('with a key the app shell loads consent.js before app.js, and /api/auth/me names the Clerk user id alone', async () => {
  const s = await appServer({ key: 'phc_test', host: 'http://127.0.0.1:9', assets: 'http://127.0.0.1:9' });
  try {
    const { res, cookie } = await s.signIn({ sub: 'user_app_1', email: 'ada@example.com', email_verified: true }, { invite: s.invite(), next: '/#/table/x' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/?joined=invite#/table/x', 'an accepted invite link tells the app it was accepted');
    const page = await s.call('GET', '/', { cookie });
    assert.equal(page.status, 200);
    const shell = await page.text();
    const tag = shell.match(/<script src="\/consent\.js[^"]*" data-posthog-key="phc_test" defer><\/script>/);
    assert.ok(tag, 'the shell carries the consent script with the key');
    assert.ok(tag.index < shell.indexOf('/app.js'), 'consent.js runs before app.js');
    assert.ok(shell.indexOf('/usage-core.js') < shell.indexOf('/app.js'));
    assert.equal(shell.match(/data-posthog-key/g).length, 1);
    const me = await (await s.call('GET', '/api/auth/me', { cookie })).json();
    assert.deepEqual(me.analytics, { user: 'user_app_1' });
    assert.doesNotMatch(JSON.stringify(me.analytics), /ada@example\.com/);
    const again = await s.signIn({ sub: 'user_app_1', email: 'ada@example.com', email_verified: true }, { next: '/?view=a#/x' });
    assert.equal(again.res.headers.get('location'), '/?view=a#/x', 'a plain sign-in is not an invite');
  } finally { s.stop(); }
});
