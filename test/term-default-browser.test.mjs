import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let months;

const s = await launch('the default record term', (weave) => {
  weave.createSpace({ name: 'Money' });
  months = weave.createTable({ space: 'Money', name: 'Month' });
  weave.createEntity(months, { name: 'January' });
  weave.createEntity(months, { name: 'February' });
});

if (s) {
  const { base, browser, weave } = s;

  test('a table built with no term of its own reports record, not row', () => {
    assert.deepEqual(weave.termOf(weave.getTable(months.id)), { singular: 'record', plural: 'records', set: false });
  });

  for (const theme of ['light', 'dark']) {
    test(`the grid of a table with no term says record in its toolbar and its add row (${theme})`, async () => {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      await page.goto(`${base}/#/table/${months.id}`, { waitUntil: 'networkidle' });
      await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
      await page.waitForSelector('.wv-grid tbody tr');

      assert.equal(await page.getAttribute('.table-search-input', 'placeholder'), 'Search records',
        'the toolbar search still offers rows');
      assert.equal((await page.textContent('.add-entity-btn')).trim(), '+ New record',
        'the add row still offers a row');
      await page.close();
    });
  }

  test('a table that names its own term keeps it', async () => {
    const deals = weave.createTable({ space: 'Money', name: 'Deal' });
    weave.updateTable(deals, { noun: 'deal' });
    weave.createEntity(deals, { name: 'Acme' });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr');
    assert.equal(await page.getAttribute('.table-search-input', 'placeholder'), 'Search deals');
    assert.equal((await page.textContent('.add-entity-btn')).trim(), '+ New deal');
    await page.close();
  });
}
