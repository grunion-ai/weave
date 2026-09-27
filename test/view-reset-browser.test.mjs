/* One system default (Issue #442; Kyle, 2026-09-27: "Default + reset should
   return to showing all fields, no deleted items and no rollup row"). Reset
   view and + Add view share systemDefault(db): every field in schema
   order, no filter, sort or search, no deleted rows, no Σ rollup row,
   Comfortable. Deleted rows and the Σ row are saved per view, so a view
   that shows them keeps them across a switch and a reload, and another
   view does not inherit them. Playwright is NOT a dependency of weave; the
   suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let jobs, gone;
const s = await launch('view reset and the system default', (weave) => {
  weave.createSpace({ name: 'Ops' });
  jobs = weave.createTable({ space: 'Ops', name: 'Job' });
  weave.addField(jobs, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'Done', category: 'done' }] } });
  weave.addField(jobs, { name: 'Cost', type: 'number' });
  weave.addField(jobs, { name: 'Owner', type: 'text' });
  for (const [name, Status, Cost] of [['A', 'Open', 1], ['B', 'Done', 2], ['C', 'Open', 3]]) weave.createEntity(jobs, { name, values: { Status, Cost } });
  gone = weave.createEntity(jobs, { name: 'Gone', values: { Status: 'Open' } });
  weave.deleteEntity(gone.id);
});

if (s) {
  const { base, browser, weave } = s;
  const std = () => weave.tableView(`${jobs.id}/Standard`);
  const open = async (hash = `#/table/${jobs.id}`, theme = 'light') => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: theme });
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    return page;
  };
  const heads = (page) => page.$$eval('.wv-grid thead th .col-label', (hs) => hs.map((h) => h.textContent.trim()));
  const deletedDrawn = (page) => page.locator('.wv-grid tbody tr.entity-row.row-deleted').count();
  const sigmaDrawn = (page) => page.locator('#main tr.wv-foot').count();
  const dirty = () => weave.tableView(`${jobs.id}/Standard`, {
    fields: ['Owner', 'Name'], filters: { Status: ['Open'] }, sort: [{ field: 'Name', dir: 'desc' }],
    widths: { Name: 300 }, frozen: 1, density: 'compact', deleted: true, rollups: true,
  });

  for (const theme of ['light', 'dark']) {
    test(`Reset view returns the view to the system default: every field, no filter, sort or search, no deleted rows, no Σ row, Comfortable (${theme})`, async () => {
      dirty();
      const page = await open(`#/table/${jobs.id}`, theme);
      try {
        assert.ok(await deletedDrawn(page) > 0, 'the dirty view shows its deleted row');
        assert.equal(await sigmaDrawn(page), 1, 'and its Σ row');
        await page.fill('.table-search-input', 'A');
        await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody tr.entity-row').length === 1);
        await page.click('.table-view-btn');
        assert.match(await page.textContent('.table-view-popover .table-control-note'), /deleted rows and the Σ rollup row/);
        await page.click('.view-reset');
        await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody tr.entity-row').length === 3);
        await page.waitForLoadState('networkidle');
        const v = std();
        assert.deepEqual(v.fields, ['Name', 'Description', 'Status', 'Cost', 'Owner'], 'every field, schema order');
        assert.ok(!v.filters && !v.sort && !v.widths && !v.frozen, 'no filter, sort, widths or frozen columns');
        assert.equal(v.density, undefined, 'Comfortable');
        assert.equal(v.deleted, undefined, 'no deleted rows');
        assert.equal(v.rollups, false, 'no Σ row');
        assert.equal(await page.inputValue('.table-search-input'), '', 'no search');
        assert.equal(await deletedDrawn(page), 0);
        assert.equal(await sigmaDrawn(page), 0);
        assert.deepEqual(await heads(page), ['Name', 'Description', 'Status', 'Cost', 'Owner']);
        assert.equal(await page.getAttribute('.wv-grid', 'data-density'), 'comfortable');
        await page.click('.eye-btn');
        assert.equal(await page.locator('.table-fields-popover [data-deleted] input').isChecked(), false, 'Fields: Deleted rows off');
        assert.equal(await page.locator('.table-fields-popover [data-rollups] input').isChecked(), false, 'Fields: Σ rollup row off');
      } finally { await page.close(); }
    });
  }

  test('+ Add view starts from the same system default, whatever the view on screen shows', async () => {
    dirty();
    const page = await open();
    try {
      await page.fill('.table-search-input', 'A');
      await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody tr.entity-row').length === 1);
      await page.click('.table-view-btn');
      await page.click('.view-strip .view-add');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('.table-view-btn')?.textContent.includes('View 2'));
      await page.waitForLoadState('networkidle');
      const made = weave.tableView(`${jobs.id}/View 2`);
      dirty();
      // The dropdown is still open after the create.
      if (!await page.locator('.table-view-popover').isVisible()) await page.click('.table-view-btn');
      await page.click('.view-strip .view-row:has(.view-name:text-is("Standard")) .view-name');
      await page.waitForFunction(() => document.querySelector('.table-view-btn')?.textContent.includes('Standard'));
      if (!await page.locator('.table-view-popover').isVisible()) await page.click('.table-view-btn');
      await page.click('.view-reset');
      await page.waitForLoadState('networkidle');
      const reset = std();
      for (const k of ['fields', 'filters', 'sort', 'widths', 'frozen', 'density', 'deleted', 'rollups']) {
        assert.deepEqual(made[k], reset[k], `New view and Reset view agree on ${k}`);
      }
    } finally {
      for (const v of weave.tableView(jobs).views) if (v.name !== 'Standard') weave.tableView(`${jobs.id}/${v.id}`, { delete: true });
      await page.close();
    }
  });

  test('Deleted rows and the Σ row are saved per view: a switch and a reload keep each view its own', async () => {
    weave.tableView(`${jobs.id}/Standard`, { fields: ['Name', 'Status', 'Cost'], filters: {}, sort: [], widths: { Name: null }, frozen: 0, density: 'comfortable', deleted: false, rollups: false });
    const other = weave.tableView(`${jobs.id}/Audit`, { from: 'Standard' });
    const page = await open(`#/table/${jobs.id}/view/${other.id}`);
    try {
      await page.click('.eye-btn');
      await page.locator('.table-fields-popover [data-deleted] input').check();
      await page.waitForFunction(() => document.querySelector('.wv-grid tbody tr.entity-row.row-deleted'));
      await page.locator('.table-fields-popover [data-rollups] input').check();
      await page.waitForSelector('#main tr.wv-foot');
      await page.waitForLoadState('networkidle');
      assert.equal(weave.tableView(`${jobs.id}/Audit`).deleted, true, 'saved into Audit');
      assert.equal(weave.tableView(`${jobs.id}/Audit`).rollups, true);
      assert.equal(std().deleted, undefined, 'Standard did not move');
      assert.equal(std().rollups, false);
      await page.keyboard.press('Escape');
      await page.click('.table-view-btn');
      await page.click('.view-strip .view-row:has(.view-name:text-is("Standard")) .view-name');
      await page.waitForFunction(() => document.querySelector('.table-view-btn')?.textContent.includes('Standard'));
      await page.waitForLoadState('networkidle');
      assert.equal(await deletedDrawn(page), 0, 'Standard shows no deleted row');
      assert.equal(await sigmaDrawn(page), 0, 'and no Σ row');
      await page.goto(`${base}/#/table/${jobs.id}/view/${other.id}`, { waitUntil: 'networkidle' });
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row.row-deleted');
      assert.equal(await sigmaDrawn(page), 1, 'Audit keeps both after a reload');
    } finally {
      weave.tableView(`${jobs.id}/${other.id}`, { delete: true });
      await page.close();
    }
  });
}
