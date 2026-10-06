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

  const opensTab = ({ hash, wait, click, opts, want, opened, stayed }) => async () => {
    const ctx = await browser.newContext();
    const page = await open(ctx, hash, wait);
    const r = await modifierClick(ctx, page, click, opts);
    assert.ok(r.tab?.includes(want), `${opened} (got ${r.tab})`);
    assert.ok(r.stayed, stayed);
    await ctx.close();
  };

  test('a grid row: ⌘-click on a cell opens the record in a tab', opensTab({
    hash: `#/table/${s.deals.id}`, wait: '.wv-grid tbody tr.entity-row',
    click: `tr[data-eid="${s.acme.id}"] td[data-ftype="document"]`,
    want: `#/entity/${s.acme.id}`, opened: 'a tab opened on the record', stayed: 'the table stayed put',
  }));

  test('a chip inside a row wins: ⌘-click opens what the chip points at', opensTab({
    hash: `#/table/${s.deals.id}`, wait: '.wv-grid tbody tr.entity-row',
    click: `tr[data-eid="${s.acme.id}"] .k-rel a`,
    want: `#/entity/${s.ada.id}`, opened: 'the chip\'s own target opened', stayed: 'the table stayed put',
  }));

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

  test('the relation panel on an entity page: ⌘-click on a row opens a tab', opensTab({
    hash: `#/entity/${s.ada.id}`, wait: 'tbody tr.entity-row',
    click: 'tbody tr.entity-row', opts: { position: { x: 3, y: 3 } },
    want: '#/entity/', opened: 'a tab opened on the related record', stayed: 'the entity page stayed put',
  }));

  test('an activity row: ⌘-click opens the event in a tab', opensTab({
    hash: '#/activity', wait: 'tr.activity-row', click: 'tr.activity-row td.activity-when',
    want: '#/activity/', opened: 'a tab opened on the event', stayed: 'the feed stayed put',
  }));

  test('the workspace home Activity row: ⌘-click opens a tab', opensTab({
    hash: '#/', wait: '.list-rows.system-tables .list-row', click: '.list-rows.system-tables .list-row',
    want: '#/activity', opened: 'a tab opened on the feed', stayed: 'home stayed put',
  }));

  test('a relation-map node: ⌘-click opens the table in a tab', opensTab({
    hash: '#/map', wait: 'svg g.table-node', click: 'svg g.table-node .node-box',
    want: '#/table/', opened: 'a tab opened on the table', stayed: 'the map stayed put',
  }));

  test('a registry row: ⌘-click opens the table it stands for, not a record page', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
    const tables = await page.getAttribute('a.nav-db:has-text("Tables")', 'href');
    await page.goto(`${base}/${tables}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    const row = page.locator('tr.entity-row').first();
    assert.match(await row.getAttribute('data-href'), /^#\/table\//, 'the row points at the table it stands for');
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
    await page.waitForSelector('#cmdk-results[data-query="Acme"] .result');
    const r = await modifierClick(ctx, page, '#cmdk-results .result .cmdk-name');
    assert.ok(r.tab?.includes(s.acme.id), `a tab opened on the hit (got ${r.tab})`);
    assert.ok(await page.locator('#cmdk-back').count(), 'the palette is still open');
    await ctx.close();
  });
}
