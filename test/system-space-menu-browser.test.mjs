/* Issue #248 — the space page's ⋮ menu offered "Delete space + N tables" on
   the system Workspace space; holding it only ever produced the engine's
   refusal toast. The sidebar already hides per-table menus for system tables;
   the space page now does the same for the destructive item, leaving the
   Export items. A user space keeps its Delete. Both themes are checked.
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
    test(`${theme}: the Workspace space menu has only its Export items, no Delete`, async () => {
      const { page, items } = await openMenu(sys.id, theme);
      assert.ok(items.length >= 4, `one export per system table: ${items}`);
      assert.ok(items.every((t) => /^Export .*\.csv$/.test(t.trim())), `only exports: ${items}`);
      assert.equal(await page.locator('.view-header .dl-menu .hold-btn').count(), 0, 'no hold-to-delete');
      assert.equal(await page.locator('.view-header .dl-menu .dropdown-divider').count(), 0, 'no divider before a missing item');
      await page.close();
    });
  }

  test('a user space still offers Delete space + N tables', async () => {
    const { page, items } = await openMenu(user.id, 'light');
    assert.ok(items.some((t) => /Export Tasks\.csv/.test(t)), `export present: ${items}`);
    assert.equal(await page.locator('.view-header .dl-menu .hold-btn').count(), 1, 'hold-to-delete present');
    assert.match(await page.locator('.view-header .dl-menu .hold-btn').textContent(), /Delete space \+ 1 table/);
    await page.close();
  });
}
