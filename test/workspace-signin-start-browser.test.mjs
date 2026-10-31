import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { createOidc } from '../src/oidc.js';
import { launch } from './lib/browser.mjs';
import { startIdp } from './lib/idp.mjs';

const idp = await startIdp({ sessions: true });
const oidc = createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' });
let harbor, deal;
const s = await launch('a signed-out workspace link signs in on the setup page', (main) => {
  main.state.meta.name = 'Net';
  main.createAccount({ name: 'operator', role: 'architect' });
  main.setRequireAuth(true);
  harbor = new Weave();
  harbor.state.meta.name = 'harbor';
  harbor.markOnboarded();
  harbor.createSpace({ name: 'Sales' });
  deal = harbor.createEntity(harbor.createTable({ space: 'Sales', name: 'Deals' }), { name: 'Acme Working Capital' });
  harbor.createAccount({ name: 'eve', role: 'editor' });
  harbor.redeemIdentityInvite(harbor.linkIdentity('eve', { issuer: idp.issuer }).code, { issuer: idp.issuer, subject: 'user_eve' });
  harbor.setRequireAuth(true);
}, { server: () => ({ oidc, clerkKey: idp.publishableKey, baseDomain: 'localhost', workspaces: { harbor }, openSignup: { on: true, limit: 1 }, limits: { options: 1000, failed: 1000, slugs: 1000 } }) });
test.after(() => idp.stop());

if (s) {
  const base = s.base.replace('127.0.0.1', 'localhost');
  const link = `/w/harbor/e/${deal.id}`;
  const arrive = async () => {
    const ctx = await s.browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    page.on('pageerror', (err) => { throw err; });
    const res = await page.goto(`${base}${link}`);
    const landed = new URL(res.url());
    assert.equal(landed.pathname, '/start', `the workspace link lands on the setup page, not ${res.url()}`);
    assert.equal(landed.searchParams.get('next'), link, 'the return path rides along');
    await page.waitForSelector('main#start[data-step="account"] #clerk-pane [data-fake-clerk="signin"]');
    return page;
  };
  const options = (page) => page.evaluate(() => ({ mounted: window.__clerkMounted, ...window.__clerkOptions }));

  test('sign-in from a workspace link happens in the setup pane and returns to the linked row (Issue #994)', async () => {
    idp.signInBrowserAs({ sub: 'user_eve' });
    const page = await arrive();
    try {
      await page.reload();
      await page.waitForSelector('#clerk-pane [data-fake-clerk="signin"]');
      const inn = await options(page);
      assert.equal(inn.forceRedirectUrl, `/w/harbor/api/auth/oidc/start?next=${encodeURIComponent(link)}`, 'a sign-in goes on to the workspace');
      assert.equal(inn.signUpForceRedirectUrl, '/api/auth/oidc/start?start=1&next=%2Fstart', 'a sign-up goes to onboarding');
      await page.click('#clerk-pane [data-fake-clerk="google"]');
      await page.waitForFunction(() => document.querySelector('#main .name-edit')?.value === 'Acme Working Capital');
      assert.match(new URL(page.url()).pathname, /^\/w\/harbor\//, 'the person is back on the workspace');
      assert.equal(idp.seen.signInPages, 0, 'the provider\'s hosted sign-in page never showed');
    } finally { await page.context().close(); }
  });

  test('already signed in on the setup page, a workspace link goes straight on to the row (Issue #994)', async () => {
    idp.signInBrowserAs({ sub: 'user_eve' });
    const ctx = await s.browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    try {
      await page.goto(`${base}/start?pick=1`);
      await page.waitForSelector('#clerk-pane [data-fake-clerk="signin"]');
      await page.click('#clerk-pane [data-fake-clerk="google"]');
      await page.waitForSelector('main#start[data-step="list"] .rows li');
      await page.goto(`${base}${link}`);
      await page.waitForFunction(() => document.querySelector('#main .name-edit')?.value === 'Acme Working Capital');
      assert.match(new URL(page.url()).pathname, /^\/w\/harbor\//);
      assert.equal(idp.seen.signInPages, 0);
    } finally { await ctx.close(); }
  });

  test('a signed-out start link signs in on the setup pane and goes on to the workspace (Issue #1284)', async () => {
    idp.signInBrowserAs({ sub: 'user_eve' });
    const ctx = await s.browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    try {
      page.on('pageerror', (err) => { throw err; });
      const res = await page.goto(`${base}/api/start/open/harbor`);
      const landed = new URL(res.url());
      assert.equal(landed.pathname, '/start', `the start link lands on the setup page, not ${res.url()}`);
      assert.equal(landed.searchParams.get('next'), '/api/start/open/harbor', 'the link rides along');
      await page.waitForSelector('#clerk-pane [data-fake-clerk="signin"]');
      const inn = await options(page);
      assert.equal(inn.forceRedirectUrl, '/api/auth/oidc/start?start=1&next=%2Fapi%2Fstart%2Fopen%2Fharbor', 'a sign-in goes on to the link');
      const trail = [];
      page.on('request', (r) => { if (r.isNavigationRequest()) trail.push(r.url()); });
      await page.route(/^http:\/\/harbor\.localhost[:/]/, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: 'harbor' }));
      const handed = page.waitForRequest((r) => r.url().includes('/api/auth/handoff'), { timeout: 10_000 }).catch(() => null);
      await page.click('#clerk-pane [data-fake-clerk="google"]');
      const hit = await handed;
      assert.ok(hit, `the sign-in never handed off; navigations: ${trail.join(' -> ')}`);
      const to = new URL(hit.url());
      assert.equal(to.pathname, '/api/auth/handoff', 'the signed-in link hands off to the workspace host');
      assert.ok(to.searchParams.get('code'));
      assert.equal(idp.seen.signInPages, 0, 'the provider\'s hosted sign-in page never showed');
    } finally { await ctx.close(); }
  });

  test('sign-up from a workspace link walks onboarding (Issue #994)', async () => {
    idp.signInBrowserAs({ sub: 'user_new', email: 'new@example.com', email_verified: true });
    const page = await arrive();
    try {
      await page.click('main [data-go="switch"]');
      await page.waitForSelector('#clerk-pane [data-fake-clerk="signup"]');
      await page.reload();
      await page.waitForSelector('#clerk-pane [data-fake-clerk="signup"]');
      const up = await options(page);
      assert.equal(up.forceRedirectUrl, '/api/auth/oidc/start?start=1&next=%2Fstart', 'a new account goes to the setup steps');
      assert.equal(up.signInForceRedirectUrl, `/w/harbor/api/auth/oidc/start?next=${encodeURIComponent(link)}`, 'switching back to sign-in still returns to the workspace');
      await page.click('#clerk-pane [data-fake-clerk="google"]');
      await page.waitForSelector('main#start[data-step="workspace"]');
      assert.equal(new URL(page.url()).pathname, '/start');
      assert.equal(idp.seen.signInPages, 0, 'the provider\'s hosted sign-up page never showed');
    } finally { await page.context().close(); }
  });
}
