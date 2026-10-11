import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phonePage, phoneProfile, phoneBrowser, touchScroll, PHONE } from './lib/browser.mjs';

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

  test('phoneBrowser hands a suite that runs on Chromium the WebKit engine for its phone cases', async () => {
    const handset = await phoneBrowser();
    assert.equal(handset.browserType().name(), 'webkit');
    assert.equal(await phoneBrowser(), handset, 'one WebKit per suite');
  });

  test('touchScroll scrolls the pane under a point, never the document', async () => {
    const page = await phonePage(await phoneBrowser());
    try {
      await page.goto(base, { waitUntil: 'networkidle' });
      await page.evaluate(() => {
        const box = Object.assign(document.createElement('div'), { id: 'pane', style: 'position:fixed;inset:0;overflow:auto;z-index:99999;background:#fff' });
        box.append(Object.assign(document.createElement('div'), { style: 'height:3000px' }));
        document.body.append(box);
      });
      await touchScroll(page, { x: 100, y: 300 }, 600);
      assert.deepEqual(await page.evaluate(() => [document.querySelector('#pane').scrollTop, document.scrollingElement.scrollTop]), [600, 0]);
    } finally { await page.close(); }
  });
}
