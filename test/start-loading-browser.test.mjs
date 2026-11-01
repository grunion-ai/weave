import test from 'node:test';
import assert from 'node:assert/strict';
import { createOidc } from '../src/oidc.js';
import { launch, styleOf } from './lib/browser.mjs';

const SUNK = { light: 'rgb(226, 230, 236)', dark: 'rgb(34, 39, 49)' };

const s = await launch('start loading feedback', () => {}, { server: () => ({ oidc: createOidc({ issuer: 'https://idp.example.test', clientId: 'test', clientSecret: 'test', name: 'Test' }) }) });
if (s) {
  for (const theme of ['light', 'dark']) {
    test(`start shows pending requests and workspace navigation in ${theme}`, async () => {
      const context = await s.browser.newContext({ colorScheme: theme, viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
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
        await page.evaluate(() => document.addEventListener('click', (ev) => ev.preventDefault()));
        assert.equal(await row.getAttribute('href'), '/w/net/');
        await row.dispatchEvent('click', { ctrlKey: true });
        assert.equal(await row.getAttribute('data-opening'), null);
        const restBackground = await row.evaluate((n) => getComputedStyle(n).backgroundColor);
        const firstFrame = await row.evaluate((n) => {
          n.click();
          return { opening: n.getAttribute('data-opening'), status: n.querySelector('[role="status"]')?.textContent ?? null, background: getComputedStyle(n).backgroundColor };
        });
        assert.deepEqual(firstFrame, { opening: 'true', status: 'Opening Net…', background: SUNK[theme] }, 'the chosen row shows its opening state before the click handler returns');
        assert.notEqual(firstFrame.background, restBackground);
        await styleOf(row, 'background-color', SUNK[theme]);
        assert.equal(await row.getAttribute('data-opening'), 'true');
        assert.equal(await row.locator('[role="status"]').textContent(), 'Opening Net…');
        await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
        assert.equal(await page.locator('a.ws-row').getAttribute('data-opening'), null);
        assert.equal(await page.locator('#start [role="status"]').count(), 0);
      } finally {
        release();
        await context.close();
      }
    });
  }
}
