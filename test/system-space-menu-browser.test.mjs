/* Issue #248 — the space page's ⋮ menu offered "Delete space + N tables" on
   the system Workspace space; holding it only ever produced the engine's
   refusal toast. The sidebar already hides per-table menus for system tables;
   the space page now does the same for the destructive item. The menu once
   also carried one Export row per table; those went (Kyle, 2026-09-26), so a
   system space has nothing left to offer and draws no ⋮ at all. A user space
   keeps its Delete and nothing else. Both themes are checked.
   Playwright is NOT a dependency of weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const s = await launch('system space menu', (weave) => {
  weave.createSpace({ name: 'Product' });
  weave.createTable({ space: 'Product', name: 'Tasks' });
  return { sys: weave.getSpace('Workspace'), user: weave.getSpace('Product') };
});

if (s) {
  const { base, browser, sys, user } = s;
  async function openMenu(spaceId, theme) {
    const page = await browser.newPage();
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/#/space/${spaceId}`);
    await page.waitForSelector('.view-header .dots-btn');
    await page.click('.view-header .dots-btn');
    await page.waitForSelector('.view-header .dl-menu:not(.hidden)');
    const items = await page.locator('.view-header .dl-menu .dropdown-item').allTextContents();
    return { page, items };
  }

  for (const theme of ['light', 'dark']) {
    test(`${theme}: the Workspace space page draws no ⋮ menu`, async () => {
      const page = await browser.newPage();
      await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
      await page.goto(`${base}/#/space/${sys.id}`);
      await page.waitForSelector('.view-header .view-title');
      assert.equal(await page.locator('.view-header .dots-btn').count(), 0, 'no empty menu');
      await page.close();
    });
  }

  test('a user space offers Delete space + N tables and no per-table export', async () => {
    const { page, items } = await openMenu(user.id, 'light');
    assert.ok(!items.some((t) => /^Export /.test(t.trim())), `no exports: ${items}`);
    assert.equal(await page.locator('.view-header .dl-menu .dropdown-divider').count(), 0, 'no divider above a lone item');
    assert.equal(await page.locator('.view-header .dl-menu .hold-btn').count(), 1, 'hold-to-delete present');
    assert.match(await page.locator('.view-header .dl-menu .hold-btn').textContent(), /Delete space \+ 1 table/);
    await page.close();
  });
}
