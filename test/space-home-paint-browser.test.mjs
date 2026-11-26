import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch } from './lib/browser.mjs';

const svg = readFileSync(new URL('../brand/kit/svg/poster-contour-banner.svg', import.meta.url));
const DELAY = 400;
let ids;
const s = await launch('space home paint', (w) => {
  w.markOnboarded();
  const space = w.createSpace({ name: 'Agent' });
  w.createTable({ space: space.id, name: 'Routine' });
  w.addField('System/Spaces', { name: 'Header', type: 'attachments', config: { multiple: false, preview: 'cover' } });
  const row = w.query('System/Spaces', {}).items.find((r) => r.sysId === space.id);
  w.attachToField(row.id, 'Header', { name: 'banner.svg', mime: 'image/svg+xml', bytes: svg });
  ids = { space: space.id };
});

if (s) {
  const { base, browser } = s;
  const slowApi = async (page) => {
    const seen = [];
    await page.route('**/api/**', async (route) => {
      seen.push(new URL(route.request().url()).pathname);
      await new Promise((done) => setTimeout(done, DELAY));
      await route.continue();
    });
    return seen;
  };
  const timeNextPaint = (page) => page.evaluate(() => {
    window.paintMs = null;
    document.addEventListener('click', () => {
      const t0 = performance.now();
      new MutationObserver((_, obs) => {
        if (!document.querySelector('main .space-home:not([data-old])')) return;
        window.paintMs = Math.round(performance.now() - t0);
        obs.disconnect();
      }).observe(document.querySelector('main'), { childList: true, subtree: true });
    }, { capture: true, once: true });
  });

  for (const [from, cold] of [['#/', false], ['#/settings', true]]) {
    test(`a nav-space click paints the space home in one slow round trip, not one per read, with space-home-view.js ${cold ? 'cold' : 'warm'} (Issue #1414)`, async () => {
      const page = await browser.newPage({ viewport: { width: 1470, height: 793 } });
      try {
        await page.goto(`${base}/${from}`, { waitUntil: 'networkidle' });
        assert.equal(await page.evaluate(() => typeof mountSpaceHome), cold ? 'undefined' : 'function');
        await page.$$eval('.space-home', (els) => els.forEach((n) => n.setAttribute('data-old', '')));
        const seen = await slowApi(page);
        await timeNextPaint(page);
        await page.click(`a.nav-space[href="#/space/${ids.space}"]`);
        await page.waitForSelector('.space-home:not([data-old])');
        const ms = await page.evaluate(() => window.paintMs);
        assert.ok(seen.some((p) => p.endsWith(`/spaces/${ids.space}/home`)), `the home read went out: ${seen.join(' ')}`);
        assert.ok(seen.some((p) => /\/tables\/[^/]+\/query$/.test(p)), `the cover read went out: ${seen.join(' ')}`);
        assert.ok(ms < DELAY * 1.6, `painted in ${ms} ms with every API call ${DELAY} ms slow; the cover and home reads run side by side`);
        await page.locator('.registry-cover').waitFor();
        assert.ok(await page.evaluate(() => {
          const cover = document.querySelector('main .registry-cover');
          const home = document.querySelector('main .space-home');
          return !!(cover.compareDocumentPosition(home) & Node.DOCUMENT_POSITION_FOLLOWING);
        }), 'the cover still sits above the home');
      } finally { await page.close(); }
    });
  }
}
