/* ⌘-click opens a tab, everywhere (Issue #134).

   A reader who holds ⌘ (or Ctrl, or Shift, or presses the middle button)
   is telling the browser "not here" — and weave has to hand that click
   back whatever chrome it lands on. Real anchors do it for free. The
   surfaces that navigate WITHOUT being a link — a grid row, the relation
   panel on an entity page, an activity row, a ⌘K hit, the relation map —
   used to swallow the modifier and route the current tab instead.

   One rule now covers all of them: a navigating surface declares its
   destination as data-href, and a single capture-phase listener turns a
   native click into a real tab before any routing handler runs. Form
   controls keep their modifiers, so shift-click still extends a text
   selection and the checkbox range-select survives.

   Playwright is NOT a dependency of weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let deals, people, acme, bluefin, ada;

const s = await launch('modifier clicks', (weave) => {
  weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deals' });
  people = weave.createTable({ space: 'Sales', name: 'People' });
  ada = weave.createEntity(people, { name: 'Ada Chen' });
  weave.addRelation(deals.id, { name: 'Owner', targetDb: people.id, cardinality: 'many-to-one', inverseName: 'Deals' });
  acme = weave.createEntity(deals, { name: 'Acme Working Capital' });
  bluefin = weave.createEntity(deals, { name: 'Bluefin Renewal' });
  weave.link(acme.id, 'Owner', [ada.id]);
  return { deals, people, acme, bluefin, ada };
});

if (s) {
  const { base, browser } = s;

  /* One click, one question: did the app hand the click to the browser?
     Returns { tab, stayed } — the URL of the tab that opened (null when
     none did) and whether this page kept its route. */
  const modifierClick = async (ctx, page, selector, opts = {}) => {
    const before = await page.evaluate(() => location.hash);
    const opened = ctx.waitForEvent('page', { timeout: 3000 }).catch(() => null);
    await page.click(selector, { modifiers: ['ControlOrMeta'], ...opts });
    const tab = await opened;
    const url = tab ? tab.url() : null;
    if (tab) await tab.close();
    await page.waitForTimeout(150);
    return { tab: url, stayed: (await page.evaluate(() => location.hash)) === before };
  };

  const open = async (ctx, hash, wait) => {
    const page = await ctx.newPage();
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    if (wait) await page.waitForSelector(wait);
    await page.waitForTimeout(250);
    return page;
  };

  test('a grid row: ⌘-click on a cell opens the record in a tab', async () => {
    const ctx = await browser.newContext();
    const page = await open(ctx, `#/table/${s.deals.id}`, '.wv-grid tbody tr.entity-row');
    const r = await modifierClick(ctx, page, `tr[data-eid="${s.acme.id}"] td[data-ftype="document"]`);
    assert.ok(r.tab?.includes(`#/entity/${s.acme.id}`), `a tab opened on the record (got ${r.tab})`);
    assert.ok(r.stayed, 'the table stayed put');
    await ctx.close();
  });

  test('a chip inside a row wins: ⌘-click opens what the chip points at', async () => {
    const ctx = await browser.newContext();
    const page = await open(ctx, `#/table/${s.deals.id}`, '.wv-grid tbody tr.entity-row');
    const r = await modifierClick(ctx, page, `tr[data-eid="${s.acme.id}"] .k-rel a`);
    assert.ok(r.tab?.includes(`#/entity/${s.ada.id}`), `the chip's own target opened (got ${r.tab})`);
    assert.ok(r.stayed, 'the table stayed put');
    await ctx.close();
  });

  test('a grid row: the middle button opens the record in a tab too', async () => {
    const ctx = await browser.newContext();
    const page = await open(ctx, `#/table/${s.deals.id}`, '.wv-grid tbody tr.entity-row');
    const before = await page.evaluate(() => location.hash);
    const opened = ctx.waitForEvent('page', { timeout: 3000 }).catch(() => null);
    await page.click(`tr[data-eid="${s.bluefin.id}"] td[data-ftype="document"]`, { button: 'middle' });
    const tab = await opened;
    assert.ok(tab?.url().includes(`#/entity/${s.bluefin.id}`), 'the middle button opened a tab');
    await tab.close();
    assert.equal(await page.evaluate(() => location.hash), before, 'the table stayed put');
    await ctx.close();
  });

  test('a text cell keeps its modifiers: shift-click does not steal a tab', async () => {
    const ctx = await browser.newContext();
    const page = await open(ctx, `#/table/${s.deals.id}`, '.wv-grid tbody tr.entity-row');
    let opened = false;
    ctx.on('page', () => { opened = true; });
    await page.click(`tr[data-eid="${s.acme.id}"] td.name-cell input`, { modifiers: ['Shift'] });
    await page.waitForTimeout(400);
    assert.equal(opened, false, 'shift-click in a text field is the text field’s');
    await ctx.close();
  });

  test('the relation panel on an entity page: ⌘-click on a row opens a tab', async () => {
    const ctx = await browser.newContext();
    const page = await open(ctx, `#/entity/${s.ada.id}`, 'tbody tr.entity-row');
    const r = await modifierClick(ctx, page, 'tbody tr.entity-row', { position: { x: 3, y: 3 } });
    assert.ok(r.tab?.includes('#/entity/'), `a tab opened on the related record (got ${r.tab})`);
    assert.ok(r.stayed, 'the entity page stayed put');
    await ctx.close();
  });

  test('an activity row: ⌘-click opens the event in a tab', async () => {
    const ctx = await browser.newContext();
    const page = await open(ctx, '#/activity', 'tr.activity-row');
    const r = await modifierClick(ctx, page, 'tr.activity-row td.activity-when');
    assert.ok(r.tab?.includes('#/activity/'), `a tab opened on the event (got ${r.tab})`);
    assert.ok(r.stayed, 'the feed stayed put');
    await ctx.close();
  });

  test('the workspace home Activity row: ⌘-click opens a tab', async () => {
    const ctx = await browser.newContext();
    const page = await open(ctx, '#/', '.list-rows.system-tables .list-row');
    const r = await modifierClick(ctx, page, '.list-rows.system-tables .list-row');
    assert.ok(r.tab?.includes('#/activity'), `a tab opened on the feed (got ${r.tab})`);
    assert.ok(r.stayed, 'home stayed put');
    await ctx.close();
  });

  test('a relation-map node: ⌘-click opens the table in a tab', async () => {
    const ctx = await browser.newContext();
    const page = await open(ctx, '#/map', 'svg g.table-node');
    const r = await modifierClick(ctx, page, 'svg g.table-node .node-box');
    assert.ok(r.tab?.includes('#/table/'), `a tab opened on the table (got ${r.tab})`);
    assert.ok(r.stayed, 'the map stayed put');
    await ctx.close();
  });

  test('a registry row: ⌘-click opens the table it stands for, not a record page', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
    const tables = await page.getAttribute('a.nav-db:has-text("Tables")', 'href');
    await page.goto(`${base}/${tables}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    const row = page.locator('tr.entity-row').first();
    assert.match(await row.getAttribute('data-href'), /^#\/table\//, 'the row points at the table it stands for');
    // Every cell in the registry grid is an editor; the click lands on the
    // padding at the far edge of the last one, which belongs to the row.
    const cell = row.locator('td[data-field="Workflows"]');
    const box = await cell.boundingBox();
    const r = await modifierClick(ctx, page, 'tr.entity-row td[data-field="Workflows"]', { position: { x: box.width - 4, y: box.height - 4 } });
    assert.ok(r.tab?.includes('#/table/'), `the tab opened on a table, not a record (got ${r.tab})`);
    assert.ok(r.stayed, 'the registry stayed put');
    await ctx.close();
  });

  test('a ⌘K hit: ⌘-click opens it in a tab and leaves the palette open', async () => {
    const ctx = await browser.newContext();
    const page = await open(ctx, `#/table/${s.deals.id}`, '.wv-grid tbody tr.entity-row');
    await page.click('#search-btn');
    await page.fill('#cmdk-input', 'Acme');
    await page.waitForSelector('#cmdk-results .result');
    const r = await modifierClick(ctx, page, '#cmdk-results .result .result-main span:nth-child(2)');
    assert.ok(r.tab?.includes(s.acme.id), `a tab opened on the hit (got ${r.tab})`);
    assert.ok(await page.locator('#cmdk-back').count(), 'the palette is still open');
    await ctx.close();
  });
}
