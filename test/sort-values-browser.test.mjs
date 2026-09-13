/* The grid's order against a real page (Issue #279).

   uno's Agent/Sessions put "Sep 9, 2026 9:51 AM" above every row created on
   Sep 12: the comparator was handed the painted string. The value rule is
   pinned in test/sort-values.test.mjs; this suite proves the two paths a
   grid can take to an order land in the same place — the table page sorts on
   the server (it pages its data, Issue #271), and the eyeball's "Deleted
   rows" switch turns paging off and sorts in public/app.js.

   Playwright is NOT a dependency of weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let sessions;
// Deliberately out of creation order, so neither insertion order nor the
// public id can pass for a working sort.
const ROWS = [
  { name: 'sep-09', Created: '2026-09-09T09:51', Cache: 15829984 },
  { name: 'oct-01', Created: '2026-10-01T00:05', Cache: 900 },
  { name: 'sep-12', Created: '2026-09-12T07:32', Cache: 2048 },
];
const s = await launch('a grid sorts by value, not costume', (weave) => {
  weave.createSpace({ name: 'Agent' });
  sessions = weave.createTable({ space: 'Agent', name: 'Session' });
  // The uno field exactly: a date wearing the long format with a clock.
  weave.addField(sessions, { name: 'Created', type: 'date', config: { format: 'long', time: true } });
  weave.addField(sessions, { name: 'Cache Read', type: 'number', config: { separator: true } });
  for (const r of ROWS) weave.createEntity(sessions, { name: r.name, values: { Created: r.Created, 'Cache Read': r.Cache } });
  weave.updateTable(sessions, { sort: [{ field: 'Created', dir: 'desc' }] });
});

if (s) {
  const { base, browser } = s;
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${base}/#/table/${sessions.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    return page;
  };
  // Every grid cell is its field's editor, so the value is on the control.
  const order = (page) => page.$$eval('.wv-grid tbody tr.entity-row td.name-cell', (tds) => tds.map((td) => td.querySelector('input')?.value ?? td.textContent.trim()));
  // The eyeball's Rows section: showing deleted rows is the one path that
  // asks for the whole table, so the grid sorts locally from there on.
  const stopPaging = async (page) => {
    await page.click('.eye-btn');
    await page.waitForSelector('.chip-pop .eye-row');
    await page.locator('.chip-pop .eye-row', { hasText: 'Deleted' }).first().click();
    await page.waitForSelector('.chip-pop', { state: 'detached' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
  };

  test('a date column reads newest first, whichever half does the sorting', async () => {
    const page = await open();
    const cells = await page.$$eval('.wv-grid tbody tr.entity-row td[data-field="Created"] input', (ins) => ins.map((i) => i.value));
    assert.ok(cells.every((c) => /^(Sep|Oct) \d+, 2026/.test(c)), `the cells wear the long format: ${cells.join(' | ')}`);
    assert.deepEqual(await order(page), ['oct-01', 'sep-12', 'sep-09'], 'paged: the server orders page one');
    await stopPaging(page);
    assert.deepEqual(await order(page), ['oct-01', 'sep-12', 'sep-09'], 'whole table: app.js orders it the same way');
    await page.close();
  });

  test('a number column sorts through its separators when the grid sorts itself', async () => {
    const page = await open();
    await stopPaging(page);
    await page.locator('.wv-grid thead th', { hasText: 'Cache Read' }).locator('.field-menu').click();
    await page.locator('.chip-pop .wv-menu-row', { hasText: 'Sort ascending' }).first().click();
    await page.waitForFunction(() => document.querySelector('.wv-grid tbody tr.entity-row td.name-cell input')?.value === 'oct-01');
    assert.deepEqual(await order(page), ['oct-01', 'sep-12', 'sep-09'], '900 < 2,048 < 15,829,984');
    await page.close();
  });
}
