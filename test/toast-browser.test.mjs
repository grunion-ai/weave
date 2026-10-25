import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { launch } from './lib/browser.mjs';


const s = await launch('toast', (weave) => {
  weave.createSpace({ name: 'S' });
  weave.createTable({ space: 'S', name: 'T' });
});
if (s) {
  const { base, browser } = s;
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

  test('a seat-required refusal shows one toast with an Open billing action, however often it repeats (Issue #917)', async () => {
    const page = await browser.newPage();
    await page.goto(base, { waitUntil: 'networkidle' });
    const seen = await page.evaluate(async () => {
      const body = { error: 'The free trial of acme has ended, so creating and editing there needs a paid seat. Subscribe on the billing page to keep editing.', code: 'seat-required', billing: '/w/acme/billing' };
      const real = window.fetch;
      window.fetch = async () => new Response(JSON.stringify(body), { status: 402, headers: { 'Content-Type': 'application/json' } });
      const shown = [];
      for (let i = 0; i < 3; i++) {
        try { await api('POST', '/tables/x/entities', { name: 'n' }); } catch (err) {
          shown.push(err.shown === true);
          if (!err.shown) toast(err.message, true);
        }
      }
      toast(body.error, true);
      window.fetch = real;
      const toasts = [...document.querySelectorAll('.wv-toast')];
      return { shown, count: toasts.length, action: toasts[0]?.querySelector('.wv-toast-action')?.textContent, times: toasts[0]?.querySelector('.wv-toast-count')?.textContent };
    });
    assert.deepEqual(seen, { shown: [true, true, true], count: 1, action: 'Open billing', times: '×4' });
    await page.close();
  });
}
