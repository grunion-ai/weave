import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tasks;
const s = await launch('grid busy', (weave) => {
  weave.createSpace({ name: 'Product' });
  tasks = weave.createTable({ space: 'Product', name: 'Task' });
  weave.addField(tasks, { name: 'Status', type: 'select', config: { options: ['Open', 'Done'] } });
  for (let i = 0; i < 12; i++) weave.createEntity(tasks, { name: `Task ${i}`, values: { Status: 'Open' } });
});

if (s) {
  const { base, browser } = s;
  const BUSY = '#main > .table-wrap[aria-busy="true"]';

  const openGrid = async ({ hold = 0 } = {}) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    if (hold) {
      await page.route('**/api/**', async (route) => {
        await new Promise((done) => setTimeout(done, hold));
        await route.continue().catch(() => {});
      });
    }
    await page.evaluate(() => {
      window.__busy = [];
      window.__acted = 0;
      new MutationObserver((records) => {
        for (const r of records) {
          if (!r.target.classList?.contains('table-wrap')) continue;
          window.__busy.push({ v: r.target.getAttribute('aria-busy'), after: Math.round(performance.now() - window.__acted) });
        }
      }).observe(document.querySelector('#main'), { attributes: true, attributeFilter: ['aria-busy'], subtree: true });
    });
    return page;
  };

  const searchFor = async (page, text) => {
    await page.evaluate(() => { window.__acted = performance.now(); });
    await page.locator('.table-search-input').fill(text);
  };

  test('a search the grid answers inside the loader delay never marks it busy (Issue #1062)', async () => {
    const page = await openGrid();
    try {
      await searchFor(page, 'Task 1');
      await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody tr.entity-row').length === 3);
      await page.waitForTimeout(900);
      const said = (await page.evaluate(() => window.__busy)).filter((b) => b.v === 'true');
      assert.deepEqual(said, [], 'an action that settles before the loader shows announces no wait at all');
    } finally { await page.close(); }
  });

  test('a search the grid makes the reader wait for is marked busy once, and clears when it answers (Issue #1062)', async () => {
    const page = await openGrid({ hold: 1000 });
    try {
      await searchFor(page, 'Task 1');
      await page.waitForSelector(BUSY, { timeout: 5000 });
      await page.waitForSelector(BUSY, { state: 'detached', timeout: 10000 });
      const busy = await page.evaluate(() => window.__busy);
      const said = busy.find((b) => b.v === 'true');
      assert.ok(said, 'the wait is announced');
      assert.ok(said.after >= 400, `the announcement waits for the loader delay, not ${said.after} ms`);
      assert.notEqual(busy.at(-1).v, 'true', 'and is taken back when the grid answers');
    } finally { await page.close(); }
  });
}
