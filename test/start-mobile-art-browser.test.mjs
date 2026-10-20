import test from 'node:test';
import assert from 'node:assert/strict';
import { createOidc } from '../src/oidc.js';
import { launch } from './lib/browser.mjs';

const s = await launch('start mobile artwork requests', () => {}, { server: () => ({ oidc: createOidc({ issuer: 'https://idp.example.test', clientId: 'test', clientSecret: 'test', name: 'Test' }) }) });
if (s) {
  for (const theme of ['light', 'dark']) {
    test(`hidden start artwork makes no phone request and loads after desktop resize in ${theme}`, async () => {
      const page = await s.browser.newPage({ colorScheme: theme, viewport: { width: 390, height: 844 } });
      const requests = [];
      page.on('request', (r) => { if (/\/brand\/weave-radiate-/.test(r.url())) requests.push(r.url()); });
      await page.route('**/api/start', (route) => route.fulfill({ json: { signedIn: false, provider: 'Test' } }));
      try {
        await page.goto(`${s.base}/start?pick=1`);
        await page.waitForFunction(() => document.querySelector('#stage img')?.complete);
        assert.equal(await page.locator('#stage').isVisible(), false);
        assert.deepEqual(requests, [], 'display:none must not transfer desktop artwork');
        assert.match(await page.locator('#stage img').evaluate((n) => n.currentSrc), /^data:/);
        await page.setViewportSize({ width: 1200, height: 900 });
        await page.waitForFunction((theme) => {
          const img = document.querySelector('#stage img');
          return img.complete && img.naturalWidth > 1 && img.currentSrc.endsWith(`weave-radiate-${theme}.svg`);
        }, theme);
        assert.equal(await page.locator('#stage').isVisible(), true);
        assert.equal(requests.length, 1);
        assert.ok(requests[0].endsWith(`weave-radiate-${theme}.svg`));
      } finally { await page.close(); }
    });
  }
}
