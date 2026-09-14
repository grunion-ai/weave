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
// The two spans that open on Sep 9 are what makes the end matter: a range
// sorts by its start, then by its end (Issue #287).
const ROWS = [
  { name: 'sep-09', Created: '2026-09-09T09:51', Cache: 15829984, Window: { start: '2026-09-09', end: '2026-09-12' } },
  { name: 'oct-01', Created: '2026-10-01T00:05', Cache: 900, Window: { start: '2026-10-01', end: '2026-10-03' } },
  { name: 'sep-12', Created: '2026-09-12T07:32', Cache: 2048, Window: { start: '2026-09-09', end: '2026-09-30' } },
];
const s = await launch('a grid sorts by value, not costume', (weave) => {
  weave.createSpace({ name: 'Agent' });
  sessions = weave.createTable({ space: 'Agent', name: 'Session' });
  // The uno field exactly: a date wearing the long format with a clock.
  weave.addField(sessions, { name: 'Created', type: 'date', config: { format: 'long', time: true } });
  weave.addField(sessions, { name: 'Cache Read', type: 'number', config: { separator: true } });
  weave.addField(sessions, { name: 'Window', type: 'daterange', config: { format: 'long' } });
  for (const r of ROWS) weave.createEntity(sessions, { name: r.name, values: { Created: r.Created, 'Cache Read': r.Cache, Window: r.Window } });
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

  test('a daterange column reads earliest span first, whichever half does the sorting (Issue #287)', async () => {
    const page = await open();
    const cells = await page.$$eval('.wv-grid tbody tr.entity-row td[data-field="Window"] input', (ins) => ins.map((i) => i.value));
    assert.ok(cells.every((c) => / – /.test(c)), `the cells wear the painted span: ${cells.join(' | ')}`);
    // Ascending on the costume read "Oct 1 – Oct 3, 2026" first, because
    // "O" < "S". The server orders page one; the eyeball's Deleted switch
    // hands the whole table to app.js, which must land in the same order.
    await page.locator('.wv-grid thead th', { hasText: 'Window' }).locator('.field-menu').click();
    await page.locator('.chip-pop .wv-menu-row', { hasText: 'Sort ascending' }).first().click();
    await page.waitForFunction(() => document.querySelector('.wv-grid tbody tr.entity-row td.name-cell input')?.value === 'sep-09');
    assert.deepEqual(await order(page), ['sep-09', 'sep-12', 'oct-01'], 'paged: the server orders page one');
    await page.close();
  });

  test('the grid sorts a daterange itself the same way the server does (Issue #287)', async () => {
    const page = await open();
    await stopPaging(page);
    await page.locator('.wv-grid thead th', { hasText: 'Window' }).locator('.field-menu').click();
    await page.locator('.chip-pop .wv-menu-row', { hasText: 'Sort ascending' }).first().click();
    await page.waitForFunction(() => document.querySelector('.wv-grid tbody tr.entity-row td.name-cell input')?.value === 'sep-09');
    assert.deepEqual(await order(page), ['sep-09', 'sep-12', 'oct-01'], 'Sep 9–12 < Sep 9–30 < Oct 1–3');
    await page.close();
  });
}
