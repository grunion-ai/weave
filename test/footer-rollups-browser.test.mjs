/* The Σ row (Kyle, 2026-09-06: "all footer values live at the space level").
   A grid's footer draws the space rollups pointed at the table, one cell per
   column; a click on a footer cell offers the aggregates the column can wear,
   and each switch creates or deletes a rollup field on the Workspace/Spaces
   row — so the figure is a field, not a UI artefact. The space page draws
   the same rollups as tiles; the table menu's Column stats… summarises every
   column on demand. Driven through the page so the click → POST → repaint
   path is what is proved. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let sessions, spacesT;
const s = await launch('grid footer reads space rollups', (weave) => {
  weave.createSpace({ name: 'Agent' });
  sessions = weave.createTable({ space: 'Agent', name: 'Sessions' });
  weave.addField(sessions, { name: 'Cost', type: 'number', config: { format: 'currency', currency: 'USD', decimals: 2 } });
  weave.addField(sessions, { name: 'Kind', type: 'select', config: { options: ['interactive', 'scheduled'] } });
  weave.addField(sessions, { name: 'Started', type: 'date' });
  for (const [n, c, k, d] of [['a', 1.5, 'interactive', '2026-09-01'], ['b', 2.5, 'interactive', '2026-09-03'], ['c', null, 'scheduled', '2026-08-30'], ['d', 10, 'scheduled', null]]) {
    weave.createEntity('Sessions', { name: n, values: { Cost: c, Kind: k, Started: d } });
  }
  spacesT = Object.values(weave.state.tables).find((t) => t.system === 'spaces');
  weave.addField(spacesT.id, { name: 'Sessions · Cost · sum', type: 'rollup', config: { via: 'Agent/Sessions', targetField: 'Cost', aggregate: 'sum' } });
});

if (s) {
  const { base, browser, weave } = s;
  const open = async (hash) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#${hash}`, { waitUntil: 'load' });
    return page;
  };
  const footCell = (page, col) => page.locator(`tfoot td.foot-cell[data-col="${col}"]`);
  const spaceRollups = () => Object.values(weave.getTable(spacesT.id).fields).filter((f) => f.type === 'rollup' && f.config.via).map((f) => f.name);

  test('the footer draws the space rollup under its column, dressed', async () => {
    const page = await open(`/table/${sessions.id}`);
    await page.waitForSelector('tfoot tr.wv-foot');
    await page.waitForSelector('tfoot td.foot-cell.has-stats');
    const cost = footCell(page, 'Cost');
    assert.equal(await cost.locator('.foot-agg').innerText(), 'Σ');
    assert.equal(await cost.locator('.foot-val').innerText(), '$14.00');
    assert.equal(await footCell(page, 'Kind').locator('.foot-stat').count(), 0, 'no rollup, no figure');
    await page.close();
  });

  test('a footer cell offers the aggregates its column can wear; a switch creates the rollup field and the footer repaints', async () => {
    const page = await open(`/table/${sessions.id}`);
    await page.waitForSelector('tfoot td.foot-cell.has-stats');
    await footCell(page, 'Cost').click();
    await page.waitForSelector('.chip-pop .foot-row');
    const offered = await page.$$eval('.chip-pop .foot-row', (rows) => rows.map((r) => r.dataset.agg));
    assert.deepEqual(offered, ['sum', 'avg', 'median', 'min', 'max', 'stdev', 'range', 'filled', 'empty']);
    assert.equal(await page.getAttribute('.chip-pop .foot-row[data-agg="sum"]', 'aria-checked'), 'true', 'the existing rollup reads as on');
    await page.click('.chip-pop .foot-row[data-agg="avg"]');
    await page.waitForFunction(() => document.querySelector('.chip-pop .foot-row[data-agg="avg"]')?.getAttribute('aria-checked') === 'true');
    assert.ok(spaceRollups().includes('Sessions · Cost · avg'), `the switch wrote a field on the Spaces row: ${spaceRollups()}`);
    await page.waitForFunction(() => document.querySelectorAll('tfoot td.foot-cell[data-col="Cost"] .foot-stat').length === 2);
    const vals = await footCell(page, 'Cost').locator('.foot-val').allInnerTexts();
    assert.deepEqual(vals, ['$14.00', '$4.67']);
    // Off again: the field goes, the figure goes.
    await page.click('.chip-pop .foot-row[data-agg="avg"]');
    await page.waitForFunction(() => document.querySelectorAll('tfoot td.foot-cell[data-col="Cost"] .foot-stat').length === 1);
    assert.ok(!spaceRollups().includes('Sessions · Cost · avg'));
    await page.close();
  });

  test('the Name column carries the row count; a date column its extremes', async () => {
    const page = await open(`/table/${sessions.id}`);
    await page.waitForSelector('tfoot td.foot-cell.has-stats');
    await footCell(page, 'Name').click();
    await page.waitForSelector('.chip-pop .foot-row');
    assert.deepEqual(await page.$$eval('.chip-pop .foot-row', (rows) => rows.map((r) => r.dataset.agg)), ['count', 'distinct']);
    await page.click('.chip-pop .foot-row[data-agg="count"]');
    await page.waitForFunction(() => document.querySelector('tfoot td.foot-cell[data-col="Name"] .foot-val')?.textContent === '4');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.chip-pop'));
    await footCell(page, 'Started').click();
    await page.waitForSelector('.chip-pop .foot-row');
    assert.deepEqual(await page.$$eval('.chip-pop .foot-row', (rows) => rows.map((r) => r.dataset.agg)), ['min', 'max', 'filled', 'empty']);
    await page.click('.chip-pop .foot-row[data-agg="max"]');
    await page.waitForFunction(() => document.querySelector('tfoot td.foot-cell[data-col="Started"] .foot-val')?.textContent === 'Sep 3, 2026');
    await page.close();
  });

  test('the space page draws its rollups as tiles that open the table', async () => {
    const page = await open(`/space/${weave.findSpace('Agent').id}`);
    await page.waitForSelector('.wv-stat-tiles .wv-stat-tile');
    const tiles = await page.$$eval('.wv-stat-tile', (ts) => ts.map((t) => [t.querySelector('.wv-stat-value').textContent, t.querySelector('.wv-stat-label').textContent, t.getAttribute('href')]));
    const sum = tiles.find((t) => t[1] === 'Sessions · Cost');
    assert.ok(sum, `a tile for the cost sum: ${JSON.stringify(tiles)}`);
    assert.equal(sum[0], '$14.00');
    assert.equal(sum[2], `#/table/${sessions.id}`);
    await page.close();
  });

  test('Column stats… summarises every column and groups on a chip column', async () => {
    const page = await open(`/table/${sessions.id}`);
    await page.waitForSelector('tfoot tr.wv-foot');
    await page.locator('.crumb-actions .dots-btn').last().click();
    await page.locator('.dl-menu .dropdown-item', { hasText: 'Column stats…' }).first().click();
    await page.waitForSelector('#modal.wv-stats tr[data-col="Cost"]');
    const cost = await page.$eval('#modal.wv-stats tr[data-col="Cost"]', (tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
    assert.equal(cost[0], 'Cost');
    assert.ok(cost.includes('$14.00') && cost.includes('$2.50'), `sum and median: ${cost}`);
    assert.ok(await page.$('#modal.wv-stats .wv-hist-bar'), 'a histogram');
    assert.ok(await page.$('#modal.wv-stats .wv-stats-card[data-col="Kind"] .wv-dist-row'), 'a distribution for the chip column');
    assert.match(await page.$eval('#modal.wv-stats .wv-stats-card[data-col="Started"]', (n) => n.textContent), /Aug 30, 2026 → Sep 3, 2026 · 4 days/);
    await page.click('#modal.wv-stats .wv-stats-by .picker-face');
    await page.locator('.chip-pop .chip-pop-row', { hasText: 'Kind' }).first().click();
    await page.waitForSelector('#modal.wv-stats h3:has-text("By Kind")');
    const rows = await page.$$eval('#modal.wv-stats h3:has-text("By Kind") + .table-wrap tbody tr', (trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent)));
    assert.deepEqual(rows, [['interactive', '2', '$4.00'], ['scheduled', '2', '$10.00']]);
    await page.close();
  });
}
