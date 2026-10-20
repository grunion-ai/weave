import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { startIdp } from './lib/idp.mjs';
import { createOidc } from '../src/oidc.js';

const idp = await startIdp();
const oidc = createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' });
const s = await launch('start page art stage', () => {}, { server: () => ({ oidc }) });
test.after(() => idp.stop());

if (s) {
  const sizes = [
    { width: 900, height: 1000 },
    { width: 1024, height: 1366 },
    { width: 1440, height: 900 },
    { width: 2560, height: 1440 },
  ];
  for (const { width, height } of sizes) {
    test(`start page: the stage sizes the art to the stage at ${width}x${height} (Issue #990)`, async () => {
      const page = await s.browser.newPage({ viewport: { width, height } });
      try {
        await page.goto(`${s.base.replace('127.0.0.1', 'localhost')}/start`);
        await page.waitForFunction(() => document.querySelector('#stage .radiate img')?.complete);
        assert.equal(await page.locator('#stage').isVisible(), true);
        const art = await page.evaluate(() => {
          const img = document.querySelector('#stage img'), a = img.getBoundingClientRect(), st = document.querySelector('#stage').getBoundingClientRect();
          return { scale: a.width / img.naturalWidth, nw: img.naturalWidth, a, st: { left: st.left, top: st.top, right: st.right, bottom: st.bottom, width: st.width } };
        });
        assert.equal(art.nw, 3840);
        const mark = 320 * art.scale;
        assert.ok(art.scale <= 1.001, `the art never draws past its own scale, got ${art.scale.toFixed(2)}x`);
        assert.ok(mark <= art.st.width * 0.56, `the ${mark.toFixed(0)} px mark leaves room in a ${art.st.width.toFixed(0)} px stage`);
        if (art.st.width >= 320 / 0.55) assert.ok(art.scale > 0.999, 'a stage with room shows the mark at full size');
        for (const [edge, inside] of [['left', art.a.left <= art.st.left + 0.5], ['top', art.a.top <= art.st.top + 0.5], ['right', art.a.right >= art.st.right - 0.5], ['bottom', art.a.bottom >= art.st.bottom - 0.5]]) {
          assert.ok(inside, `the art reaches the stage's ${edge} edge`);
        }
      } finally { await page.close(); }
    });
  }

  test('start page: a phone-width window drops the stage for the single pane (Issue #990)', async () => {
    const page = await s.browser.newPage({ viewport: { width: 800, height: 1000 } });
    try {
      await page.goto(`${s.base.replace('127.0.0.1', 'localhost')}/start`);
      await page.waitForSelector('#stage .radiate img', { state: 'attached' });
      assert.equal(await page.locator('#stage').isVisible(), false);
      assert.equal(Math.round((await page.locator('.pane').boundingBox()).width), 800);
    } finally { await page.close(); }
  });
}
