import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, PHONE, phoneBrowser, phonePage } from './lib/browser.mjs';

let tasks, task;
const s = await launch('route skeleton', (weave) => {
  weave.createSpace({ name: 'Product' });
  tasks = weave.createTable({ space: 'Product', name: 'Task' });
  task = weave.createEntity(tasks, { name: 'Wire Stripe webhooks' });
  for (let i = 0; i < 20; i++) weave.createEntity(tasks, { name: `Task ${i}` });
});

if (s) {
  const { base, browser } = s;

  for (const width of [undefined, 1200]) {
    test(`a table that drew before the skeleton was due keeps its rows while the docked record still loads (${width ? `${width}px` : `${PHONE} profile`}, Issue #713)`, async () => {
      const page = width ? await browser.newPage({ viewport: { width, height: 844 } }) : await phonePage(await phoneBrowser());
      try {
        await page.route(`**/api/entities/${task.id}**`, async (route) => {
          await new Promise((r) => setTimeout(r, 700));
          await route.continue();
        });
        await page.goto(`${base}/#/table/${tasks.id}?e=${task.id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('#dock textarea.name-edit');
        assert.equal(await page.locator('#main .sk').count(), 0, 'no skeleton painted over the drawn table');
        assert.ok(await page.locator('#main .wv-grid tbody tr.entity-row').count() > 0, 'the rows are on screen');
        if (!width) assert.equal(await page.locator('#main .nav-menu').count(), 1, 'the phone menu button is there');
      } finally { await page.close(); }
    });
  }
}
