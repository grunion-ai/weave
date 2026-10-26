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
  const seen = [];
  const server = createHttpServer((req, res) => {
    seen.push(req.url);
    if (req.url.startsWith('/static/array.js')) {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      return res.end(FAKE);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"status":1}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const host = `http://127.0.0.1:${server.address().port}`;
  return { seen, host, stop: () => server.close() };
}

async function hub(posthog) {
  const idp = await startIdp();
  const dir = tempDir('weave-posthog-flows-');
  const oidc = createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' });
  const s = await launch(`posthog funnel, ${posthog ? 'with' : 'without'} a key`, (main) => {
    main.state.meta.name = 'Net';
    main.createAccount({ name: 'operator', role: 'architect' });
    main.setRequireAuth(true);
    main.save();
  }, {
    weave: () => new Weave({ path: join(dir, 'workspace.db'), name: 'Net' }),
    server: () => ({ oidc, posthog, openSignup: { on: true, limit: 3 }, limits: { options: 1000, failed: 1000, slugs: 1000 } }),
  });
  const stop = () => { idp.stop(); rmSync(dir, { recursive: true, force: true }); };
  if (!s) { stop(); return null; }
  return { idp, base: s.base.replace('127.0.0.1', 'localhost'), browser: s.browser, stop };
}

const ph = await fakePosthog();
const keyed = await hub({ key: 'phc_test', host: ph.host, assets: ph.host });
const bare = keyed && await hub(null);

if (keyed) {
  test.after(() => { keyed.stop(); bare.stop(); ph.stop(); });

  let people = 0;
  const person = (h) => {
    people += 1;
    const claims = { sub: `user_ph_${people}`, email: `funnel${people}@example.com`, email_verified: true };
    h.idp.signInBrowserAs(claims);
    return claims;
  };
  const page = async (h, theme = 'light') => {
    const ctx = await h.browser.newContext({ reducedMotion: 'reduce', colorScheme: theme, viewport: { width: 1280, height: 860 } });
    const p = await ctx.newPage();
    p.on('pageerror', (err) => { throw err; });
    const ingest = [];
    p.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/ingest')) ingest.push(r.url()); });
    return { p, ctx, ingest };
  };
  const step = (p, name) => p.waitForSelector(`main[data-step="${name}"]`, { timeout: 15000 });
  const go = (p, what) => p.click(`main [data-go="${what}"]`);
  const calls = (p) => p.evaluate(() => window.__ph ?? null);
  const captured = async (p) => ((await calls(p)) ?? []).filter((c) => c[0] === 'capture').map((c) => [c[1], c[2] ?? null]);
  const consent = async (ctx) => (await ctx.cookies()).find((c) => c.name === 'grunion_consent') ?? null;
  const banner = '.wv-consent';

  test('no key: no banner, no Cookies link, no PostHog script and no /ingest request', async () => {
    const { p, ctx, ingest } = await page(bare);
    await p.goto(`${bare.base}/start`);
    await step(p, 'account');
    await p.waitForLoadState('networkidle');
    assert.equal(await p.locator(banner).count(), 0);
    assert.equal(await p.locator('[data-consent-open]').count(), 0, 'no Cookies link without a key');
    assert.equal(await p.evaluate(() => typeof window.posthog), 'undefined');
    assert.deepEqual(ingest, []);
    assert.equal(await consent(ctx), null);
    await ctx.close();
  });

  test('a key: the banner asks first, nothing loads before Accept, then every step and milestone is captured', async () => {
    const { p, ctx, ingest } = await page(keyed);
    const before = ph.seen.length;
    await p.goto(`${keyed.base}/start`);
    await step(p, 'account');
    await p.waitForSelector(banner);
    await p.waitForLoadState('networkidle');
    assert.equal((await p.locator(`${banner} p`).textContent()).replace(/\s*Privacy$/, ''), 'If you accept, PostHog records pages viewed, calls to action clicked, the link that brought you here and how far you get in weave setup. One cookie choice covers grunion.ai and weave.grunion.ai.');
    assert.deepEqual(await p.locator(`${banner} button`).allTextContents(), ['Decline', 'Accept']);
    assert.equal(await p.locator(`${banner} a`).getAttribute('href'), '/privacy#cookies');
    assert.equal(await p.locator('[data-consent-open]').isVisible(), true, 'a Cookies link sits beside Privacy and Terms');
    assert.equal(await p.evaluate(() => typeof window.posthog), 'undefined');
    assert.deepEqual(ingest, [], 'nothing goes to /ingest before Accept');
    assert.equal(ph.seen.length, before);
    assert.ok(!(await ctx.cookies()).some((c) => c.name.startsWith('ph_') || c.name === 'grunion_consent'), 'no cookie before a choice');

    const granted = p.evaluate(() => new Promise((r) => addEventListener('grunion:consent-granted', () => r(true), { once: true })));
    await p.click(`${banner} button:has-text("Accept")`);
    assert.equal(await granted, true, 'Accept fires grunion:consent-granted');
    await p.waitForFunction(() => window.__ph?.some((c) => c[0] === 'capture'));
    assert.equal(await p.locator(banner).count(), 0);
    const cookie = await consent(ctx);
    assert.equal(cookie.value, 'granted');
    assert.equal(cookie.domain, 'localhost', 'host-only off grunion.ai');
    const [init] = await calls(p);
    assert.equal(init[0], 'init');
    assert.equal(init[1], 'phc_test');
    assert.equal(init[2].api_host, '/ingest');
    assert.equal(init[2].autocapture, false);
    assert.equal(init[2].disable_session_recording, true);
    assert.equal(init[2].opt_out_capturing_by_default, true, 'PostHog starts opted out');
    assert.deepEqual((await calls(p))[1], ['opt_in'], 'and opts in right after init, on the Accept');
    assert.ok(ingest.some((u) => new URL(u).pathname === '/ingest/static/array.js'), 'the script comes through the proxy');
    assert.deepEqual(await captured(p), [['onboarding_step_viewed', { step: 'account' }]]);

    const who = person(keyed);
    await go(p, 'signin');
    await step(p, 'workspace');
    await p.waitForFunction(() => window.__ph?.some((c) => c[0] === 'identify'));
    assert.equal(await p.locator(banner).count(), 0, 'a granted cookie loads PostHog without asking again');
    const ids = (await calls(p)).filter((c) => c[0] === 'identify');
    assert.deepEqual(ids, [['identify', who.sub]], 'identify carries the Clerk user id and nothing else');

    await p.fill('input[name="name"]', 'Ada Funnel Co');
    await p.fill('input[name="slug"]', 'ada-funnel');
    await p.waitForSelector('.ws-slug-status[data-state="available"]');
    await go(p, 'next');
    await step(p, 'work');
    await p.click('.card[data-template="crm"]');
    await go(p, 'next');
    await step(p, 'agent');
    await p.route('**/api/start/workspaces/*/agent', (r) => r.fulfill({ json: { connected: true, at: new Date().toISOString() } }));
    await p.click('.app[data-tool="claude"]');
    await p.waitForSelector('.link[data-state="connected"]', { timeout: 15000 });
    await go(p, 'next');
    await step(p, 'done');
    await p.waitForFunction(() => window.__ph?.some((c) => c[1] === 'onboarding_completed'));

    const events = await captured(p);
    assert.deepEqual(events, [
      ['onboarding_step_viewed', { step: 'workspace' }],
      ['signed_up', null],
      ['onboarding_step_viewed', { step: 'work' }],
      ['onboarding_step_viewed', { step: 'build' }],
      ['workspace_created', null],
      ['template_built', { template: 'crm' }],
      ['onboarding_step_viewed', { step: 'agent' }],
      ['agent_connected', { tool: 'claude' }],
      ['onboarding_step_viewed', { step: 'done' }],
      ['onboarding_completed', null],
    ]);
    const sent = JSON.stringify(await calls(p));
    for (const secret of [who.email, 'Ada Funnel Co', 'ada-funnel']) assert.ok(!sent.includes(secret), `PostHog never sees ${secret}`);
    await ctx.close();
  });

  test('Decline sets the cookie, loads nothing, and the Cookies link reopens the choice', async () => {
    const { p, ctx, ingest } = await page(keyed, 'dark');
    await p.goto(`${keyed.base}/start`);
    await step(p, 'account');
    await p.waitForSelector(banner);
    await p.click(`${banner} button:has-text("Decline")`);
    assert.equal(await p.locator(banner).count(), 0);
    assert.equal((await consent(ctx)).value, 'denied');
    await p.reload();
    await step(p, 'account');
    await p.waitForLoadState('networkidle');
    assert.equal(await p.locator(banner).count(), 0, 'a declined visitor is not asked again');
    assert.equal(await p.evaluate(() => typeof window.posthog), 'undefined');
    assert.deepEqual(ingest, []);
    await p.click('[data-consent-open]');
    await p.waitForSelector(banner);
    assert.equal(new URL(p.url()).pathname, '/start', 'the link reopens the banner in place');
    await ctx.close();
  });

  test('Decline after Accept, through the Cookies link, opts PostHog out', async () => {
    const { p, ctx } = await page(keyed);
    await p.goto(`${keyed.base}/start`);
    await step(p, 'account');
    await p.click(`${banner} button:has-text("Accept")`);
    await p.waitForFunction(() => window.__ph?.some((c) => c[0] === 'opt_in'));
    await p.click('[data-consent-open]');
    await p.waitForSelector(banner);
    await p.click(`${banner} button:has-text("Decline")`);
    await p.waitForFunction(() => window.__ph?.some((c) => c[0] === 'opt_out'));
    assert.equal((await consent(ctx)).value, 'denied');
    const after = (await calls(p)).length;
    await p.evaluate(() => globalThis.WeaveConsent.capture('onboarding_step_viewed', { step: 'account' }));
    assert.equal((await calls(p)).length, after, 'capture is a no-op once declined');
    await ctx.close();
  });

  test('a choice made on grunion.ai carries over: a granted cookie loads PostHog with no banner on /auth', async () => {
    const { p, ctx } = await page(keyed);
    await ctx.addCookies([{ name: 'grunion_consent', value: 'granted', url: keyed.base }]);
    await p.goto(`${keyed.base}/auth?signed-out=1`);
    await p.waitForFunction(() => window.__ph?.some((c) => c[0] === 'opt_in'));
    assert.deepEqual((await calls(p)).map((c) => c[0]), ['init', 'opt_in']);
    assert.equal(await p.locator(banner).count(), 0);
    assert.equal(await p.locator('[data-consent-open]').isVisible(), true);
    await ctx.close();
  });
}
