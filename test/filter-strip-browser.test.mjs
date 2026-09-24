/* The filter strip coalesces a burst of chip clicks (Issue #269). Each chip
   click used to PATCH the table, re-read the schema and re-query the grid on
   its own, and every click after the first read the selection the strip was
   drawn with — so three quick clicks were three round-trips and the table
   kept only the last chip. A burst now paints each chip at once, lands as
   one PATCH and one query, and the rows are the ones the engine's
   where-language returns for the whole selection. The strip still filters
   on the server, never client-side (Feature #38).
   Playwright is NOT a dependency of weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tasks;
const s = await launch('filter strip coalescing', (weave) => {
  weave.createSpace({ name: 'Ops' });
  tasks = weave.createTable({ space: 'Ops', name: 'Job' });
  weave.addField(tasks, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'Doing', category: 'in-progress' },
    { name: 'Done', category: 'done' }] } });
  for (const [name, Status] of [['A', 'Open'], ['B', 'Doing'], ['C', 'Done'], ['D', 'Open'], ['E', 'Done'], ['F', 'Doing']]) {
    weave.createEntity(tasks, { name, values: { Status } });
  }
});

if (s) {
  const { base, browser, weave } = s;

  test('a burst of chip clicks is one PATCH and one query, and keeps every chip', async () => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    try {
      await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      const hits = { query: 0, patch: 0 };
      page.on('request', (r) => {
        if (r.method() === 'POST' && r.url().endsWith(`/tables/${tasks.id}/query`)) hits.query++;
        // The strip saves into the view on screen (Feature #229).
        if (r.method() === 'PATCH' && r.url().includes(`/tables/${tasks.id}/views/`)) hits.patch++;
      });
      // Three clicks in one task: Open on, Doing on, Done on then off again.
      const painted = await page.evaluate(() => {
        const chip = (name) => [...document.querySelectorAll('.filter-strip .filter-chip')].find((b) => b.textContent === name);
        for (const name of ['Open', 'Doing', 'Done', 'Done']) chip(name).click();
        return ['Open', 'Doing', 'Done'].map((name) => chip(name).classList.contains('on'));
      });
      assert.deepEqual(painted, [true, true, false], 'each click paints its chip at once');
      await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody tr.entity-row').length === 4);
      await page.waitForLoadState('networkidle');
      assert.equal(hits.patch, 1, 'one PATCH for the burst');
      assert.equal(hits.query, 1, 'one table query for the burst');
      assert.deepEqual(weave.tableView(tasks).views[0].filters, { Status: ['Open', 'Doing'] }, 'no click was lost');
      const shown = await page.$$eval('.wv-grid tbody tr.entity-row', (rs) => rs.map((r) => r.dataset.eid).sort());
      const server = weave.query(tasks, { where: [['Status', 'in', ['Open', 'Doing']]] }).items.map((e) => e.id).sort();
      assert.deepEqual(shown, server, 'the grid shows what the engine returns for the selection');
      const on = await page.$$eval('.filter-strip .filter-chip.on', (bs) => bs.map((b) => b.textContent).sort());
      assert.deepEqual(on, ['Doing', 'Open'], 'the redrawn strip wears the saved selection');
    } finally {
      weave.updateTable(tasks, { filters: {} });
      await page.close();
    }
  });

  test('a click just before leaving the table saves the filter and does not pull the reader back', async () => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    try {
      await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(`/tables/${tasks.id}/views/`));
      await page.evaluate(() => {
        [...document.querySelectorAll('.filter-strip .filter-chip')].find((b) => b.textContent === 'Done').click();
        location.hash = '#/';
      });
      await saved;
      await page.waitForLoadState('networkidle');
      assert.deepEqual(weave.tableView(tasks).views[0].filters, { Status: ['Done'] }, 'the click was saved');
      assert.equal(await page.evaluate(() => location.hash), '#/', 'the reader stays where they went');
      assert.equal(await page.locator('.filter-strip').count(), 0, 'the table was not drawn over the new page');
    } finally {
      weave.updateTable(tasks, { filters: {} });
      await page.close();
    }
  });
}
