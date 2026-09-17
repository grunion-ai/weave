/* Issue #274 — an open tab drew fresh rows against a stale schema.

   The repro, as filed: a tab sits on a grid, something else (the CLI, an
   agent over MCP, an automation, a second tab) recolours a select's options,
   and the tab keeps rendering `hue-slate` through every hash navigation until
   someone hits reload. Feature #33's focus listener covered the second-tab
   case only, because refocusing the window is what a person does after
   editing in ANOTHER tab — nobody refocuses after an agent writes.

   The tab now learns the schema moved from the query it was already making:
   every API response stamps the structure's fingerprint, and a stamp the tab
   has not seen refetches the schema and redraws. Playwright is NOT a
   dependency; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const AMBER = '#f59f00';

let deals;
let notes;
const s = await launch('stale schema', (weave) => {
  weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deals' });
  notes = weave.createTable({ space: 'Sales', name: 'Notes' });
  weave.addField('Sales/Deals', { name: 'Stage', type: 'select', config: { options: [{ name: 'Open', color: '' }] } });
  weave.createEntity('Sales/Deals', { Name: 'Acme', Stage: 'Open' });
  return { deals, notes };
});

if (s) {
  const { base, browser, weave } = s;

  test('a field recoloured elsewhere reaches an open tab on its next navigation, with no reload', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    assert.equal(await page.locator('.wv-grid .k-select.hue-slate').count(), 1, 'the option starts uncoloured');

    // The page must survive: a reload would fix the bug by accident.
    await page.evaluate(() => { window.__sameDocument = true; });

    // Somewhere else entirely — an agent, the CLI, an automation.
    weave.updateField('Sales/Deals', 'Stage', { config: { options: [{ name: 'Open', color: AMBER }] } });

    // Hash routing only: table → table, no reload.
    await page.evaluate((id) => { location.hash = `#/table/${id}`; }, notes.id);
    await page.waitForSelector('.wv-grid');
    await page.evaluate((id) => { location.hash = `#/table/${id}`; }, deals.id);
    await page.waitForSelector('.wv-grid tbody tr.entity-row');

    await page.waitForSelector('.wv-grid .k-select.hue-amber', { timeout: 5000 });
    assert.equal(await page.locator('.wv-grid .k-select.hue-slate').count(), 0, 'nothing is left on the old hue');
    assert.equal(await page.evaluate(() => window.__sameDocument), true, 'the tab never reloaded');
    await page.close();
  });

  test('a column added elsewhere appears on the next navigation', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    assert.equal(await page.locator('.wv-grid th:has-text("Owner")').count(), 0, 'no such column yet');

    weave.addField('Sales/Deals', { name: 'Owner', type: 'text' });

    await page.evaluate((id) => { location.hash = `#/table/${id}`; }, notes.id);
    await page.waitForSelector('.wv-grid');
    await page.evaluate((id) => { location.hash = `#/table/${id}`; }, deals.id);
    await page.waitForSelector('.wv-grid th:has-text("Owner")', { timeout: 5000 });
    await page.close();
  });

  test('a tab whose schema has not moved does not refetch it', async () => {
    const page = await browser.newPage();
    const schemaCalls = [];
    page.on('request', (r) => { if (r.url().endsWith('/api/schema')) schemaCalls.push(r.url()); });
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    const atBoot = schemaCalls.length;
    for (const id of [notes.id, deals.id, notes.id, deals.id]) {
      await page.evaluate((t) => { location.hash = `#/table/${t}`; }, id);
      await page.waitForSelector('.wv-grid');
    }
    await page.waitForTimeout(200);
    assert.equal(schemaCalls.length, atBoot, 'four navigations, zero extra schema round-trips');
    await page.close();
  });
}
