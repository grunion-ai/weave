/* The workspace rail's add button (Issue #191). Its Lucide glyph rode the
   `.wv-icon` margin meant for an icon beside a label, so the plus sat left of
   the button's centre. A stylesheet grep cannot say where a glyph lands; the
   browser can. Both themes, because the rail restyles under dark. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const s = await launch('workspace rail', (weave) => {
  weave.createSpace({ name: 'Product' });
  weave.createTable({ space: 'Product', name: 'Task' });
});

if (s) {
  const { base, browser } = s;
  for (const theme of ['light', 'dark']) {
    test(`the + New workspace glyph sits on the button's centre (${theme})`, async () => {
      const page = await browser.newPage();
      await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
      await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#ws-new svg');
      const seen = await page.evaluate(() => {
        const btn = document.querySelector('#ws-new').getBoundingClientRect();
        const svg = document.querySelector('#ws-new svg').getBoundingClientRect();
        const mid = (r) => [r.left + r.width / 2, r.top + r.height / 2];
        const [bx, by] = mid(btn); const [sx, sy] = mid(svg);
        return { dx: sx - bx, dy: sy - by, theme: document.documentElement.dataset.bsTheme };
      });
      assert.equal(seen.theme, theme, 'the page must be in the theme under test');
      assert.ok(Math.abs(seen.dx) <= 1, `glyph centre is ${seen.dx.toFixed(2)}px off horizontally`);
      assert.ok(Math.abs(seen.dy) <= 1, `glyph centre is ${seen.dy.toFixed(2)}px off vertically`);
      await page.close();
    });
  }
}
