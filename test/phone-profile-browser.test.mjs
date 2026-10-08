import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phonePage, phoneProfile, PHONE } from './lib/browser.mjs';

const s = await launch('phone profile', () => {}, { phone: true });

if (s) {
  const { base, browser } = s;

  test(`the phone profile is ${PHONE} in WebKit: a touch screen, a mobile viewport and the iOS Safari agent`, async () => {
    assert.equal(browser.browserType().name(), 'webkit', 'launch({ phone: true }) launches WebKit');
    assert.equal(phoneProfile().engine, 'webkit');
    const page = await phonePage(browser);
    try {
      await page.goto(base, { waitUntil: 'networkidle' });
      const seen = await page.evaluate(() => ({
        width: innerWidth, dpr: devicePixelRatio, touch: 'ontouchstart' in window,
        coarse: matchMedia('(pointer: coarse)').matches, agent: navigator.userAgent,
      }));
      assert.equal(seen.width, 393, 'the viewport is the iPhone 15 width');
      assert.equal(seen.dpr, 3);
      assert.ok(seen.touch, 'the page sees a touch screen');
      assert.match(seen.agent, /iPhone; CPU iPhone OS .* Mobile\/\w+ Safari/, 'with the iOS Safari user agent');
      assert.deepEqual(page.viewportSize(), phoneProfile().page.viewport);
    } finally { await page.close(); }
  });

  test('a phone page takes overrides on top of the profile', async () => {
    const page = await phonePage(browser, { colorScheme: 'dark' });
    try {
      await page.goto(base, { waitUntil: 'networkidle' });
      assert.equal(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches), true);
      assert.equal(await page.evaluate(() => innerWidth), 393);
    } finally { await page.close(); }
  });
}
