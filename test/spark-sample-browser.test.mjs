import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let accts, regions;
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
  weave.createEntity(accts, { name: 'Quiet' });
  const acme = weave.createEntity(accts, { name: 'Acme' });
  for (const amt of [12, 30, 18, 44]) weave.createEntity(deals, { name: `d${amt}`, values: { Amount: amt, Account: acme.id } });
  regions = weave.createTable({ space: 'Sales', name: 'Region' });
  const sales = weave.createTable({ space: 'Sales', name: 'Sale' });
  weave.addField(sales, { name: 'Total', type: 'number' });
  weave.addRelation(sales, { name: 'Region', targetDb: regions, cardinality: 'many-to-one', inverseName: 'Sales' });
  weave.addField(regions, { name: 'Totals', type: 'lookup', config: { relationField: 'Sales', targetField: 'Total' } });
  weave.addField(regions, { name: 'Late', type: 'formula', config: { expression: '[Totals]', display: 'sparkline' } });
  for (let i = 1; i <= 60; i++) weave.createEntity(regions, { name: `r${i}` });
  const west = weave.createEntity(regions, { name: 'West' });
  for (const t of [5, 9, 7]) weave.createEntity(sales, { name: `s${t}`, values: { Total: t, Region: west.id } });
});

if (s) {
  const { base, browser } = s;
  const shots = process.env.WEAVE_SHOT_DIR;
  async function openTray(field, colorScheme, table = accts) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, colorScheme });
    await page.goto(`${base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
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

  test('the first list past row 50 is still found (Issue #620)', async () => {
    const page = await openTray('Late', 'light', regions);
    try {
      await page.waitForSelector('.tray-form .cg-preview-from');
      assert.match(await page.textContent('.tray-form .cg-preview-from'), /^West: 3 values/);
      assert.equal(await page.locator('.tray-form .cg-preview-note').count(), 0, 'no "no row holds a list"');
    } finally { await page.close(); }
  });
}
