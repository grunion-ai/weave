import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let accts, deals, acme, globex;
const s = await launch('formula sparkline', (weave) => {
  weave.createSpace({ name: 'Sales' });
  accts = weave.createTable({ space: 'Sales', name: 'Account' });
  deals = weave.createTable({ space: 'Sales', name: 'Deal' });
  weave.addField(deals, { name: 'Amount', type: 'number' });
  weave.addField(deals, { name: 'Close', type: 'date' });
  weave.addRelation(deals, { name: 'Account', targetDb: accts, cardinality: 'many-to-one', inverseName: 'Deals' });
  weave.addField(accts, { name: 'Amounts', type: 'lookup', config: { relationField: 'Deals', targetField: 'Amount' } });
  weave.addField(accts, { name: 'Closes', type: 'lookup', config: { relationField: 'Deals', targetField: 'Close' } });
  weave.addField(accts, { name: 'Line', type: 'formula', config: { expression: 'sortby([Amounts], [Closes])', display: 'sparkline' } });
  weave.addField(accts, { name: 'Cols', type: 'formula', config: { expression: 'sortby([Amounts], [Closes])', display: 'sparkline', style: 'column' } });
  weave.addField(accts, { name: 'WinLoss', type: 'formula', config: { expression: 'sortby([Amounts], [Closes])', display: 'sparkline', style: 'winloss' } });
  weave.addField(accts, { name: 'Series', type: 'formula', config: { expression: 'sortby([Amounts], [Closes])' } });
  acme = weave.createEntity(accts, { name: 'Acme' });
  globex = weave.createEntity(accts, { name: 'Globex' });
  for (const [amt, close] of [[40, '2026-03-01'], [10, '2026-01-01'], [-20, '2026-02-01'], [70, '2026-05-01'], [55, '2026-04-01']]) {
    weave.createEntity(deals, { name: `a${close}`, values: { Amount: amt, Close: close, Account: acme.id } });
  }
  for (let i = 0; i < 70; i++) {
    const day = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    weave.createEntity(deals, { name: `g${i}`, values: { Amount: i, Close: day, Account: globex.id } });
  }
  weave.updateField(accts, 'Chip', { config: { fields: ['Line'] } });
});

if (s) {
  const { base, browser, weave } = s;
  const shots = process.env.WEAVE_SHOT_DIR;
  const cell = (id, field) => `tr[data-eid="${id}"] td[data-field="${field}"]`;
  async function grid(tableId, colorScheme = 'light') {
    const page = await browser.newPage({ viewport: { width: 1400, height: 500 }, colorScheme });
    await page.goto(`${base}/#/table/${tableId}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    return page;
  }

  for (const colorScheme of ['light', 'dark']) {
    test(`line, column and win/loss draw the ordered series in the grid (${colorScheme})`, async () => {
      const page = await grid(accts.id, colorScheme);
      try {
        await page.waitForSelector(`${cell(acme.id, 'Line')} .cg-sparkwrap svg path`);
        assert.equal(await page.getAttribute(`${cell(acme.id, 'Line')} .cg-sparkwrap`, 'aria-label'), '5 values, last 70, low -20, high 70');
        assert.equal(await page.getAttribute(`${cell(acme.id, 'Line')} .cg-sparkwrap`, 'title'), '10, -20, 40, 55, 70', 'the hover lists the values in date order');
        assert.equal(await page.locator(`${cell(acme.id, 'Cols')} rect.cg-fill`).count(), 5);
        assert.equal(await page.locator(`${cell(acme.id, 'Cols')} rect.cg-neg`).count(), 1);
        assert.equal(await page.locator(`${cell(acme.id, 'WinLoss')} rect.cg-loss`).count(), 1);
        assert.equal(await page.locator(`${cell(acme.id, 'WinLoss')} rect.cg-win`).count(), 4);
        assert.equal(await page.locator(`${cell(acme.id, 'Series')} svg`).count(), 0, 'no display, no sparkline: the list prints as text');
        assert.equal(await page.$eval(cell(acme.id, 'Line'), (td) => td.classList.contains('clipped')), false, 'a graphic cell is never marked clipped');
        if (shots) await page.locator('.wv-grid').screenshot({ path: `${shots}/sparkline-grid-${colorScheme}.png` });
      } finally { await page.close(); }
    });
  }

  test('a long series draws the newest 60 points and says so on hover', async () => {
    const page = await grid(accts.id);
    try {
      await page.waitForSelector(`${cell(globex.id, 'Cols')} .cg-sparkwrap`);
      assert.equal(await page.locator(`${cell(globex.id, 'Cols')} rect.cg-fill`).count(), 60, 'sixty columns: 10 to 69');
      const title = await page.getAttribute(`${cell(globex.id, 'Cols')} .cg-sparkwrap`, 'title');
      assert.match(title, /\(drawing the last 60 of 70\)$/);
      assert.equal(weave.readEntity(globex.id).raw.Cols.length, 70, 'the API returns every number');
    } finally { await page.close(); }
  });

  test('the chip carries the sparkline', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 500 } });
    try {
      await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      const chip = page.locator('td[data-field="Account"] .k-rel').first();
      await chip.locator('.mention-caret').click();
      await page.waitForSelector('td[data-field="Account"] .mention-f .cg-sparkwrap svg');
    } finally { await page.close(); }
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`the dialog offers the sparkline for a list result, with three styles and a sample (${colorScheme})`, async () => {
      const page = await grid(accts.id, colorScheme);
      try {
        const th = page.locator('.wv-grid thead th.col-head', { hasText: 'Series' }).first();
        await th.hover();
        await th.locator('.field-menu').click();
        await page.locator('.chip-pop .wv-menu-row', { hasText: 'Edit field' }).click();
        const display = page.locator('.tray-form .dlg-sec', { has: page.locator('.dlg-lbl', { hasText: /^Display$/ }) });
        await display.waitFor();
        await display.locator('.seg-opt', { hasText: 'sparkline' }).click();
        const style = page.locator('.tray-form .dlg-sec', { has: page.locator('.dlg-lbl', { hasText: /^Style$/ }) });
        await style.waitFor();
        await page.waitForSelector('.tray-form .cg-spark-preview .cg-spark-line');
        await style.locator('.seg-opt', { hasText: 'win/loss' }).click();
        await page.waitForSelector('.tray-form .cg-spark-preview .cg-spark-winloss');
        if (shots) await page.locator('.tray-form').screenshot({ path: `${shots}/sparkline-dialog-${colorScheme}.png` });
        await page.locator('.tray-form button[type="submit"]').click();
        await page.waitForFunction(() => !document.querySelector('.tray-form'));
        const f = weave.getField(accts, 'Series');
        assert.equal(f.config.display, 'sparkline');
        assert.equal(f.config.style, 'winloss');
        await page.waitForSelector(`${cell(acme.id, 'Series')} .cg-spark-winloss`);
      } finally {
        await page.close();
        weave.updateField(accts, 'Series', { config: { display: 'text', style: null } });
      }
    });
  }
}
