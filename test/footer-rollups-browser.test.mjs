import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let sessions, wide, spacesT, quiet, scores;
const s = await launch('grid footer reads space rollups', (weave) => {
  weave.createSpace({ name: 'Agent' });
  sessions = weave.createTable({ space: 'Agent', name: 'Sessions' });
  weave.addField(sessions, { name: 'Cost', type: 'number', config: { format: 'currency', currency: 'USD', decimals: 2 } });
  weave.addField(sessions, { name: 'Kind', type: 'select', config: { options: ['interactive', 'scheduled'] } });
  weave.addField(sessions, { name: 'Started', type: 'date' });
  for (const [n, c, k, d] of [['a', 1.5, 'interactive', '2026-09-01'], ['b', 2.5, 'interactive', '2026-09-03'], ['c', null, 'scheduled', '2026-08-30'], ['d', 10, 'scheduled', null]]) {
    weave.createEntity('Sessions', { name: n, values: { Cost: c, Kind: k, Started: d } });
  }
  wide = weave.createTable({ space: 'Agent', name: 'Wide' });
  for (let i = 0; i < 12; i++) weave.addField(wide, { name: `A long column name ${i}`, type: 'number' });
  for (let i = 0; i < 40; i++) weave.createEntity('Wide', { name: `w${i}`, values: { 'A long column name 0': i } });
  spacesT = Object.values(weave.state.tables).find((t) => t.system === 'spaces');
  weave.addField(spacesT.id, { name: 'Wide · sum', type: 'rollup', config: { via: 'Agent/Wide', targetField: 'A long column name 0', aggregate: 'sum' } });
  weave.addField(spacesT.id, { name: 'Sessions · Cost · sum', type: 'rollup', config: { via: 'Agent/Sessions', targetField: 'Cost', aggregate: 'sum' } });
  weave.updateTable(sessions.id, { hideRollups: false });
  weave.updateTable(wide.id, { hideRollups: false });
  quiet = weave.createTable({ space: 'Agent', name: 'Quiet' });
  weave.addField(quiet, { name: 'Cost', type: 'number' });
  weave.createEntity('Quiet', { name: 'q', values: { Cost: 3 } });
  weave.addField(spacesT.id, { name: 'Quiet · Cost · sum', type: 'rollup', config: { via: 'Agent/Quiet', targetField: 'Cost', aggregate: 'sum' } });
  scores = weave.createTable({ space: 'Agent', name: 'Scores' });
  weave.addField(scores, { name: 'Progress', type: 'number', config: { display: 'bar', scale: 10 } });
  weave.addField(scores, { name: 'Fit', type: 'rating', config: { max: 5 } });
  for (const [n, p, f] of [['x', 3, 4], ['y', 8, 2]]) weave.createEntity('Scores', { name: n, values: { Progress: p, Fit: f } });
  weave.updateTable(scores.id, { hideRollups: false });
});

