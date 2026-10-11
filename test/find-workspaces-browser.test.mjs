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
    test(`start page: one sign-in, then Add login, then Sign out (${colorScheme})`, async () => {
      const page = await open(colorScheme);
      try {
        await page.goto(`${base}/start`, { waitUntil: 'networkidle' });
        await page.getByRole('link', { name: 'Sign in with Clerk' }).click();
        await page.waitForURL(`${base}/start`);
        await page.waitForSelector('.rows li');
        assert.deepEqual(await page.locator('.rows li a').allInnerTexts(), ['Net'], 'eve opens Net');
        assert.equal(await page.locator('.rows li small').count(), 0, 'one login needs no label');
        assert.ok(await page.getByRole('link', { name: 'Add login' }).isVisible());
        assert.ok(await page.getByRole('button', { name: 'Sign out' }).isVisible());
        assert.doesNotMatch(await page.locator('main').innerText(), /\bnull\b/, 'an absent create button leaves no text behind');

        page.who = 'user_kyle';
        await page.getByRole('link', { name: 'Add login' }).click();
        await page.waitForURL(`${base}/start`);
        await page.waitForSelector('.rows li small');
        assert.deepEqual(await page.locator('.rows li small').allInnerTexts(), ['eve'], 'with two logins each row names the login that opens it');
        assert.equal(await page.locator('.rows li').count(), 1, 'the workspace both logins open is listed once');
        assert.ok(await page.getByRole('button', { name: 'Create workspace' }).isVisible(), 'the architect login brings the create button');

        const fg = await page.locator('.rows li small').evaluate((n) => getComputedStyle(n).color);
        const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        assert.notEqual(fg, bg, 'the login label is readable on the page');

        await page.getByRole('button', { name: 'Sign out' }).click();
        await page.waitForSelector('a:has-text("Sign in with Clerk")');
        assert.equal(await page.locator('.rows li').count(), 0, 'signed out, the list is gone');
      } finally { await page.close(); }
    });

    test(`rail: the + button offers New workspace, Add login and Find my workspaces (${colorScheme})`, async () => {
      const page = await open(colorScheme);
      try {
        await page.goto(`${base}/start`, { waitUntil: 'networkidle' });
        await page.getByRole('link', { name: 'Sign in with Clerk' }).click();
        await page.waitForURL(`${base}/start`);
        await page.waitForSelector('.rows li a');
        await page.locator('.rows li a').first().click();
        await page.waitForSelector('#ws-new');
        await page.locator('#ws-new').click();
        await page.waitForSelector('.wv-ctx.ws-plus');
        const items = await page.locator('.wv-ctx.ws-plus .dropdown-item').allInnerTexts();
        assert.deepEqual(items.map((t) => t.trim()), ['New workspace', 'Add login', 'Find my workspaces']);
        const menu = page.locator('.wv-ctx.ws-plus');
        const [mfg, mbg] = await menu.evaluate((n) => { const cs = getComputedStyle(n); return [getComputedStyle(n.querySelector('.dropdown-item')).color, cs.backgroundColor]; });
        assert.notEqual(mfg, mbg, 'menu text is readable');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.wv-ctx.ws-plus').count(), 0, 'Escape closes the menu');
      } finally { await page.close(); }
    });
  }
}
