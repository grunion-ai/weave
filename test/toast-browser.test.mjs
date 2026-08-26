/* Toasts, in a real browser.

   Tabler ships `.toast:not(.show){display:none}` — Bootstrap's toast, which
   waits for JavaScript to reveal it. Weave hand-rolls its own toast and gave
   it the same class name, so every message the app has ever raised — 'Saved',
   an error's real reason, an Undo offer — was painted into a box the
   framework had already switched off. Nothing in the source looked wrong,
   which is why this claim has to be made in a browser and not by reading CSS.

   Playwright is NOT a dependency of weave; it is imported dynamically and the
   suite skips when absent, so `node --test` stays green on a bare checkout. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const chromium = await import('playwright')
  .then((pw) => pw.chromium)
  .catch(() => null);

if (!chromium) {
  test('toast (browser)', { skip: 'playwright not installed' }, () => {});
} else {
  let server, base, browser;

  test.before(async () => {
    const weave = new Weave();
    weave.createSpace({ name: 'S' });
    weave.createTable({ space: 'S', name: 'T' });
    ({ server } = await startServer(weave, { port: 0 }));
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
  });

  test.after(async () => {
    await browser?.close();
    server?.close();
  });

  test('a toast is on screen, not switched off by a framework class', async () => {
    const page = await browser.newPage();
    await page.goto(base, { waitUntil: 'networkidle' });
    const box = await page.evaluate(() => {
      toast('Saved');
      const t = document.querySelector('.wv-toast');
      const r = t.getBoundingClientRect();
      return { display: getComputedStyle(t).display, width: r.width, height: r.height };
    });
    assert.notEqual(box.display, 'none', 'a toast the app raises must be displayed');
    assert.ok(box.width > 0 && box.height > 0, `a toast must occupy the screen, got ${box.width}×${box.height}`);
    await page.close();
  });

  test('two toasts stack instead of covering each other', async () => {
    const page = await browser.newPage();
    await page.goto(base, { waitUntil: 'networkidle' });
    const rects = await page.evaluate(() => {
      toast('Saved');
      toast('Cleared the number definition.', false, { label: 'Undo', run: () => {} });
      return [...document.querySelectorAll('.wv-toast')].map((t) => {
        const r = t.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, text: t.textContent };
      });
    });
    assert.equal(rects.length, 2);
    const [a, b] = rects.sort((x, y) => x.top - y.top);
    assert.ok(a.bottom <= b.top, `toasts overlap: ${JSON.stringify(rects)}`);
    await page.close();
  });

  test('an action inside a toast can be clicked', async () => {
    const page = await browser.newPage();
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      globalThis.__undone = false;
      toast('Cleared it.', false, { label: 'Undo', run: () => { globalThis.__undone = true; } });
    });
    await page.locator('.wv-toast .wv-toast-action').click({ timeout: 3000 });
    assert.equal(await page.evaluate(() => globalThis.__undone), true);
    await page.close();
  });
}
