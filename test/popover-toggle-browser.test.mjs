import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { openPane } from './lib/view-pane.mjs';

let deals, acme;
const s = await launch('popover toggle', (weave) => {
  weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deal' });
  weave.addField(deals, { name: 'Amount', type: 'number' });
  weave.addField(deals, { name: 'Stage', type: 'text' });
  acme = weave.createEntity(deals, { name: 'Acme', values: { Amount: 12 } });
});

if (s) {
  const { base, browser, weave } = s;
  const isOpen = (page) => page.evaluate(() => !!document.querySelector('.chip-pop'));
  const settle = (page) => page.evaluate(() => new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50)))));
  const table = async (theme) => {
    weave.updateTable(deals, { hiddenFields: [] });
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector('#main .table-view-btn');
    return page;
  };

  const paneOpen = (page) => page.evaluate(() => !document.querySelector('#view-pane').hidden);
  for (const theme of ['light', 'dark']) {
    test(`a second click on View closes its pane, and a third opens it (${theme})`, async () => {
      const page = await table(theme);
      await page.click('#main .table-view-btn');
      await page.waitForSelector('#view-pane:not([hidden]) .vp-acc');
      await page.click('#main .table-view-btn');
      await settle(page);
      assert.equal(await paneOpen(page), false, 'the second click closed the pane and it stayed closed');
      await page.click('#main .table-view-btn');
      await page.waitForSelector('#view-pane:not([hidden]) .vp-acc');
      assert.equal(await isOpen(page), false, 'the pane is a panel, not a popover');
      await page.close();
    });

    test(`Escape and an outside click leave the pane open; its close button shuts it and View reopens it (${theme})`, async () => {
      const page = await table(theme);
      await openPane(page, 'fields');
      await page.keyboard.press('Escape');
      await page.mouse.click(4, 4);
      await settle(page);
      assert.equal(await paneOpen(page), true, 'the pane stays beside the table');
      await page.click('#view-pane .vp-close');
      await settle(page);
      assert.equal(await paneOpen(page), false, 'the close button shut it');
      assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('table-view-btn')), true, 'focus went back to View');
      await page.click('#main .table-view-btn');
      await page.waitForSelector('#view-pane:not([hidden]) .eye-row');
      await page.close();
    });

    test(`after a flip redraws the grid, the View button keeps its node and still closes the pane (${theme})`, async () => {
      const page = await table(theme);
      await openPane(page, 'fields');
      await page.evaluate(() => { document.querySelector('#main .table-view-btn').dataset.stamp = 'old'; });
      await page.locator('#view-pane .eye-row', { hasText: 'Stage' }).first().click();
      await page.waitForFunction(() => [...document.querySelectorAll('#view-pane .eye-row')]
        .find((r) => r.querySelector('.eye-label')?.textContent === 'Stage')?.matches(':has(input:checked), [aria-checked="true"]') === false);
      await page.waitForFunction(() => ![...document.querySelectorAll('.wv-grid .col-label')].some((h) => h.textContent.trim() === 'Stage'));
      await page.waitForLoadState('networkidle');
      assert.equal(await page.evaluate(() => document.querySelector('#main .table-view-btn').dataset.stamp), 'old', 'the button kept its node');
      await page.click('#main .table-view-btn');
      await settle(page);
      assert.equal(await paneOpen(page), false, 'View closed the pane');
      await page.close();
    });
  }

  test("with the View pane open, the docked entity's eye opens its own popover and shuts it again", async () => {
    const page = await table('light');
    await page.click(`tr[data-eid="${acme.id}"] .open-link`);
    await page.waitForSelector('#dock:not([hidden]) .eye-btn');
    await openPane(page, 'fields');
    await page.click('#dock .eye-btn');
    await page.waitForSelector('.chip-pop .eye-row');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.chip-pop').length), 1, 'one popover open');
    assert.equal(await paneOpen(page), true, 'the pane stays');
    await page.click('#dock .eye-btn');
    await settle(page);
    assert.equal(await isOpen(page), false, "the entity's eye closes its own popover");
    await page.close();
  });

  test("a column's ⋮ toggles its menu, and another column's ⋮ switches in one click", async () => {
    const page = await table('dark');
    const menu = (name) => `#main .wv-grid thead th:has(.field-menu[aria-label="Configure field ${name}"]) .field-menu`;
    await page.locator(menu('Amount')).click({ force: true });
    await page.waitForSelector('.chip-pop .wv-menu-title');
    await page.locator(menu('Amount')).click({ force: true });
    await settle(page);
    assert.equal(await isOpen(page), false, 'the second click on ⋮ closed its menu');
    await page.locator(menu('Amount')).click({ force: true });
    await page.waitForSelector('.chip-pop .wv-menu-title');
    await page.locator(menu('Stage')).click({ force: true });
    await settle(page);
    assert.equal(await page.evaluate(() => document.querySelector('.chip-pop .wv-menu-title')?.textContent), 'Stage',
      "the other column's menu opened in one click");
    await page.close();
  });
}
