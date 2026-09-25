/* Issue #320: "visibility toggle dialog doesn't close on icon click".
   showPopover's outside-click listener runs in the capture phase and counted
   the trigger itself as outside, so a second click on the eye closed the
   popover and that same click's own handler opened a fresh one: the dialog
   never closed. The trigger now toggles its popover. After a flip the eye is
   redrawn as a new node, so the eye's popover recognises the replacement too;
   a click on a DIFFERENT trigger (the docked entity's eye, another column's
   ⋮) still switches popovers in one click, and Escape and a genuine outside
   click still close. Playwright is NOT a dependency; the suite skips when it
   is absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

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
  // A close that the same click undoes lands within a frame or two; give it
  // two frames and a beat before reading.
  const settle = (page) => page.evaluate(() => new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 50)))));
  const table = async (theme) => {
    weave.updateTable(deals, { hiddenFields: [] });
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector('#main .eye-btn');
    return page;
  };

  for (const theme of ['light', 'dark']) {
    test(`a second click on the eye closes its popover, and a third opens it (${theme})`, async () => {
      const page = await table(theme);
      await page.click('#main .eye-btn');
      await page.waitForSelector('.chip-pop .eye-row');
      await page.click('#main .eye-btn');
      await settle(page);
      assert.equal(await isOpen(page), false, 'the second click closed the popover and it stayed closed');
      await page.click('#main .eye-btn');
      await page.waitForSelector('.chip-pop .eye-row');
      assert.equal(await page.evaluate(() => document.querySelectorAll('.chip-pop').length), 1, 'one popover, open');
      await page.close();
    });

    test(`Escape and a genuine outside click still close, and the eye reopens after either (${theme})`, async () => {
      const page = await table(theme);
      await page.click('#main .eye-btn');
      await page.waitForSelector('.chip-pop .eye-row');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.chip-pop'));
      // Escape leaves the capture listener hooked until the next click; that
      // click must open the eye, not be swallowed as a "close".
      await page.click('#main .eye-btn');
      await page.waitForSelector('.chip-pop .eye-row');
      await page.mouse.click(4, 4);
      await settle(page);
      assert.equal(await isOpen(page), false, 'an outside click closed the popover');
      await page.click('#main .eye-btn');
      await page.waitForSelector('.chip-pop .eye-row');
      await page.close();
    });

    test(`after a flip redraws the eye, a click on the new eye still closes (${theme})`, async () => {
      const page = await table(theme);
      await page.click('#main .eye-btn');
      await page.waitForSelector('.chip-pop .eye-row');
      await page.evaluate(() => { document.querySelector('#main .eye-btn').dataset.stamp = 'old'; });
      await page.locator('.chip-pop .eye-row', { hasText: 'Stage' }).first().click();
      await page.waitForFunction(() => [...document.querySelectorAll('.chip-pop .eye-row')]
        .find((r) => r.querySelector('.eye-label')?.textContent === 'Stage')?.getAttribute('aria-checked') === 'false');
      await page.waitForFunction(() => !document.querySelector('#main .eye-btn').dataset.stamp);
      await page.click('#main .eye-btn');
      await settle(page);
      assert.equal(await isOpen(page), false, 'the redrawn eye closed the popover');
      await page.close();
    });
  }

  test("with the table's popover open, the docked entity's eye switches to its own in one click", async () => {
    const page = await table('light');
    await page.click(`tr[data-eid="${acme.id}"] .open-link`);
    await page.waitForSelector('#dock:not([hidden]) .eye-btn');
    await page.click('#main .eye-btn');
    await page.waitForSelector('.chip-pop .eye-row');
    // The table's eye carries the Rows section; the entity's does not.
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('.chip-pop .eye-head')].some((h) => h.textContent === 'Rows')));
    await page.click('#dock .eye-btn');
    await settle(page);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.chip-pop').length), 1, 'one popover open');
    assert.ok(await page.evaluate(() => ![...document.querySelectorAll('.chip-pop .eye-head')].some((h) => h.textContent === 'Rows')),
      "it is the entity's popover");
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
