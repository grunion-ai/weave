/* The Σ row (Kyle, 2026-09-06: "all footer values live at the space level").
   A grid's footer draws the space rollups pointed at the table, one cell per
   column; a click on a footer cell offers the aggregates the column can wear,
   and each switch creates or deletes a rollup field on the Workspace/Spaces
   row — so the figure is a field, not a UI artefact. The space page draws
   the same rollups as tiles; the table menu's Column stats… summarises every
   column on demand. Driven through the page so the click → POST → repaint
   path is what is proved.
   Issue #233: the row is pinned under the field headers (thead, not tfoot)
   so it stays put while the body scrolls, and the eye's Rows section
   switches it off — `hideRollups` on the table, remembered on the Tables
   row like the filter and the sort, never in the browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let sessions, wide, spacesT;
const s = await launch('grid footer reads space rollups', (weave) => {
  weave.createSpace({ name: 'Agent' });
  sessions = weave.createTable({ space: 'Agent', name: 'Sessions' });
  weave.addField(sessions, { name: 'Cost', type: 'number', config: { format: 'currency', currency: 'USD', decimals: 2 } });
  weave.addField(sessions, { name: 'Kind', type: 'select', config: { options: ['interactive', 'scheduled'] } });
  weave.addField(sessions, { name: 'Started', type: 'date' });
  for (const [n, c, k, d] of [['a', 1.5, 'interactive', '2026-09-01'], ['b', 2.5, 'interactive', '2026-09-03'], ['c', null, 'scheduled', '2026-08-30'], ['d', 10, 'scheduled', null]]) {
    weave.createEntity('Sessions', { name: n, values: { Cost: c, Kind: k, Started: d } });
  }
  // A grid wider than its card: its wrap scrolls sideways, so it has to be
  // the vertical scroller too for the header and the Σ row to stick.
  wide = weave.createTable({ space: 'Agent', name: 'Wide' });
  for (let i = 0; i < 12; i++) weave.addField(wide, { name: `A long column name ${i}`, type: 'number' });
  for (let i = 0; i < 40; i++) weave.createEntity('Wide', { name: `w${i}`, values: { 'A long column name 0': i } });
  spacesT = Object.values(weave.state.tables).find((t) => t.system === 'spaces');
  weave.addField(spacesT.id, { name: 'Wide · sum', type: 'rollup', config: { via: 'Agent/Wide', targetField: 'A long column name 0', aggregate: 'sum' } });
  weave.addField(spacesT.id, { name: 'Sessions · Cost · sum', type: 'rollup', config: { via: 'Agent/Sessions', targetField: 'Cost', aggregate: 'sum' } });
});

if (s) {
  const { base, browser, weave } = s;
  const open = async (hash) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#${hash}`, { waitUntil: 'load' });
    return page;
  };
  const footCell = (page, col) => page.locator(`thead tr.wv-foot td.foot-cell[data-col="${col}"]`);
  const spaceRollups = () => Object.values(weave.getTable(spacesT.id).fields).filter((f) => f.type === 'rollup' && f.config.via).map((f) => f.name);

  test('the footer draws the space rollup under its column, dressed', async () => {
    const page = await open(`/table/${sessions.id}`);
    await page.waitForSelector('thead tr.wv-foot');
    await page.waitForSelector('thead tr.wv-foot td.foot-cell.has-stats');
    const cost = footCell(page, 'Cost');
    assert.equal(await cost.locator('.foot-agg').innerText(), 'Σ');
    assert.equal(await cost.locator('.foot-val').innerText(), '$14.00');
    assert.equal(await footCell(page, 'Kind').locator('.foot-stat').count(), 0, 'no rollup, no figure');
    await page.close();
  });

  test('a footer cell offers the aggregates its column can wear; a switch creates the rollup field and the footer repaints', async () => {
    const page = await open(`/table/${sessions.id}`);
    await page.waitForSelector('thead tr.wv-foot td.foot-cell.has-stats');
    await footCell(page, 'Cost').click();
    await page.waitForSelector('.chip-pop .foot-row');
    const offered = await page.$$eval('.chip-pop .foot-row', (rows) => rows.map((r) => r.dataset.agg));
    assert.deepEqual(offered, ['sum', 'avg', 'median', 'min', 'max', 'stdev', 'range', 'filled', 'empty']);
    assert.equal(await page.getAttribute('.chip-pop .foot-row[data-agg="sum"]', 'aria-checked'), 'true', 'the existing rollup reads as on');
    await page.click('.chip-pop .foot-row[data-agg="avg"]');
    await page.waitForFunction(() => document.querySelector('.chip-pop .foot-row[data-agg="avg"]')?.getAttribute('aria-checked') === 'true');
    assert.ok(spaceRollups().includes('Sessions · Cost · avg'), `the switch wrote a field on the Spaces row: ${spaceRollups()}`);
    await page.waitForFunction(() => document.querySelectorAll('thead tr.wv-foot td.foot-cell[data-col="Cost"] .foot-stat').length === 2);
    const vals = await footCell(page, 'Cost').locator('.foot-val').allInnerTexts();
    assert.deepEqual(vals, ['$14.00', '$4.67']);
    // Off again: the field goes, the figure goes.
    await page.click('.chip-pop .foot-row[data-agg="avg"]');
    await page.waitForFunction(() => document.querySelectorAll('thead tr.wv-foot td.foot-cell[data-col="Cost"] .foot-stat').length === 1);
    assert.ok(!spaceRollups().includes('Sessions · Cost · avg'));
    await page.close();
  });

  test('the Name column carries the row count; a date column its extremes', async () => {
    const page = await open(`/table/${sessions.id}`);
    await page.waitForSelector('thead tr.wv-foot td.foot-cell.has-stats');
    await footCell(page, 'Name').click();
    await page.waitForSelector('.chip-pop .foot-row');
    assert.deepEqual(await page.$$eval('.chip-pop .foot-row', (rows) => rows.map((r) => r.dataset.agg)), ['count', 'distinct']);
    await page.click('.chip-pop .foot-row[data-agg="count"]');
    await page.waitForFunction(() => document.querySelector('thead tr.wv-foot td.foot-cell[data-col="Name"] .foot-val')?.textContent === '4');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.chip-pop'));
    await footCell(page, 'Started').click();
    await page.waitForSelector('.chip-pop .foot-row');
    assert.deepEqual(await page.$$eval('.chip-pop .foot-row', (rows) => rows.map((r) => r.dataset.agg)), ['min', 'max', 'filled', 'empty']);
    await page.click('.chip-pop .foot-row[data-agg="max"]');
    await page.waitForFunction(() => document.querySelector('thead tr.wv-foot td.foot-cell[data-col="Started"] .foot-val')?.textContent === 'Sep 3, 2026');
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
    await page.waitForSelector('thead tr.wv-foot');
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

  test('the Σ row is pinned right under the field headers and no tfoot paints it (Issue #233)', async () => {
    // Enough rows that the body scrolls past the viewport.
    for (let i = 0; i < 40; i++) weave.createEntity('Sessions', { name: `row ${i}`, values: { Cost: 1 } });
    const page = await open(`/table/${sessions.id}`);
    await page.waitForSelector('thead tr.wv-foot td.foot-cell.has-stats');
    assert.equal(await page.locator('tfoot').count(), 0, 'the footer is gone');
    assert.equal(await page.$eval('.wv-grid thead', (h) => h.rows.length), 2, 'header row, then the Σ row');
    assert.ok(await page.$eval('.wv-grid thead tr:nth-child(2)', (tr) => tr.classList.contains('wv-foot')));
    assert.ok(await page.$eval('.wv-grid tbody tr.entity-row', (tr) => tr.previousElementSibling === null), 'the first body row follows it');
    // The header sticks to the page (Issue #236 made the wrap clip when the
    // grid fits), and the Σ row sticks under it.
    const geo = () => page.evaluate(() => {
      // A FIELD header, not the corner: th.col-head used to override the sticky.
      const th = document.querySelector('.wv-grid thead tr:first-child th.col-head').getBoundingClientRect();
      const foot = document.querySelector('thead tr.wv-foot td.foot-mark').getBoundingClientRect();
      return { pageScroll: window.scrollY, headTop: th.top, headBottom: th.bottom, footTop: foot.top, footBottom: foot.bottom, innerHeight };
    });
    const before = await geo();
    assert.ok(Math.abs(before.footTop - before.headBottom) <= 1, `the Σ row sits flush under the header: ${JSON.stringify(before)}`);
    await page.evaluate(() => window.scrollTo(0, 600));
    await page.waitForFunction(() => window.scrollY > 300);
    await page.waitForTimeout(150);
    const after = await geo();
    assert.ok(after.headTop >= 0 && after.headTop < 40, `the field headers stick to the top edge: ${JSON.stringify(after)}`);
    assert.ok(Math.abs(after.footTop - after.headBottom) <= 1, `the Σ row is still flush under them: ${JSON.stringify(after)}`);
    assert.ok(after.footBottom > 0 && after.footBottom < after.innerHeight, `on screen after a 600px scroll, not scrolled away: ${JSON.stringify(after)}`);
    assert.equal(await page.$eval('thead tr.wv-foot td.foot-mark', (td) => getComputedStyle(td).opacity), '1', 'the pinned row is opaque: rows slide under it, not through it');
    // The picker still works from the pinned row.
    await footCell(page, 'Kind').click();
    await page.waitForSelector('.chip-pop .foot-row[data-agg="filled"]');
    await page.click('.chip-pop .foot-row[data-agg="filled"]');
    await page.waitForFunction(() => document.querySelector('thead tr.wv-foot td.foot-cell[data-col="Kind"] .foot-val')?.textContent === '4');
    await page.keyboard.press('Escape');
    await page.close();
  });

  test('on a grid wider than its card the wrap scrolls both ways and the header and Σ row stick to it (Issue #233)', async () => {
    const page = await open(`/table/${wide.id}`);
    await page.waitForSelector('thead tr.wv-foot td.foot-cell.has-stats');
    await page.waitForFunction(() => document.querySelector('.table-wrap.wv-grid-scroll')?.style.maxHeight);
    const geo = () => page.evaluate(() => {
      const wrap = document.querySelector('.table-wrap.wv-grid-scroll');
      const th = document.querySelector('.wv-grid thead tr:first-child th.col-head').getBoundingClientRect();
      const foot = document.querySelector('thead tr.wv-foot td.foot-mark').getBoundingClientRect();
      return { overflowX: getComputedStyle(wrap).overflowX, wrapTop: wrap.getBoundingClientRect().top, wrapScroll: wrap.scrollTop, pageScroll: window.scrollY, docFits: document.documentElement.scrollHeight <= innerHeight, headTop: th.top, headBottom: th.bottom, footTop: foot.top, footBottom: foot.bottom, innerHeight };
    });
    const before = await geo();
    assert.equal(before.overflowX, 'auto', 'still scrolls sideways');
    assert.ok(before.docFits, `the page itself does not scroll: ${JSON.stringify(before)}`);
    await page.evaluate(() => { document.querySelector('.table-wrap.wv-grid-scroll').scrollTop = 600; });
    await page.waitForFunction(() => document.querySelector('.table-wrap.wv-grid-scroll').scrollTop > 300);
    await page.waitForTimeout(150);
    const after = await geo();
    assert.ok(Math.abs(after.headTop - after.wrapTop) <= 1, `the field headers stick to the top of the box: ${JSON.stringify(after)}`);
    assert.ok(Math.abs(after.footTop - after.headBottom) <= 1, `the Σ row is flush under them: ${JSON.stringify(after)}`);
    assert.ok(after.footBottom > 0 && after.footBottom < after.innerHeight, `on screen: ${JSON.stringify(after)}`);
    assert.equal(after.pageScroll, 0);
    await page.close();
  });

  test('the eye switches the Σ row off and on; the choice lives on the table and survives a reload (Issue #233)', async () => {
    const page = await open(`/table/${sessions.id}`);
    await page.waitForSelector('thead tr.wv-foot');
    await page.click('.crumb-actions .eye-btn');
    const sw = () => page.locator('.chip-pop .eye-row', { hasText: 'Σ rollup row' });
    await sw().waitFor();
    assert.equal(await sw().getAttribute('aria-checked'), 'true');
    await sw().click();
    await page.waitForFunction(() => !document.querySelector('tr.wv-foot'));
    assert.equal(await page.locator('.wv-foot, tfoot').count(), 0, 'no Σ row anywhere');
    assert.equal(weave.getTable(sessions.id).hideRollups, true, 'stored on the table');
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some((k) => /rollup/i.test(k))), false, 'nothing in localStorage');
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    assert.equal(await page.locator('tr.wv-foot').count(), 0, 'still hidden after a reload');
    await page.click('.crumb-actions .eye-btn');
    await sw().waitFor();
    assert.equal(await sw().getAttribute('aria-checked'), 'false');
    await sw().click();
    await page.waitForSelector('thead tr.wv-foot td.foot-cell.has-stats');
    assert.equal(weave.getTable(sessions.id).hideRollups, undefined, 'shown again is the absence');
    await page.close();
  });
}
