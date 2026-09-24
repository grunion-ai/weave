/* Feature #231 in the page: a rating cell shows `max` icons with the first
   n filled; clicking the nth sets n, clicking the current one clears to 0; on
   the resting cell a digit sets it and Backspace clears it; a screen reader
   hears "3 of 5". A rollup over the rating draws the same icons read-only,
   rounded. The field dialog offers 3, 5 and 7 and the icon picker. Both
   themes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let vendors, accounts, acme, a, b;
const s = await launch('rating field type', (weave) => {
  weave.createSpace({ name: 'Buy' });
  vendors = weave.createTable({ space: 'Buy', name: 'Vendor' });
  accounts = weave.createTable({ space: 'Buy', name: 'Account' });
  weave.addField(vendors, { name: 'Fit', type: 'rating', config: { max: 5, icon: 'lucide:star' } });
  weave.addField(vendors, { name: 'Love', type: 'rating', config: { max: 3, icon: 'lucide:heart' } });
  weave.addRelation(vendors, { name: 'Account', targetDb: accounts, cardinality: 'many-to-one', inverseName: 'Vendors' });
  weave.addField(accounts, { name: 'Avg fit', type: 'rollup', config: { relationField: 'Vendors', targetField: 'Fit', aggregate: 'avg' } });
  acme = weave.createEntity(accounts, { name: 'Acme' });
  a = weave.createEntity(vendors, { name: 'A', values: { Fit: 3, Love: 1, Account: acme.id } });
  b = weave.createEntity(vendors, { name: 'B', values: { Fit: 4, Account: acme.id } });
});

if (s) {
  const { base, browser, weave } = s;
  const shots = process.env.WEAVE_SHOT_DIR;
  const cell = (id, field) => `tr[data-eid="${id}"] td[data-field="${field}"]`;
  const stored = (id, field) => weave.readEntity(id).raw[field];
  async function grid(tableId, colorScheme = 'light') {
    const page = await browser.newPage({ viewport: { width: 1300, height: 600 }, colorScheme });
    await page.goto(`${base}/#/table/${tableId}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    return page;
  }
  const filled = (page, sel) => page.locator(`${sel} .wv-rate-ico.on`).count();
  const label = (page, sel) => page.getAttribute(`${sel} .wv-rating`, 'aria-label');
  const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const patched = (page) => page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/api\/entities\//.test(r.url()));

  for (const colorScheme of ['light', 'dark']) {
    test(`the cell shows max icons with n filled, and a screen reader hears "n of max" (${colorScheme})`, async () => {
      const page = await grid(vendors.id, colorScheme);
      try {
        await page.waitForSelector(`${cell(a.id, 'Fit')} .wv-rating`);
        assert.equal(await page.locator(`${cell(a.id, 'Fit')} .wv-rate-ico`).count(), 5);
        assert.equal(await filled(page, cell(a.id, 'Fit')), 3);
        assert.equal(await label(page, cell(a.id, 'Fit')), '3 of 5');
        assert.equal(await page.locator(`${cell(a.id, 'Love')} .wv-rate-ico`).count(), 3, 'the max is per field');
        assert.equal(await page.locator(`${cell(a.id, 'Love')} .wv-rate-ico svg`).count(), 3, 'the icon is the field\'s, drawn from the inventory');
        assert.equal(await label(page, cell(b.id, 'Love')), 'unrated, of 3');
        const on = await page.$eval(`${cell(a.id, 'Fit')} .wv-rate-ico.on`, (n) => getComputedStyle(n).color);
        const off = await page.$eval(`${cell(a.id, 'Fit')} .wv-rate-ico:not(.on)`, (n) => getComputedStyle(n).color);
        assert.notEqual(on, off, 'filled and empty icons read differently');
        if (shots) await page.locator('.wv-grid').screenshot({ path: `${shots}/rating-grid-${colorScheme}.png` });
      } finally { await page.close(); }
    });
  }

  test('clicking the nth icon sets n; clicking the current one clears to 0', async () => {
    const page = await grid(vendors.id);
    try {
      let landed = patched(page);
      await page.click(`${cell(a.id, 'Fit')} .wv-rate-ico[data-n="5"]`);
      await landed;
      assert.equal(stored(a.id, 'Fit'), 5);
      await page.waitForFunction((sel) => document.querySelectorAll(sel).length === 5, `${cell(a.id, 'Fit')} .wv-rate-ico.on`);
      landed = patched(page);
      await page.click(`${cell(a.id, 'Fit')} .wv-rate-ico[data-n="5"]`);
      await landed;
      assert.equal(stored(a.id, 'Fit'), 0, 'the current value clicked again clears to 0');
      await page.waitForFunction((sel) => document.querySelector(sel)?.getAttribute('aria-label') === '0 of 5', `${cell(a.id, 'Fit')} .wv-rating`);
    } finally {
      await page.close();
      weave.updateEntity(a.id, { Fit: 3 });
    }
  });

  test('on the resting cell a digit sets the rating and Backspace clears it', async () => {
    const page = await grid(vendors.id);
    try {
      await page.focus(cell(b.id, 'Fit'));
      let landed = patched(page);
      await page.keyboard.press('2');
      await landed;
      assert.equal(stored(b.id, 'Fit'), 2);
      await settle(page);
      await page.waitForFunction((sel) => document.querySelector(sel)?.getAttribute('aria-label') === '2 of 5', `${cell(b.id, 'Fit')} .wv-rating`);
      await page.focus(cell(b.id, 'Fit'));
      landed = patched(page);
      await page.keyboard.press('9');
      await landed;
      assert.equal(stored(b.id, 'Fit'), 5, 'a digit past the max sets the max');
      await settle(page);
      await page.focus(cell(b.id, 'Fit'));
      landed = patched(page);
      await page.keyboard.press('Backspace');
      await landed;
      assert.equal(stored(b.id, 'Fit'), 0);
      assert.equal(await page.locator(`${cell(b.id, 'Fit')} input`).count(), 0, 'no text box ever opened');
    } finally {
      await page.close();
      weave.updateEntity(b.id, { Fit: 4 });
    }
  });

  test('a rollup over a rating draws the same icons, read-only, rounded', async () => {
    const page = await grid(accounts.id);
    try {
      await page.waitForSelector(`${cell(acme.id, 'Avg fit')} .wv-rating`);
      assert.equal(await filled(page, cell(acme.id, 'Avg fit')), 4, 'an average of 3.5 fills four');
      assert.equal(await label(page, cell(acme.id, 'Avg fit')), '4 of 5');
      assert.equal(await page.locator(`${cell(acme.id, 'Avg fit')} .wv-rating button`).count(), 0, 'no buttons: read-only');
      assert.equal(weave.readEntity(acme.id).raw['Avg fit'], 3.5, 'the API keeps the figure');
    } finally { await page.close(); }
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`the field dialog makes a rating: presets, the icon picker and a sample (${colorScheme})`, async () => {
      const page = await grid(vendors.id, colorScheme);
      try {
        await page.click('.wv-grid .add-field-btn');
        await page.waitForSelector('.tray-form');
        await page.fill('.tray-form input[name="name"]', `Quality ${colorScheme}`);
        await page.locator('.tray-form .type-tile', { hasText: 'rating' }).click();
        const max = page.locator('.tray-form .dlg-sec', { has: page.locator('.dlg-lbl', { hasText: /^Max$/ }) });
        await max.locator('.seg-opt', { hasText: '7' }).click();
        await page.waitForFunction(() => document.querySelectorAll('.tray-form .wv-rating-sample .wv-rate-ico').length === 7);
        await page.click('.tray-form .wv-rating-icon');
        await page.fill('.picker-pop input', 'heart');
        await page.locator('.picker-pop .picker-cell[aria-label="heart"]').first().click();
        await page.waitForFunction(() => document.querySelector('.tray-form .wv-rating-icon')?.textContent.includes('heart'));
        if (shots) await page.locator('.tray-form').screenshot({ path: `${shots}/rating-dialog-${colorScheme}.png` });
        await page.locator('.tray-form button[type="submit"]').click();
        await page.waitForFunction(() => !document.querySelector('.tray-form'));
        const f = weave.getField(vendors, `Quality ${colorScheme}`);
        assert.equal(f.type, 'rating');
        assert.deepEqual(f.config, { max: 7, icon: 'lucide:heart' });
        await page.waitForSelector(`${cell(a.id, `Quality ${colorScheme}`)} .wv-rating`);
        assert.equal(await page.locator(`${cell(a.id, `Quality ${colorScheme}`)} .wv-rate-ico`).count(), 7);
      } finally {
        await page.close();
        try { weave.deleteField(vendors, `Quality ${colorScheme}`); } catch { /* not created */ }
      }
    });
  }
}
