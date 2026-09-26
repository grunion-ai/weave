/* Issue #248 — the space page's ⋮ menu offered "Delete space + N tables" on
   the system Workspace space; holding it only ever produced the engine's
   refusal toast. The sidebar already hides per-table menus for system tables;
   the space page now does the same for the destructive item. A user space
   keeps its Delete. Both themes are checked.
   Issue #373 — the menu also listed one "Export <Table>.csv" per table, which
   act on tables, not the space. Those are gone, so the system space has
   nothing left to offer and renders no ⋮ at all; a user space holds only its
   Delete.
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
  async function openSpace(spaceId, theme) {
    const page = await browser.newPage();
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/#/space/${spaceId}`);
    await page.waitForSelector('.view-header h1, .view-header .view-title');
    return page;
  }
  async function openMenu(spaceId, theme) {
    const page = await openSpace(spaceId, theme);
    await page.waitForSelector('.view-header .dots-btn');
    await page.click('.view-header .dots-btn');
    await page.waitForSelector('.view-header .dl-menu:not(.hidden)');
    const items = await page.locator('.view-header .dl-menu .dropdown-item').allTextContents();
    return { page, items };
  }

  for (const theme of ['light', 'dark']) {
    test(`${theme}: the Workspace space renders no ⋮ menu`, async () => {
      const page = await openSpace(sys.id, theme);
      assert.equal(await page.locator('.view-header .dots-btn').count(), 0, 'no ⋮ on the system space');
      assert.equal(await page.locator('.view-header .dl-menu').count(), 0, 'no empty menu panel');
      await page.close();
    });

    test(`${theme}: a user space offers only Delete space + N tables`, async () => {
      const { page, items } = await openMenu(user.id, theme);
      assert.ok(!items.some((t) => /Export .*\.csv/.test(t)), `no per-table export: ${items}`);
      assert.equal(await page.locator('.view-header .dl-menu .dropdown-divider').count(), 0, 'no divider');
      assert.equal(await page.locator('.view-header .dl-menu .hold-btn').count(), 1, 'hold-to-delete present');
      assert.match(await page.locator('.view-header .dl-menu .hold-btn').textContent(), /Delete space \+ 1 table/);
      await page.close();
    });
  }
}
