import test from 'node:test';
import assert from 'node:assert/strict';
import { createOidc } from '../src/oidc.js';
import { launch } from './lib/browser.mjs';

const s = await launch('start loading feedback', () => {}, { server: () => ({ oidc: createOidc({ issuer: 'https://idp.example.test', clientId: 'test', clientSecret: 'test', name: 'Test' }) }) });
if (s) {
  for (const theme of ['light', 'dark']) {
    test(`start shows pending requests and workspace navigation in ${theme}`, async () => {
      const context = await s.browser.newContext({ colorScheme: theme, viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      let finishNavigation;
      const navigating = new Promise((resolve) => { finishNavigation = resolve; });
      let release;
      const ready = new Promise((resolve) => { release = resolve; });
      await page.route('**/api/start', async (route) => {
        await ready;
        await route.fulfill({ json: { signedIn: true, logins: ['owner@example.com'], rows: [{ kind: 'workspace', name: 'net', title: 'Net', open: '/w/net/', role: 'owner' }] } });
      });
      try {
        await page.goto(`${s.base}/start?pick=1`, { waitUntil: 'domcontentloaded' });
        assert.equal(await page.locator('#start [role="status"]').textContent(), 'Loading weave…');
        release();
        const row = page.locator('a.ws-row');
        await row.waitFor();
        assert.equal(await page.locator('#start [role="status"]').count(), 0);
        await row.dispatchEvent('click', { ctrlKey: true });
        assert.equal(await row.getAttribute('data-opening'), null);
        await page.route('**/w/net/', async (route) => { await navigating; await route.abort(); });
        await row.click({ noWaitAfter: true });
        await page.waitForFunction(() => document.querySelector('a.ws-row')?.getAttribute('data-opening') === 'true');
        assert.equal(await row.locator('[role="status"]').textContent(), 'Opening Net…');
        await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
        assert.equal(await page.locator('a.ws-row').getAttribute('data-opening'), null);
        assert.equal(await page.locator('#start [role="status"]').count(), 0);
      } finally {
        release();
        finishNavigation();
        await context.close();
      }
    });
  }
}
