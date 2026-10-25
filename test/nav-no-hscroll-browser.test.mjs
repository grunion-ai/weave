import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, settled } from './lib/browser.mjs';
const s = await launch('nav horizontal overflow', (weave) => {
  weave.markOnboarded();
  weave.createSpace({ name: 'Stack', icon: 'lucide:layers' });
  weave.createTable({ space: 'Stack', name: 'Identity' });
  weave.createTable({ space: 'Stack', name: 'Credential locations and rotation log for every vendor' });
  weave.createTable({ space: 'Stack', name: 'Supercalifragilisticexpialidociousregistry' });
});
if (s) {
  for (const theme of ['light', 'dark']) {
    test(`${theme}: the left nav never scrolls sideways`, async () => {
      const page = await s.browser.newPage({ viewport: { width: 1470, height: 844 } });
      try {
        await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
        await page.goto(s.base);
        const row = page.locator('.nav-db').filter({ hasText: 'Identity' });
        await row.waitFor({ state: 'attached' });
        await row.hover();
        await settled(row);
        const box = await page.evaluate(() => {
          const nav = document.getElementById('nav');
          const right = nav.getBoundingClientRect().right;
          const wide = [...nav.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > right + 0.5).map((e) => `${e.tagName}.${e.className}`);
          return { scroll: nav.scrollWidth, client: nav.clientWidth, wide };
        });
        assert.ok(box.scroll <= box.client, JSON.stringify(box));
        const long = page.locator('.nav-db').filter({ hasText: 'Supercali' });
        const clipped = await long.evaluate((a) => a.getBoundingClientRect().right <= document.getElementById('nav').getBoundingClientRect().right);
        assert.ok(clipped);
      } finally { await page.close(); }
    });
  }
}
