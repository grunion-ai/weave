import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, settled } from './lib/browser.mjs';

const s = await launch('space icon spacing', (weave) => {
  weave.markOnboarded();
  weave.createSpace({ name: 'Sales', icon: 'lucide:briefcase' });
  weave.createTable({ space: 'Sales', name: 'Deal' });
});

if (s) {
  for (const theme of ['light', 'dark']) {
    for (const width of [1470, 390]) {
      test(`${theme} ${width}: a space name clears its icon (Issue #888)`, async () => {
        const page = await s.browser.newPage({ viewport: { width, height: 844 } });
        try {
          await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
          await page.goto(s.base);
          const link = page.locator('.nav-space').filter({ hasText: 'Sales' });
          await link.waitFor({ state: 'attached' });
          if (width < 600) await page.evaluate(() => document.querySelector('#app').classList.add('nav-peek'));
          await settled(link);
          const gap = await link.evaluate((a) => {
            const range = document.createRange();
            range.selectNodeContents([...a.childNodes].find((n) => n.nodeType === Node.TEXT_NODE));
            const text = range.getBoundingClientRect();
            const icon = a.querySelector('.nav-icon').getBoundingClientRect();
            return { horizontal: text.left - icon.right, centers: Math.abs((text.top + text.bottom - icon.top - icon.bottom) / 2) };
          });
          assert.ok(gap.horizontal >= 5 && gap.horizontal <= 8, JSON.stringify(gap));
          assert.ok(gap.centers <= 2, JSON.stringify(gap));
        } finally { await page.close(); }
      });
    }
  }
}
