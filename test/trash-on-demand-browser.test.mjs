import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { openPane } from './lib/view-pane.mjs';

let deals;
const s = await launch('trash list on demand', (weave) => {
  weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deal' });
  for (const name of ['Acme', 'Globex', 'Initech']) weave.createEntity(deals, { name });
  const gone = weave.createEntity(deals, { name: 'Umbrella' });
  weave.deleteEntity(gone.id);
});

if (s) {
  const { base, browser } = s;

  test('opening a table fetches no trash list, and the Filters switch counts the trash and shows it in one query', async () => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const calls = [];
    page.on('request', (r) => { if (r.url().includes('/api/tables/')) calls.push(`${r.method()} ${new URL(r.url()).pathname}`); });
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'load' });
    await page.waitForSelector('.table-view-btn');
    await page.waitForLoadState('networkidle');
    assert.equal(calls.filter((c) => c.endsWith('/trash')).length, 0, `no trash fetch on open: ${calls.join(', ')}`);
    assert.equal(calls.filter((c) => c.startsWith('POST') && c.endsWith('/query')).length, 1, `one query on open: ${calls.join(', ')}`);
    await openPane(page, 'filters');
    const label = await page.locator('#view-pane label[data-deleted]').textContent();
    assert.match(label, /\b1 in the trash/, 'the switch still says how many rows are in the trash');
    calls.length = 0;
    await page.locator('#view-pane label[data-deleted]').click();
    await page.waitForFunction(() => document.querySelector('.wv-grid tbody tr.row-deleted'));
    assert.equal(calls.filter((c) => c.endsWith('/trash')).length, 0, `the deleted rows ride the one query: ${calls.join(', ')}`);
    assert.equal(calls.filter((c) => c.startsWith('POST') && c.endsWith('/query')).length, 1, calls.join(', '));
    await page.close();
  });
}
