import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let months;

const s = await launch('the default row term', (weave) => {
  weave.createSpace({ name: 'Money' });
  months = weave.createTable({ space: 'Money', name: 'Month' });
  weave.createEntity(months, { name: 'January' });
  weave.createEntity(months, { name: 'February' });
});

if (s) {
  const { base, browser, weave } = s;

  test('a table built with no term of its own reports row, not record', () => {
    assert.deepEqual(weave.termOf(weave.getTable(months.id)), { singular: 'row', plural: 'rows', set: false });
  });

  for (const theme of ['light', 'dark']) {
    test(`the grid of a table with no term says row in its toolbar, its add row and the rail (${theme})`, async () => {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      await page.goto(`${base}/#/table/${months.id}`, { waitUntil: 'networkidle' });
      await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
      await page.waitForSelector('.wv-grid tbody tr');

      assert.equal(await page.getAttribute('.table-search-input', 'placeholder'), 'Search rows',
        'the toolbar search still offers records');
      assert.equal((await page.textContent('.add-entity-btn')).trim(), '+ New row',
        'the add row still offers a record');
      assert.match(await page.textContent('.nav-stats-line'), /\b\d+ rows\b/,
        'the rail footer still counts records');
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
