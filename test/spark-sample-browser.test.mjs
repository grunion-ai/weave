/* Issue #388, the sparkline half: the formula tray's Sample drew a fixed
   3, 5, 4, 7 … 12 whatever the column held, so a style or a colour could
   not be judged against the field's own data. The Sample now draws the
   series on the first row that holds one, names that row, and every Color
   swatch draws the same series; a column with no list yet draws an example
   under a note that says so. Both themes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let accts;
const s = await launch('sparkline sample', (weave) => {
  weave.createSpace({ name: 'Sales' });
  accts = weave.createTable({ space: 'Sales', name: 'Account' });
  const deals = weave.createTable({ space: 'Sales', name: 'Deal' });
  const notes = weave.createTable({ space: 'Sales', name: 'Note' });
  weave.addField(deals, { name: 'Amount', type: 'number' });
  weave.addField(notes, { name: 'Words', type: 'number' });
  weave.addRelation(deals, { name: 'Account', targetDb: accts, cardinality: 'many-to-one', inverseName: 'Deals' });
  weave.addRelation(notes, { name: 'Account', targetDb: accts, cardinality: 'many-to-one', inverseName: 'Notes' });
  weave.addField(accts, { name: 'Amounts', type: 'lookup', config: { relationField: 'Deals', targetField: 'Amount' } });
  weave.addField(accts, { name: 'Word counts', type: 'lookup', config: { relationField: 'Notes', targetField: 'Words' } });
  weave.addField(accts, { name: 'Trend', type: 'formula', config: { expression: '[Amounts]', display: 'sparkline', color: 'icon' } });
  weave.addField(accts, { name: 'Wordy', type: 'formula', config: { expression: '[Word counts]', display: 'sparkline' } });
  weave.createEntity(accts, { name: 'Quiet' }); // no deals: its list is empty
  const acme = weave.createEntity(accts, { name: 'Acme' });
  for (const amt of [12, 30, 18, 44]) weave.createEntity(deals, { name: `d${amt}`, values: { Amount: amt, Account: acme.id } });
});

if (s) {
  const { base, browser } = s;
  const shots = process.env.WEAVE_SHOT_DIR;
  async function openTray(field, colorScheme) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, colorScheme });
    await page.goto(`${base}/#/table/${accts.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    const th = page.locator('.wv-grid thead th.col-head', { hasText: field }).first();
    await th.hover();
    await th.locator('.field-menu').click();
    await page.locator('.chip-pop .wv-menu-row', { hasText: 'Edit field' }).click();
    await page.waitForSelector('.tray-form');
    return page;
  }
  const own = '4 values, last 44, low 12, high 44';

  for (const colorScheme of ['light', 'dark']) {
    test(`the Sample and the swatches draw the column's own series (${colorScheme})`, async () => {
      const page = await openTray('Trend', colorScheme);
      try {
        await page.waitForSelector('.tray-form .cg-spark-preview .cg-sparkwrap');
        assert.equal(await page.getAttribute('.tray-form .cg-spark-preview .cg-sparkwrap', 'aria-label'), own, 'the first row that holds a list');
        assert.match(await page.textContent('.tray-form .cg-preview-from'), /^Acme: 4 values/);
        assert.equal(await page.locator('.tray-form .cg-preview-note').count(), 0, 'real values are not examples');
        assert.ok(await page.locator('.tray-form .cg-spark-preview .cg-sparkwrap.cg-c-icon').count(), 'in the field\'s colour');
        const swatches = await page.$$eval('.tray-form .wv-color-opt .cg-sparkwrap', (ns) => ns.map((n) => n.getAttribute('aria-label')));
        assert.deepEqual(swatches, [own, own, own]);
        if (shots) await page.locator('#tray').screenshot({ path: `${shots}/spark-sample-${colorScheme}.png` });
      } finally { await page.close(); }
    });
  }

  test('a column with no list yet draws an example series, labelled', async () => {
    const page = await openTray('Wordy', 'light');
    try {
      await page.waitForSelector('.tray-form .cg-spark-preview .cg-sparkwrap');
      assert.notEqual(await page.getAttribute('.tray-form .cg-spark-preview .cg-sparkwrap', 'aria-label'), own);
      assert.match(await page.textContent('.tray-form .cg-preview-note'), /Example series/);
    } finally { await page.close(); }
  });
}
