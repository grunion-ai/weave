import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const ROWS = 2000;
const NODE_BUDGET = 6000;
const LIST_CAP = 200;
const BOARD_CAP = 40;
const STATES = ['Open', 'Doing', 'Done'];

let big;
const s = await launch('list and board volume', (weave) => {
  weave.createSpace({ name: 'Volume' });
  big = weave.createTable({ space: 'Volume', name: 'Case' });
  weave.addField(big.id, { name: 'State', type: 'select', config: { options: STATES.map((name) => ({ name })) } });
  for (let i = 0; i < ROWS; i++) weave.createEntity(big.id, { name: `Case ${i}`, values: { State: STATES[i % STATES.length] } });
});

if (s) {
  const { base, browser, weave } = s;
  const layout = (view) => {
    for (const v of weave.tableView(big).views) if (v.name !== 'Standard') weave.tableView(`${big.id}/${v.id}`, { delete: true });
    weave.tableView(`${big.id}/Standard`, {
      groups: null, picture: null, completedBy: null, nest: null, collapsed: null, order: null, filters: {}, sort: [],
      fields: ['Name', 'State'], ...view,
    });
  };
  const open = async (theme = 'light') => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.errors = errors;
    await page.goto(`${base}/#/table/${big.id}`, { waitUntil: 'networkidle' });
    return page;
  };
  const elements = (page) => page.evaluate(() => document.querySelectorAll('*').length);

  test(`a ${ROWS}-row list draws one capped page, not every row (Issue #1266)`, async (t) => {
    layout({ layout: 'list', group: null });
    const page = await open();
    await page.waitForSelector('.wv-list .list-row');
    const drawn = await page.locator('.wv-list .list-row').count();
    const total = await elements(page);
    t.diagnostic(`list: ${drawn} rows drawn, ${total} elements`);
    assert.equal(drawn, LIST_CAP, 'the list draws one cap of rows, not every row');
    assert.ok(total < NODE_BUDGET, `${total} elements, budget ${NODE_BUDGET}: Issue #1266 measured 64,974 nodes drawing all ${ROWS} rows`);
    const more = page.locator('.wv-list .wv-more');
    assert.equal((await more.textContent()).trim(), `Show ${LIST_CAP} more · ${LIST_CAP} of ${ROWS} rows`);
    await more.click();
    assert.equal(await page.locator('.wv-list .list-row').count(), LIST_CAP * 2, 'Show more extends the list by one cap');
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test(`a ${ROWS}-row board draws capped columns, not every card (Issue #1266)`, async (t) => {
    layout({ layout: 'board', group: ['State'] });
    const page = await open();
    await page.waitForSelector('.wv-board .tile');
    const per = await page.evaluate(() => [...document.querySelectorAll('.board-cards')].map((c) => c.querySelectorAll('.tile').length));
    const total = await elements(page);
    t.diagnostic(`board: columns ${per.join(', ')}, ${total} elements`);
    assert.equal(per.length, STATES.length, `one column per State, saw ${per.length}`);
    assert.ok(per.every((n) => n <= BOARD_CAP), `every column draws at most one cap of cards, saw ${per.join(', ')}`);
    assert.ok(total < NODE_BUDGET, `${total} elements, budget ${NODE_BUDGET}: Issue #1266 measured 120,644 nodes drawing all ${ROWS} cards`);
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('a capped board column extends from its own Show more (Issue #1266)', async () => {
    layout({ layout: 'board', group: ['State'] });
    const page = await open();
    await page.waitForSelector('.wv-board .tile');
    const column = page.locator('.board-cards').first();
    await column.locator('.wv-more').click();
    assert.equal(await column.locator('.tile').count(), BOARD_CAP * 2, 'the column grows by one cap and the others stay put');
    const per = await page.evaluate(() => [...document.querySelectorAll('.board-cards')].map((c) => c.querySelectorAll('.tile').length));
    assert.deepEqual(per.slice(1), per.slice(1).map(() => BOARD_CAP), 'only the clicked column grew');
    assert.deepEqual(page.errors, []);
    await page.close();
  });

  test('the Show more control draws in both themes (Issue #1266)', async () => {
    layout({ layout: 'list', group: null });
    for (const theme of ['light', 'dark']) {
      const page = await open(theme);
      const more = page.locator('.wv-list .wv-more');
      await more.waitFor();
      assert.ok(await more.isVisible(), `${theme}: the Show more button is visible`);
      const box = await more.boundingBox();
      assert.ok(box.height >= 24 && box.width >= 80, `${theme}: the control has a real hitbox, saw ${box.width}x${box.height}`);
      await page.close();
    }
  });
}
