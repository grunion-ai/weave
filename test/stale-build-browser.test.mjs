/* Issue #114, in a real browser: when the process is older than the checkout
   that served the page, the instance chip has to SAY so and the toast has to
   be on screen. Asserted here rather than in source because the 2026-08-28
   failure was silence — a message the framework switches off (Issue #92) is
   the same silence with more code behind it.

   Playwright is NOT a dependency of weave; the harness skips the suite when
   it is absent, so `node --test` stays green on a bare checkout. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const STALE = { sha: 'aaaaaaa', diskSha: 'bbbbbbb', stale: true };

const s = await launch('stale build', (weave) => {
  weave.createSpace({ name: 'S' });
  weave.createTable({ space: 'S', name: 'T' });
}, { server: () => ({ build: () => STALE }) });

if (s) {
  const { base, browser } = s;

  for (const theme of ['light', 'dark']) {
    test(`the stale instance chip is tinted and legible in the ${theme} theme`, async () => {
      const page = await browser.newPage();
      await page.goto(base, { waitUntil: 'networkidle' });
      await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
      const chip = await page.evaluate(() => {
        const c = document.querySelector('.nav-health');
        const r = c.getBoundingClientRect();
        return { cls: c.className, text: c.textContent, title: c.title, color: getComputedStyle(c).color, w: r.width, h: r.height };
      });
      assert.match(chip.cls, /is-stale/, 'the chip wears the verdict');
      assert.ok(chip.w > 0 && chip.h > 0, `the chip must occupy the screen, got ${chip.w}×${chip.h}`);
      assert.match(chip.text, /aaaaaaa/, 'it names the commit the process booted from');
      assert.match(chip.text, /bbbbbbb/, 'and the commit that served this page');
      assert.match(chip.title, /restart/i, 'the tooltip names the way out');
      assert.notEqual(chip.color, 'rgba(0, 0, 0, 0)', 'and it is painted, not transparent');
      await page.close();
    });
  }

  test('the mismatch is said out loud, not only tinted', async () => {
    const page = await browser.newPage();
    await page.goto(base, { waitUntil: 'networkidle' });
    const t = await page.evaluate(() => {
      const el = document.querySelector('.wv-toast');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { text: el.textContent, display: getComputedStyle(el).display, w: r.width, h: r.height };
    });
    assert.ok(t, 'a stale instance raises a toast on load');
    assert.notEqual(t.display, 'none', 'and it is displayed, not switched off (Issue #92)');
    assert.ok(t.w > 0 && t.h > 0, `the toast must occupy the screen, got ${t.w}×${t.h}`);
    assert.match(t.text, /aaaaaaa/, 'it names the running commit');
    assert.match(t.text, /bbbbbbb/, 'and the one on disk');
    assert.match(t.text, /restart/i, 'and the way out');
    await page.close();
  });
}
