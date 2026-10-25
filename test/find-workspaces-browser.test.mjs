import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { startIdp } from './lib/idp.mjs';
import { createOidc } from '../src/oidc.js';

const idp = await startIdp();
const oidc = createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' });
const s = await launch('find my workspaces', (weave) => {
  weave.state.meta.name = 'Net';
  for (const [name, role, subject] of [['eve', 'editor', 'user_eve'], ['kyle', 'architect', 'user_kyle']]) {
    weave.createAccount({ name, role });
    weave.redeemIdentityInvite(weave.linkIdentity(name, { issuer: idp.issuer }).code, { issuer: idp.issuer, subject });
  }
  weave.setRequireAuth(true);
}, { server: () => ({ oidc, limits: { options: 1000, failed: 1000, slugs: 1000 } }) });
test.after(() => idp.stop());

if (s) {
  const { browser } = s;
  const base = s.base.replace('127.0.0.1', 'localhost');
  const open = async (colorScheme) => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 700 }, colorScheme });
    page.who = 'user_eve';
    await page.route((u) => u.pathname === '/api/auth/oidc/start', async (route) => {
      const hop = await route.fetch({ maxRedirects: 0 });
      const back = idp.approve(hop.headers().location, { sub: page.who }).href;
      await route.fulfill({ status: 200, contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(back)})</script>` });
    });
    return page;
  };

  for (const colorScheme of ['light', 'dark']) {
    test(`start page: one sign-in, then Use another account, then Sign out (${colorScheme})`, async () => {
      const page = await open(colorScheme);
      try {
        await page.goto(`${base}/start?pick=1`, { waitUntil: 'networkidle' });
        await page.getByRole('link', { name: 'Sign in', exact: true }).click();
        await page.waitForURL(`${base}/start?pick=1`);
        await page.waitForSelector('.rows li');
        assert.deepEqual(await page.locator('.rows li .ws-title').allInnerTexts(), ['Net'], 'eve opens Net');
        assert.equal(await page.locator('.rows .ws-login').count(), 0, 'one login needs no label');
        assert.match(await page.locator('.signed-in').innerText(), /^Signed in as \S/, 'the page names the account it lists (Issue #964)');
        assert.ok(await page.getByRole('link', { name: 'Use another account' }).isVisible());
        assert.ok(await page.getByRole('button', { name: 'Sign out' }).isVisible());
        assert.doesNotMatch(await page.locator('main').innerText(), /\bnull\b/, 'an absent create button leaves no text behind');

        page.who = 'user_kyle';
        await page.getByRole('link', { name: 'Use another account' }).click();
        await page.waitForURL(`${base}/start?pick=1`);
        await page.waitForSelector('.rows .ws-login');
        assert.deepEqual(await page.locator('.rows .ws-login').allInnerTexts(), ['eve'], 'with two logins each row names the login that opens it');
        assert.equal(await page.locator('.rows li').count(), 1, 'the workspace both logins open is listed once');
        assert.ok(await page.getByRole('button', { name: 'Create a workspace' }).isVisible(), 'the architect login brings the create button');

        const fg = await page.locator('.rows .ws-login').evaluate((n) => getComputedStyle(n).color);
        const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        assert.notEqual(fg, bg, 'the login label is readable on the page');

        await page.getByRole('button', { name: 'Sign out' }).click();
        await page.waitForSelector('main a[data-go="signin"]');
        assert.equal(await page.locator('.rows li').count(), 0, 'signed out, the list is gone');
      } finally { await page.close(); }
    });

    test(`rail: the + button offers New workspace, Add login and Find my workspaces (${colorScheme})`, async () => {
      const page = await open(colorScheme);
      try {
        await page.goto(`${base}/start`, { waitUntil: 'networkidle' });
        await page.getByRole('link', { name: 'Sign in', exact: true }).click();
        await page.waitForSelector('#ws-new > .wv-icon');
        const home = new URL(page.url()).pathname;
        assert.equal(home, '/w/Net/', 'signing in at the root opens the workspace, not the list (Issue #977)');
        await page.locator('#ws-new').click();
        await page.waitForSelector('.wv-menu.ws-plus');
        const items = await page.locator('.wv-menu.ws-plus .wv-menu-row').allInnerTexts();
        assert.deepEqual(items.map((t) => t.trim()), ['New workspace', 'Add login', 'Find my workspaces']);
        const menu = page.locator('.wv-menu.ws-plus');
        const [mfg, mbg] = await menu.evaluate((n) => { const cs = getComputedStyle(n); return [getComputedStyle(n.querySelector('.wv-menu-row')).color, cs.backgroundColor]; });
        assert.notEqual(mfg, mbg, 'menu text is readable');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.wv-menu.ws-plus').count(), 0, 'Escape closes the menu');

        await page.goto(`${base}${home}#/settings`);
        await page.waitForFunction((key) => localStorage.getItem(key) === '#/settings', `wv-last-route:${home}`);
        await page.goto(`${base}/start`);
        await page.waitForURL(`${base}${home}#/settings`);
        assert.equal(await page.evaluate(() => location.hash), '#/settings', 'the root reopens the page the workspace last had open (Issue #977)');

        await page.locator('#ws-new').click();
        await page.locator('.wv-menu.ws-plus .wv-menu-row', { hasText: 'Find my workspaces' }).click();
        await page.waitForURL(`${base}/start?pick=1`);
        await page.waitForSelector('.rows li');
        assert.deepEqual(await page.locator('.rows li .ws-title').allInnerTexts(), ['Net'], 'Find my workspaces still shows the list');
      } finally { await page.close(); }
    });
  }
}