if (s) {
  const { base, browser, weave } = s;
  const open = async (hash, width = 1400) => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
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
    const held = await page.evaluate(() => {
      const m = document.querySelector('#modal.wv-stats');
      return { role: m.getAttribute('role'), label: document.getElementById(m.getAttribute('aria-labelledby'))?.textContent, appInert: document.querySelector('#app').inert };
    });
    assert.deepEqual(held, { role: 'dialog', label: 'Sessions · statistics', appInert: true });
    await page.keyboard.press('Escape');
    await page.waitForSelector('#modal-back', { state: 'detached' });
    assert.equal(await page.evaluate(() => document.querySelector('#app').inert), false, 'Escape frees the table');
    await page.close();
  });

  test('the Σ row is pinned right under the field headers and no tfoot paints it (Issue #233)', async () => {
    for (let i = 0; i < 40; i++) weave.createEntity('Sessions', { name: `row ${i}`, values: { Cost: 1 } });
    const page = await open(`/table/${sessions.id}`, 1480);
    await page.waitForSelector('thead tr.wv-foot td.foot-cell.has-stats');
    assert.equal(await page.locator('tfoot').count(), 0, 'the footer is gone');
    assert.equal(await page.$eval('.wv-grid thead', (h) => h.rows.length), 2, 'header row, then the Σ row');
    assert.ok(await page.$eval('.wv-grid thead tr:nth-child(2)', (tr) => tr.classList.contains('wv-foot')));
    assert.ok(await page.$eval('.wv-grid tbody tr.entity-row', (tr) => tr.previousElementSibling === null), 'the first body row follows it');
    const geo = () => page.evaluate(() => {
      const th = document.querySelector('.wv-grid thead tr:first-child th.col-head').getBoundingClientRect();
      const foot = document.querySelector('thead tr.wv-foot td.foot-mark').getBoundingClientRect();
      return { pageScroll: document.querySelector('#main').scrollTop, headTop: th.top, headBottom: th.bottom, footTop: foot.top, footBottom: foot.bottom, innerHeight };
    });
    const before = await geo();
    assert.ok(Math.abs(before.footTop - before.headBottom) <= 1, `the Σ row sits flush under the header: ${JSON.stringify(before)}`);
    await page.evaluate(() => document.querySelector('#main').scrollTo({ top: 600, behavior: 'instant' }));
    await page.waitForFunction(() => document.querySelector('#main').scrollTop > 300);
    await page.waitForTimeout(150);
    const after = await geo();
    const chrome = await page.evaluate(() => document.querySelector('#main > .view-header').getBoundingClientRect().bottom);
    assert.ok(after.headTop >= chrome - 1 && after.headTop < chrome + 40, `the field headers stick under the view header: ${JSON.stringify({ ...after, chrome })}`);
    assert.ok(Math.abs(after.footTop - after.headBottom) <= 1, `the Σ row is still flush under them: ${JSON.stringify(after)}`);
    assert.ok(after.footBottom > 0 && after.footBottom < after.innerHeight, `on screen after a 600px scroll, not scrolled away: ${JSON.stringify(after)}`);
    assert.equal(await page.$eval('thead tr.wv-foot td.foot-mark', (td) => getComputedStyle(td).opacity), '1', 'the pinned row is opaque: rows slide under it, not through it');
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

  test('the eye switches the Σ row off and on; the choice lives on the view and survives a reload (Issues #233, #442)', async () => {
    const page = await open(`/table/${sessions.id}`);
    await page.waitForSelector('thead tr.wv-foot');
    await page.click('.crumb-actions .eye-btn');
    const sw = () => page.locator('.chip-pop .eye-row', { hasText: 'Σ rollup row' });
    await sw().waitFor();
    assert.equal(await sw().locator('input').isChecked(), true);
    await sw().click();
    await page.waitForFunction(() => !document.querySelector('tr.wv-foot'));
    assert.equal(await page.locator('.wv-foot, tfoot').count(), 0, 'no Σ row anywhere');
    assert.equal(weave.tableView(sessions.id).views[0].rollups, false, 'stored on the view (Issue #442)');
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some((k) => /rollup/i.test(k))), false, 'nothing in localStorage');
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    assert.equal(await page.locator('tr.wv-foot').count(), 0, 'still hidden after a reload');
    await page.click('.crumb-actions .eye-btn');
    await sw().waitFor();
    assert.equal(await sw().locator('input').isChecked(), false);
    await sw().click();
    await page.waitForSelector('thead tr.wv-foot td.foot-cell.has-stats');
    assert.equal(weave.tableView(sessions.id).views[0].rollups, true, 'shown is stored too (Issue #249)');
    await page.close();
  });

  test('a table nobody opted in has no Σ row, and the eye brings it (Issue #249)', async () => {
    const page = await open(`/table/${quiet.id}`);
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    assert.equal(await page.locator('tr.wv-foot, tfoot').count(), 0, 'no Σ row by default');
    assert.equal(weave.getTable(quiet.id).hideRollups, undefined, 'and nothing stored to say so');
    await page.click('.crumb-actions .eye-btn');
    const sw = () => page.locator('.chip-pop .eye-row', { hasText: 'Σ rollup row' });
    await sw().waitFor();
    assert.equal(await sw().locator('input').isChecked(), false, 'the box reads off');
    await sw().click();
    await page.waitForSelector('thead tr.wv-foot td.foot-cell.has-stats');
    assert.equal(await footCell(page, 'Cost').locator('.foot-val').innerText(), '3');
    assert.equal(weave.tableView(quiet.id).views[0].rollups, true, 'the opt-in is stored on the view, not the absence');
    await page.keyboard.press('Escape');
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('thead tr.wv-foot td.foot-cell.has-stats', { timeout: 10000 });
    await page.close();
  });

  const costId = () => Object.values(weave.getTable(sessions.id).fields).find((f) => f.name === 'Cost').id;
  const until = async (ok, what) => {
    for (const t0 = Date.now(); !ok();) {
      if (Date.now() - t0 > 5000) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  const apiLog = (page) => {
    const seen = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.pathname.includes('/api/')) seen.push(`${r.method()} ${u.pathname}${u.search}`);
    });
    return seen;
  };
  const aria = (page, agg) => page.getAttribute(`.chip-pop .foot-row[data-agg="${agg}"]`, 'aria-checked');
  const costFigures = (page) => footCell(page, 'Cost').locator('.foot-stat').count();

  test('a Σ switch flips before its write answers, and only its column is read back (Issue #235)', async () => {
    const page = await open(`/table/${sessions.id}`);
    await page.waitForSelector('thead tr.wv-foot td.foot-cell.has-stats');
    const seen = apiLog(page);
    await footCell(page, 'Cost').click();
    await page.waitForSelector('.chip-pop .foot-row');
    assert.deepEqual(seen.filter((r) => r.includes('/stats')), [`GET /api/tables/${sessions.id}/stats?field=${costId()}`],
      'the picker opens on its own column, not the whole table');
    let release, reads = 0;
    const held = new Promise((r) => { release = r; });
    await page.route('**/api/tables/*/stats*', async (route) => { reads++; await held; await route.continue(); });
    const before = await costFigures(page);
    await page.evaluate(() => { window.gridBody = document.querySelector('.wv-grid tbody'); });
    seen.length = 0;
    await page.click('.chip-pop .foot-row[data-agg="median"]');
    assert.equal(await aria(page, 'median'), 'true', 'the switch flipped on the click');
    assert.ok(await page.$('.chip-pop .foot-row[data-agg="median"] .switch.on'), 'and wears it');
    await until(() => reads === 1, 'the read-back');
    assert.ok(spaceRollups().includes('Sessions · Cost · median'), 'the write landed while the read is still out');
    assert.equal(await aria(page, 'median'), 'true', 'still on while the figures are out');
    release();
    await page.waitForFunction((n) => document.querySelectorAll('thead tr.wv-foot td.foot-cell[data-col="Cost"] .foot-stat').length === n, before + 1);
    const want = weave.tableRollups(sessions.id).filter((r) => r.targetField === 'Cost').map((r) => r.display);
    assert.deepEqual(await footCell(page, 'Cost').locator('.foot-val').allInnerTexts(), want, 'the new figure painted beside the old ones');
    await page.waitForTimeout(300);
    assert.deepEqual(seen, [`POST /api/tables/${spacesT.id}/fields`, `GET /api/tables/${sessions.id}/stats?field=${costId()}`],
      'one write and one narrow read: no schema reload, no row query');
    assert.ok(await page.evaluate(() => document.querySelector('.wv-grid tbody') === window.gridBody), 'the grid body was not redrawn');
    seen.length = 0;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await until(() => seen.some((r) => r.startsWith('GET /api/schema')), 'the focus re-read');
    await page.waitForTimeout(400);
    assert.ok(!seen.some((r) => r.endsWith('/query')), `the schema the tab kept matches the server's: ${seen}`);
    assert.ok(await page.evaluate(() => document.querySelector('.wv-grid tbody') === window.gridBody), 'still the same grid body');
    await page.click('.chip-pop .foot-row[data-agg="median"]');
    await page.waitForFunction((n) => document.querySelectorAll('thead tr.wv-foot td.foot-cell[data-col="Cost"] .foot-stat').length === n, before);
    assert.ok(!spaceRollups().includes('Sessions · Cost · median'));
    await page.close();
  });

  test('a Σ switch flicked on and off before its write answers ends off, with one write each (Issue #235)', async () => {
    const page = await open(`/table/${sessions.id}`);
    await page.waitForSelector('thead tr.wv-foot td.foot-cell.has-stats');
    await footCell(page, 'Cost').click();
    await page.waitForSelector('.chip-pop .foot-row');
    const before = await costFigures(page);
    let release, writes = 0;
    const held = new Promise((r) => { release = r; });
    await page.route(`**/api/tables/${spacesT.id}/fields**`, async (route) => { if (++writes === 1) await held; await route.continue(); });
    await page.click('.chip-pop .foot-row[data-agg="stdev"]');
    await until(() => writes === 1, 'the first write');
    await page.click('.chip-pop .foot-row[data-agg="stdev"]');
    assert.equal(await aria(page, 'stdev'), 'false', 'the second click flipped it straight back');
    await page.waitForTimeout(300);
    assert.equal(writes, 1, 'the second write waits for the first');
    release();
    await until(() => writes === 2, 'the second write');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(200);
    assert.equal(await aria(page, 'stdev'), 'false');
    assert.ok(!spaceRollups().includes('Sessions · Cost · stdev'), `the off landed after the on: ${spaceRollups()}`);
    assert.equal(await page.locator('.wv-toast.err').count(), 0, 'no conflict to report');
    assert.equal(await costFigures(page), before);
    await page.close();
  });

  test('a Σ write that fails puts the switch back and says why (Issue #235)', async () => {
    const page = await open(`/table/${sessions.id}`);
    await page.waitForSelector('thead tr.wv-foot td.foot-cell.has-stats');
    await footCell(page, 'Cost').click();
    await page.waitForSelector('.chip-pop .foot-row');
    const before = await costFigures(page);
    let release;
    const held = new Promise((r) => { release = r; });
    await page.route(`**/api/tables/${spacesT.id}/fields`, async (route) => {
      await held;
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'the disk is full' }) });
    });
    await page.click('.chip-pop .foot-row[data-agg="range"]');
    assert.equal(await aria(page, 'range'), 'true', 'optimistic: on at the click');
    release();
    await page.waitForFunction(() => document.querySelector('.chip-pop .foot-row[data-agg="range"]')?.getAttribute('aria-checked') === 'false');
    assert.equal(await page.$('.chip-pop .foot-row[data-agg="range"] .switch.on'), null, 'the knob went back too');
    assert.match(await page.locator('.wv-toast.err').first().innerText(), /the disk is full/);
    assert.ok(!spaceRollups().includes('Sessions · Cost · range'));
    assert.equal(await costFigures(page), before, 'the footer kept its figures');
    await page.close();
  });

  for (const [col, agg] of [['Progress', 'avg'], ['Fit', 'max']]) {
    test(`a Σ over a ${col === 'Fit' ? 'rating' : 'bar'} column, flipped on, leaves a refocus nothing to redraw (Issue #235)`, async () => {
      const page = await open(`/table/${scores.id}`);
      await page.waitForSelector('thead tr.wv-foot');
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      const seen = apiLog(page);
      await footCell(page, col).click();
      await page.waitForSelector('.chip-pop .foot-row');
      await page.click(`.chip-pop .foot-row[data-agg="${agg}"]`);
      await page.waitForFunction((c) => document.querySelectorAll(`thead tr.wv-foot td.foot-cell[data-col="${c}"] .foot-stat`).length === 1, col);
      await page.waitForLoadState('networkidle');
      const entry = await page.evaluate((n) => registryTable('spaces').fields.find((f) => f.name === n), `Scores · ${col} · ${agg}`);
      const res = await fetch(`${base}/api/schema`);
      const server = (await res.json()).flatMap((sp) => sp.tables).find((t) => t.system === 'spaces').fields.find((f) => f.name === `Scores · ${col} · ${agg}`);
      assert.deepEqual(entry, server, 'the tab holds the entry describeSchema gives');
      await page.evaluate(() => { window.gridBody = document.querySelector('.wv-grid tbody'); });
      seen.length = 0;
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await until(() => seen.some((r) => r.startsWith('GET /api/schema')), 'the focus re-read');
      await page.waitForTimeout(400);
      assert.ok(!seen.some((r) => r.endsWith('/query')), `the refocus redrew the page: ${seen}`);
      assert.ok(await page.evaluate(() => document.querySelector('.wv-grid tbody') === window.gridBody), 'the same grid body');
      await page.click(`.chip-pop .foot-row[data-agg="${agg}"]`);
      await page.waitForFunction((c) => !document.querySelector(`thead tr.wv-foot td.foot-cell[data-col="${c}"] .foot-stat`), col);
      await page.close();
    });
  }
}
