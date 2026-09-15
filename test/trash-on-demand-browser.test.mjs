/* The trash list is loaded on demand (Issue #270).
   Opening a table ran `Promise.all([query, trash])`: the trash response for a
   real table was 1.5 MB and a second whole-workspace scan, spent only to
   print "(N)" beside the eyeball's "Deleted rows" switch. The open now costs
   one query that carries `trashCount`; the trash list is asked for only when
   the switch shows the deleted rows. The count must still read in the eye.
   Playwright is NOT a dependency of weave (house rule: zero runtime deps);
   the suite skips when it is absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

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

  test('opening a table fetches no trash list, and the eye still counts the trash', async () => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const calls = [];
    page.on('request', (r) => { if (r.url().includes('/api/tables/')) calls.push(`${r.method()} ${new URL(r.url()).pathname}`); });
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'load' });
    await page.waitForSelector('.eye-btn');
    await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody tr.entity-row').length === 3);
    assert.equal(calls.filter((c) => c.endsWith('/trash')).length, 0, `no trash fetch on open: ${calls.join(', ')}`);
    assert.equal(calls.filter((c) => c.startsWith('POST') && c.endsWith('/query')).length, 1, `one query on open: ${calls.join(', ')}`);

    await page.click('.eye-btn');
    await page.waitForSelector('.chip-pop .eye-row');
    const label = await page.locator('.chip-pop .eye-row .eye-label', { hasText: 'Deleted' }).first().textContent();
    assert.match(label, /\(1\)$/, 'the eyeball still says how many rows are in the trash');

    // Showing the deleted rows is what asks for the list — once.
    calls.length = 0;
    await page.locator('.chip-pop .eye-row', { hasText: 'Deleted' }).first().click();
    await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody tr.entity-row').length === 4);
    assert.equal(calls.filter((c) => c.endsWith('/trash')).length, 1, `one trash fetch when shown: ${calls.join(', ')}`);
    await page.close();
  });
}
