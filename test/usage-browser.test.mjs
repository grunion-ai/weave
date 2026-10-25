import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { createOidc } from '../src/oidc.js';
import { startIdp } from './lib/idp.mjs';
import { launch } from './lib/browser.mjs';
import { tempDir } from './lib/temp.mjs';

const FAKE = `window.__ph = window.__ph || [];
window.posthog = {
  init(key, options) { window.__ph.push(['init', key, options]); },
  capture(name, props) { window.__ph.push(['capture', name, props]); },
  identify(...args) { window.__ph.push(['identify', ...args]); },
  opt_in_capturing() { window.__ph.push(['opt_in']); },
  opt_out_capturing() { window.__ph.push(['opt_out']); },
};`;

async function fakePosthog() {
  const server = createHttpServer((req, res) => {
    if (req.url.startsWith('/static/array.js')) {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      return res.end(FAKE);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"status":1}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const host = `http://127.0.0.1:${server.address().port}`;
  return { host, stop: () => server.close() };
}

const ph = await fakePosthog();
const posthog = { key: 'phc_test', host: ph.host, assets: ph.host };
const seed = (w) => {
  w.createSpace({ name: 'Sales' });
  const deal = w.createTable({ space: 'Sales', name: 'Deal' });
  for (const name of ['Deal one', 'Deal two', 'Deal three']) w.createEntity(deal, { name });
  return { deal };
};
const open = await launch('in-app usage events, with a key', seed, { server: () => ({ posthog }) });
const bare = open && await launch('in-app usage events, without a key', seed, { server: () => ({}) });

async function signedHub() {
  const idp = await startIdp();
  const dir = tempDir('weave-usage-');
  const oidc = createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' });
  const acme = new Weave({ path: join(dir, 'acme.db'), name: 'acme' });
  acme.createAccount({ name: 'owner', role: 'architect' });
  acme.setRequireAuth(true);
  acme.inviteMember({ email: 'joiner@example.com', role: 'editor', issuer: idp.issuer });
  let link = null;
  const s = await launch('in-app usage events, signed in', (main) => {
    main.state.meta.name = 'Net';
    main.createAccount({ name: 'operator', role: 'architect' });
    main.createAccount({ name: 'ada', role: 'editor' });
    main.setRequireAuth(true);
    main.save();
    link = main.linkIdentity('ada', { issuer: idp.issuer }).code;
  }, {
    weave: () => new Weave({ path: join(dir, 'workspace.db'), name: 'Net' }),
    server: () => ({ oidc, posthog, workspaces: { acme }, openSignup: { on: true, limit: 3 }, limits: { options: 1000, failed: 1000, slugs: 1000 } }),
  });
  const stop = () => { idp.stop(); rmSync(dir, { recursive: true, force: true }); };
  if (!s) { stop(); return null; }
  return { idp, link, base: s.base.replace('127.0.0.1', 'localhost'), browser: s.browser, stop };
}
const signed = open && await signedHub();

if (open) {
  test.after(() => { signed?.stop(); ph.stop(); });

  const page = async (h, { granted = false, theme = 'light' } = {}) => {
    const ctx = await h.browser.newContext({ reducedMotion: 'reduce', colorScheme: theme, viewport: { width: 1280, height: 860 } });
    if (granted) await ctx.addCookies([{ name: 'grunion_consent', value: 'granted', url: h.base }]);
    const p = await ctx.newPage();
    p.on('pageerror', (err) => { throw err; });
    const ingest = [];
    p.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/ingest')) ingest.push(r.url()); });
    return { p, ctx, ingest };
  };
  const calls = (p) => p.evaluate(() => window.__ph ?? null);
  const captured = async (p) => ((await calls(p)) ?? []).filter((c) => c[0] === 'capture').map((c) => [c[1], c[2] ?? null]);
  const named = async (p, name) => (await captured(p)).filter(([n]) => n === name);
  const waitFor = (p, name) => p.waitForFunction((n) => window.__ph?.some((c) => c[0] === 'capture' && c[1] === n), name);
  const grid = async (p, h) => {
    await p.goto(`${h.base}/#/table/${h.deal.id}`);
    await p.waitForSelector('.wv-grid tbody tr.entity-row');
  };
  const banner = '.wv-consent';
  const cookiesRow = (p) => p.locator('.nav-personal-menu').getByText('Cookies', { exact: true });
  const openMenu = async (p) => {
    await p.click('.nav-identity-more');
    await p.waitForSelector('.nav-personal-menu');
  };

  test('no key: the app loads no consent script, no banner, no PostHog and no Cookies row, and creates send nothing', async () => {
    const { p, ctx, ingest } = await page(bare);
    await grid(p, bare);
    await p.waitForLoadState('networkidle');
    assert.equal(await p.evaluate(() => typeof globalThis.WeaveConsent), 'undefined');
    assert.equal(await p.evaluate(() => typeof window.posthog), 'undefined');
    assert.equal(await p.locator(banner).count(), 0);
    await p.evaluate((id) => api('POST', `/tables/${id}/entities`, { name: 'No key row' }), bare.deal.id);
    await openMenu(p);
    assert.equal(await cookiesRow(p).count(), 0);
    assert.deepEqual(ingest, []);
    assert.equal(await p.evaluate(() => localStorage.getItem('weave-app-opened')), null);
    assert.equal((await ctx.cookies()).some((c) => c.name.startsWith('ph_') || c.name === 'grunion_consent'), false);
    await ctx.close();
  });

  test('a key and no choice yet: the app shows the banner and captures nothing, and stores no day', async () => {
    const { p, ctx, ingest } = await page(open);
    await grid(p, open);
    await p.waitForSelector(banner);
    assert.deepEqual(await p.locator(`${banner} button`).allTextContents(), ['Decline', 'Accept']);
    await p.evaluate((id) => api('POST', `/tables/${id}/entities`, { name: 'Undecided row' }), open.deal.id);
    await p.evaluate(() => api('POST', '/tables', { space: 'Sales', name: 'Undecided' }));
    await p.waitForLoadState('networkidle');
    assert.equal(await p.evaluate(() => typeof window.posthog), 'undefined');
    assert.deepEqual(ingest, [], 'nothing reaches /ingest before Accept');
    assert.equal(await p.evaluate(() => localStorage.getItem('weave-app-opened')), null, 'no day is stored before consent');
    assert.equal((await ctx.cookies()).some((c) => c.name.startsWith('ph_')), false);
    await ctx.close();
  });

  test('after Accept each milestone fires once with only its allowed props, and a bulk duplicate sends one event', async () => {
    const { p, ctx } = await page(open);
    await grid(p, open);
    await p.waitForSelector(banner);
    await p.click(`${banner} button:has-text("Accept")`);
    await waitFor(p, 'app_opened');
    const [init] = await calls(p);
    assert.equal(init[0], 'init');
    assert.equal(init[2].autocapture, false);
    assert.equal(init[2].disable_session_recording, true);
    assert.equal(init[2].opt_out_capturing_by_default, true);
    assert.equal(init[2].mask_all_text, true);
    assert.ok(!('cookieless_mode' in init[2]));
    assert.deepEqual((await calls(p))[1], ['opt_in']);

    await p.evaluate(() => api('POST', '/tables', { space: 'Sales', name: 'Secret Leads' }));
    await p.evaluate((id) => api('POST', `/tables/${id}/entities`, { name: 'Secret row text', values: {} }), open.deal.id);
    await p.evaluate((id) => api('POST', `/tables/${id}/import.csv`, { csv: 'Name\nImported A\nImported B\nImported C' }), open.deal.id);
    await p.evaluate(() => runStarter(WeaveStarters.TEMPLATES.find((t) => t.id === 'crm')));
    await waitFor(p, 'template_used');
    await grid(p, open);
    const boxes = p.locator('.wv-grid tbody .sel-box');
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await p.locator('.sel-puck .sel-act[aria-label="Duplicate"]').click();
    await waitFor(p, 'rows_duplicated');

    assert.deepEqual(await captured(p), [
      ['app_opened', null],
      ['table_created', null],
      ['row_created', null],
      ['rows_imported', { count: 3 }],
      ['template_used', { source: 'catalog', template: 'crm' }],
      ['rows_duplicated', { count: 2 }],
    ]);
    const sent = JSON.stringify(await calls(p));
    for (const secret of ['Secret Leads', 'Secret row text', 'Imported A', 'Deal one', open.deal.id]) assert.ok(!sent.includes(secret), `PostHog never sees ${secret}`);
    await ctx.close();
  });

  test('app_opened fires once per browser per UTC day', async () => {
    const { p, ctx } = await page(open, { granted: true });
    await grid(p, open);
    await waitFor(p, 'app_opened');
    const day = new Date().toISOString().slice(0, 10);
    assert.equal(await p.evaluate(() => localStorage.getItem('weave-app-opened')), day);
    await p.reload();
    await p.waitForSelector('.wv-grid tbody tr.entity-row');
    await p.waitForFunction(() => window.__ph?.some((c) => c[0] === 'opt_in'));
    await p.waitForLoadState('networkidle');
    assert.deepEqual(await named(p, 'app_opened'), [], 'a second load the same day sends nothing');
    await p.evaluate(() => localStorage.setItem('weave-app-opened', '2000-01-01'));
    await p.reload();
    await waitFor(p, 'app_opened');
    assert.deepEqual(await named(p, 'app_opened'), [['app_opened', null]]);
    await ctx.close();
  });

  test('Decline after Accept, through the Cookies row in the personal menu, stops capture', async () => {
    const { p, ctx } = await page(open, { granted: true, theme: 'dark' });
    await grid(p, open);
    await p.waitForFunction(() => window.__ph?.some((c) => c[0] === 'opt_in'));
    assert.equal(await p.locator(banner).count(), 0, 'a granted choice is not asked again');
    await openMenu(p);
    await cookiesRow(p).click();
    await p.waitForSelector(banner);
    await p.click(`${banner} button:has-text("Decline")`);
    await p.waitForFunction(() => window.__ph?.some((c) => c[0] === 'opt_out'));
    assert.equal((await ctx.cookies()).find((c) => c.name === 'grunion_consent').value, 'denied');
    const before = (await calls(p)).length;
    await p.evaluate((id) => api('POST', `/tables/${id}/entities`, { name: 'After decline' }), open.deal.id);
    await p.evaluate(() => api('POST', '/tables', { space: 'Sales', name: 'After decline' }));
    assert.equal((await calls(p)).length, before, 'nothing is captured once declined');
    await ctx.close();
  });

  if (signed) {
    test('an accepted invite link identifies the Clerk user in the app, sends invite_accepted once, and /auth identifies too', async () => {
      const claims = { sub: 'user_usage_1', email: 'ada@example.com', email_verified: true };
      signed.idp.signInBrowserAs(claims);
      const { p, ctx } = await page(signed, { granted: true });
      await p.goto(`${signed.base}/api/auth/oidc/start?invite=${encodeURIComponent(signed.link)}&next=%2F`);
      await p.waitForSelector('#main');
      await waitFor(p, 'invite_accepted');
      await p.waitForFunction(() => window.__ph?.some((c) => c[0] === 'identify'));
      assert.equal(new URL(p.url()).searchParams.has('joined'), false, 'the marker leaves the address bar');
      assert.deepEqual((await calls(p)).filter((c) => c[0] === 'identify'), [['identify', claims.sub]]);
      assert.deepEqual(await named(p, 'invite_accepted'), [['invite_accepted', { via: 'link' }]]);
      assert.ok(!JSON.stringify(await calls(p)).includes(claims.email));
      await p.reload();
      await p.waitForFunction(() => window.__ph?.some((c) => c[0] === 'identify'));
      assert.deepEqual(await named(p, 'invite_accepted'), [], 'a reload does not accept again');

      await p.goto(`${signed.base}/auth`);
      await p.waitForSelector('#sec-me:not([hidden])');
      await p.waitForFunction(() => window.__ph?.some((c) => c[0] === 'identify'));
      assert.deepEqual((await calls(p)).filter((c) => c[0] === 'identify'), [['identify', claims.sub]], 'the signed-in /auth page identifies');
      await ctx.close();
    });

    test('accepting an invite on /start sends invite_accepted once', async () => {
      signed.idp.signInBrowserAs({ sub: 'user_usage_2', email: 'joiner@example.com', email_verified: true });
      const { p, ctx } = await page(signed, { granted: true });
      await p.goto(`${signed.base}/start`);
      await p.click('main [data-go="signin"]');
      const accept = p.locator('main li.invite button');
      await accept.waitFor();
      await p.waitForFunction(() => window.__ph?.some((c) => c[0] === 'opt_in'));
      await p.evaluate(() => {
        const keep = (c) => sessionStorage.setItem('ph', JSON.stringify([...JSON.parse(sessionStorage.getItem('ph') ?? '[]'), c]));
        const push = window.__ph.push.bind(window.__ph);
        window.__ph.push = (...items) => { items.forEach(keep); return push(...items); };
      });
      await accept.click();
      await p.waitForURL((u) => !u.pathname.startsWith('/start'));
      const kept = JSON.parse(await p.evaluate(() => sessionStorage.getItem('ph')) ?? '[]');
      assert.deepEqual(kept.filter((c) => c[0] === 'capture' && c[1] === 'invite_accepted').map((c) => c[2]), [{ via: 'start' }]);
      await ctx.close();
    });
  }
}
