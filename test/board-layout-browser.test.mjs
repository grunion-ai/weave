import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually, atRest } from './lib/browser.mjs';
import { openPane } from './lib/view-pane.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

let list, ids, pics;
const s = await launch('board layout', (weave) => {
  weave.createSpace({ name: 'Buyer' });
  list = weave.createTable({ space: 'Buyer', name: 'Shopping List' });
  weave.updateTable(list.id, { noun: 'item' });
  weave.addField(list.id, { name: 'State', type: 'select', config: { options: [{ name: 'Research' }, { name: 'Ready to Buy', hue: 'green' }, { name: 'Bought', hue: 'blue' }] } });
  weave.addField(list.id, { name: 'Best Price', type: 'number', config: { format: 'currency', currency: 'USD' } });
  weave.addField(list.id, { name: 'Photo', type: 'attachments', config: { multiple: false, preview: 'cover', size: 'medium' } });
});

if (s) {
  const { base, browser, weave } = s;
  const seed = (view = {}) => {
    for (const e of weave.listEntities(list.id)) weave.deleteEntity(e.id, { hard: true });
    const mk = (name, State, price) => weave.createEntity(list.id, { name, values: { State, 'Best Price': price } }).id;
    ids = {
      desk: mk('Standing desk', 'Ready to Buy', 449),
      chair: mk('Chair', 'Ready to Buy', 939),
      mat: mk('Walking mat', 'Ready to Buy', 1045),
      pants: mk('Black pants', 'Research', 210),
      shoes: mk('Dress shoes', 'Research', 126),
    };
    pics = {
      desk: weave.attachToField(ids.desk, 'Photo', { name: 'desk.png', mime: 'image/png', bytes: PNG }),
      chair: weave.attachToField(ids.chair, 'Photo', { name: 'chair.png', mime: 'image/png', bytes: PNG }),
    };
    for (const v of weave.tableView(list).views) if (v.name !== 'Standard') weave.tableView(`${list.id}/${v.id}`, { delete: true });
    weave.tableView(`${list.id}/Standard`, {
      layout: 'board', groups: null, picture: null, group: ['State'], completedBy: null,
      fields: ['Name', 'State', 'Best Price', 'Photo'], collapsed: null, order: null, filters: {}, sort: [], ...view,
    });
  };
  const open = async ({ theme = 'light', width = 1280, height = 900 } = {}) => {
    const page = await browser.newPage({ viewport: { width, height }, colorScheme: theme });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.errors = errors;
    await page.goto(`${base}/#/table/${list.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-board .tile');
    return page;
  };
  const view = () => weave.tableView(`${list.id}/Standard`);
  const valueOf = (id, f) => weave.readEntity(id).fields[f];
  const pid = (id) => weave.readEntity(id).publicId;
  const tilesIn = (page, key) => page.$$eval(`.board-group[data-key="${key}"] .tile`, (ts) => ts.map((t) => t.dataset.eid));
  const tile = (id) => `.wv-board .tile[data-eid="${id}"]`;
  const drag = async (page, fromSel, toSel, { dx = 0, dy = 0, at = 'center' } = {}) => {
    const from = await page.locator(fromSel).boundingBox();
    const to = await page.locator(toSel).boundingBox();
    const x0 = from.x + from.width / 2, y0 = from.y + Math.min(14, from.height / 2);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + 6, y0 + 6, { steps: 3 });
    const tx = at === 'right' ? to.x + to.width - 4 : to.x + to.width / 2;
    await page.mouse.move(tx + dx, to.y + to.height / 2 + dy, { steps: 12 });
    await page.mouse.move(tx + dx + 1, to.y + to.height / 2 + dy + 1, { steps: 2 });
    await page.mouse.up();
  };

  test('groups collapse to a narrow rail and restore after reload', async () => {
    seed({ picture: 'off' });
    const page = await open();
    try {
      const group = page.locator('.board-group[data-key="Research"]');
      const fold = group.locator('.list-fold');
      await fold.click();
      assert.equal(await fold.getAttribute('aria-expanded'), 'false');
      assert.ok((await group.boundingBox()).width < 80);
      assert.equal(await group.locator('.board-cards').isVisible(), false);
      await eventually(() => view().collapsed?.includes('Research'), true);
      await page.reload();
      await page.waitForSelector('.board-group.shut');
      await page.locator('.board-group[data-key="Research"] .list-fold').click();
      assert.equal(await group.locator('.tile').count(), 2);
      await eventually(() => view().collapsed?.includes('Research'), false);
    } finally { await page.close(); }
  });

  test('card density changes spacing and selection never covers the ID or title in either theme', async () => {
    for (const theme of ['light', 'dark']) {
      const heights = [];
      for (const density of ['compact', 'comfortable', 'spacious']) {
        seed({ picture: 'off', density });
        const page = await open({ theme });
        try {
          const card = page.locator(tile(ids.desk));
          await card.hover();
          heights.push((await card.boundingBox()).height);
          const pick = await card.locator('.tile-pick').boundingBox();
          for (const selector of ['.tile-id', '.tile-title']) {
            const text = await card.locator(selector).boundingBox();
            assert.ok(pick.x >= text.x + text.width || pick.x + pick.width <= text.x || pick.y >= text.y + text.height || pick.y + pick.height <= text.y);
          }
          assert.equal(await page.locator('.board-wrap').evaluate((n) => getComputedStyle(n).borderTopWidth), '0px');
          if (density === 'comfortable') {
            await openPane(page, 'display');
            await page.locator('#view-pane .vp-density .seg-opt', { hasText: 'Compact' }).click();
            assert.equal(await page.locator('.board-wrap').getAttribute('data-density'), 'compact');
            assert.ok((await card.boundingBox()).height < heights[1]);
            await eventually(() => view().density, 'compact');
          }
        } finally { await page.close(); }
      }
      assert.ok(heights[0] < heights[1] && heights[1] < heights[2], `${theme}: density heights ${heights}`);
    }
  });

  test('side by side draws one card per row, a column per State option, and the cover picture', async () => {
    seed();
    for (const theme of ['light', 'dark']) {
      const page = await open({ theme });
      try {
        assert.equal(await page.locator('.wv-board').getAttribute('data-groups'), 'side', 'side by side is the default');
        assert.equal(await page.locator('.wv-board .tile').count(), 5, 'one card per row');
        assert.deepEqual(await page.$$eval('.wv-board > .board-group', (gs) => gs.map((g) => g.dataset.key)), ['Research', 'Ready to Buy', 'Bought']);
        assert.equal(await page.locator('.board-group[data-key="Bought"] .tile').count(), 0);
        assert.equal(await page.locator('.board-group[data-key="Bought"] .board-empty').count(), 1, 'an empty column still shows, as a drop target');
        assert.match(await page.locator(`${tile(ids.desk)} .tile-cover img`).getAttribute('src'), new RegExp(`/api/files/${pics.desk.id}(\\?preview)?$`), 'the card loads the cover, through its small preview when it has one');
        assert.equal(await page.locator(`${tile(ids.mat)} .tile-cover.is-empty`).count(), 1, 'a row with no picture keeps the card shape');
        assert.equal(await page.locator(`${tile(ids.desk)} .tile-title`).getAttribute('draggable'), 'false', 'the title link never starts a native link drag');
        assert.equal(await page.locator(`${tile(ids.desk)} .tile-field[data-field="Photo"]`).count(), 0, 'the cover field is the picture, not a card field');
        const col = await page.locator('.board-group[data-key="Research"]').evaluate((n) => n.getBoundingClientRect().width);
        assert.equal(Math.round(col), 232, 'a medium picture gives 232 px columns');
        const ink = await page.locator('.tile-title').first().evaluate((n) => getComputedStyle(n).color);
        const card = await page.locator('.tile').first().evaluate((n) => getComputedStyle(n).backgroundColor);
        assert.notEqual(ink, card, `${theme}: titles read against the card`);
        assert.deepEqual(page.errors, []);
      } finally { await page.close(); }
    }
  });

  test('a long title wraps inside the card and nothing is cut off (Issue #1123)', async () => {
    seed();
    const long = weave.createEntity(list.id, { name: 'Standing desk: a title that runs well past the card so the tile has to wrap it somewhere sensible', values: { State: 'Research' } }).id;
    const page = await open();
    try {
      const title = page.locator(`${tile(long)} .tile-title`);
      await atRest(title);
      const box = (n) => ({ height: n.getBoundingClientRect().height, over: n.scrollWidth - n.clientWidth, lines: n.getClientRects().length });
      const got = await title.evaluate(box);
      const short = await page.locator(`${tile(ids.pants)} .tile-title`).evaluate(box);
      assert.ok(got.height > short.height, `the long title takes more lines than a short one: ${JSON.stringify({ got, short })}`);
      assert.ok(got.over <= 1, `no title text runs past the card: ${got.over}px hidden`);
      assert.equal(await title.evaluate((n) => getComputedStyle(n).textOverflow), 'clip', 'no ellipsis stands in for the title');
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  });

  test('picture off draws no cover; stacked sizes cards from the picture size', async () => {
    seed({ picture: 'off' });
    let page = await open();
    try {
      assert.equal(await page.locator('.wv-board .tile-cover').count(), 0);
    } finally { await page.close(); }
    seed({ groups: 'stacked', picture: 'small', group: null });
    page = await open();
    try {
      assert.equal(await page.locator('.wv-board').getAttribute('data-groups'), 'stacked');
      const w = await page.locator('.wv-board .tile').first().evaluate((n) => n.getBoundingClientRect().width);
      assert.ok(w >= 132 && w < 188, `a small card is at least 132 px and under the medium size: ${w}`);
    } finally { await page.close(); }
  });

  test('a drop keeps its board connected until the lifted card settles', async () => {
    seed({ picture: 'off' });
    const page = await open();
    try {
      await page.evaluate(() => {
        window.boardSettlingCuts = [];
        new MutationObserver((changes) => {
          for (const change of changes) for (const node of change.removedNodes) {
            if (node.nodeType === 1 && node.matches('.board-wrap') && node.querySelector('.wv-reorder-lift')) window.boardSettlingCuts.push(true);
          }
        }).observe(document.querySelector('#main'), { childList: true });
      });
      await drag(page, tile(ids.pants), '.board-group[data-key="Bought"] .board-empty');
      await page.waitForFunction((id) => !!document.querySelector(`.board-group[data-key="Bought"] .tile[data-eid="${id}"]:not(.wv-reorder-slot)`), ids.pants);
      assert.deepEqual(await page.evaluate(() => window.boardSettlingCuts), []);
      assert.equal(await eventually(() => valueOf(ids.pants, 'State'), 'Bought'), 'Bought');
    } finally { await page.close(); }
  });

  test('dragging a card into another column writes State, and Undo puts it back', async () => {
    seed();
    const page = await open();
    try {
      await drag(page, tile(ids.pants), '.board-group[data-key="Bought"] .board-empty');
      assert.equal(await eventually(() => valueOf(ids.pants, 'State'), 'Bought'), 'Bought', 'the card lands in the empty column, not the one beside it');
      await page.waitForFunction((id) => !!document.querySelector(`.board-group[data-key="Bought"] .tile[data-eid="${id}"]`), ids.pants);
      const note = page.locator('.wv-toast', { hasText: `#${pid(ids.pants)} moved to Bought` });
      await note.waitFor();
      await note.locator('.wv-toast-action').click();
      assert.equal(await eventually(() => valueOf(ids.pants, 'State'), 'Research'), 'Research');
      await page.waitForFunction((id) => !!document.querySelector(`.board-group[data-key="Research"] .tile[data-eid="${id}"]`), ids.pants);
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  });

  test('a failed group move restores the saved card position', async () => {
    seed({ picture: 'off' });
    const page = await open();
    try {
      await page.route(`**/api/entities/${ids.pants}`, (route) => route.request().method() === 'PATCH'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Move refused' }) }) : route.continue());
      await drag(page, tile(ids.pants), '.board-group[data-key="Bought"] .board-empty');
      await page.locator('.wv-toast', { hasText: 'Move refused' }).waitFor();
      assert.equal(await page.locator(`.board-group[data-key="Research"] ${tile(ids.pants).replace('.wv-board ', '')}`).count(), 1);
      assert.equal(valueOf(ids.pants, 'State'), 'Research');
    } finally { await page.close(); }
  });

  test('with no groups and Manual order a drag saves the order in reading order', async () => {
    seed({ groups: 'stacked', group: null });
    const page = await open();
    try {
      const before = await tilesIn(page, '');
      assert.deepEqual(before, [ids.desk, ids.chair, ids.mat, ids.pants, ids.shoes]);
      await drag(page, tile(ids.desk), tile(ids.mat), { at: 'right' });
      const want = [ids.chair, ids.mat, ids.desk, ids.pants, ids.shoes].map(pid);
      await eventually(() => JSON.stringify(view().order ?? []), JSON.stringify(want));
      await page.waitForFunction((n) => document.querySelectorAll('.wv-board .tile').length === n, 5);
      assert.deepEqual(await tilesIn(page, ''), [ids.chair, ids.mat, ids.desk, ids.pants, ids.shoes]);
    } finally { await page.close(); }
  });

  test('a sort turns hand order off and the footer says to choose Manual; another column still takes the card', async () => {
    seed({ sort: [{ field: 'Best Price', dir: 'asc' }] });
    const page = await open();
    try {
      assert.match(await page.locator('.board-footer').textContent(), /choose Manual/);
      assert.deepEqual(await tilesIn(page, 'Ready to Buy'), [ids.desk, ids.chair, ids.mat], 'cheapest first');
      await drag(page, tile(ids.mat), tile(ids.desk), { dy: -10 });
      await page.waitForFunction((want) => [...document.querySelectorAll('.board-group[data-key="Ready to Buy"] .tile')].map((t) => t.dataset.eid).join() === want, [ids.desk, ids.chair, ids.mat].join());
      assert.equal(view().order, undefined, 'no hand order is saved while sorted');
      await drag(page, tile(ids.mat), '.board-group[data-key="Bought"] .board-empty');
      assert.equal(await eventually(() => valueOf(ids.mat, 'State'), 'Bought'), 'Bought');
    } finally { await page.close(); }
  });

  test('a card click opens the record in the pane beside the board; another card swaps it; Activity opens the side pane; Esc closes', async () => {
    seed();
    const page = await open();
    try {
      await page.click(`${tile(ids.desk)} .tile-title`);
      await page.waitForSelector('#dock:not([hidden]) .name-edit');
      assert.equal(await page.inputValue('#dock .name-edit'), 'Standing desk');
      assert.equal(await page.evaluate(() => location.hash), `#/table/${list.id}?e=${ids.desk}`);
      assert.equal(await page.locator(`${tile(ids.desk)}.row-docked`).count(), 1, 'the open card is outlined');
      const board = await page.locator('#main').boundingBox();
      const dock = await page.locator('#dock').boundingBox();
      assert.ok(dock.x >= board.x + board.width - 1, 'the pane sits to the right of the board');
      await page.click(`${tile(ids.chair)} .tile-body`);
      await page.waitForFunction(() => document.querySelector('#dock .name-edit')?.value === 'Chair');
      assert.equal(await page.locator('.wv-board .tile.row-docked').count(), 1);
      assert.equal(await page.locator(`${tile(ids.chair)}.row-docked`).count(), 1, 'the outline moves with the record');
      for (const [id, part, name] of [[ids.pants, '.tile-cover', 'Black pants'], [ids.shoes, '.tile-field[data-field="Best Price"] dt', 'Dress shoes'], [ids.mat, '.tile-body', 'Walking mat']]) {
        await page.click(`${tile(id)} ${part}`, { position: { x: 4, y: 4 } });
        await page.waitForFunction((n) => document.querySelector('#dock .name-edit')?.value === n, name);
      }
      await page.click(`${tile(ids.chair)} .tile-field[data-field="State"] .chip-trigger`);
      await page.waitForFunction(() => document.querySelector('#dock .name-edit')?.value === 'Chair');
      assert.equal(await page.locator('.picker-pop').count(), 1, 'a field value opens the pane and its own editor');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.picker-pop', { state: 'detached' });
      await page.click('#dock .activity-btn');
      await page.waitForSelector('#side:not([hidden]) aside.wv-activity');
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press('Escape');
      await page.waitForSelector('#side', { state: 'hidden' });
      await page.keyboard.press('Escape');
      await page.waitForSelector('#dock', { state: 'hidden' });
      assert.equal(await page.locator('.wv-board .tile.row-docked').count(), 0);
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  });

  test('on a phone the card opens the full-screen sheet', async () => {
    seed();
    const page = await open({ width: 375, height: 812 });
    try {
      await page.click(`${tile(ids.desk)} .tile-title`);
      await page.waitForSelector('#dock:not([hidden]) .name-edit');
      const r = await page.locator('#dock').boundingBox();
      assert.ok(r.x <= 1 && r.width >= 374, `the pane covers the screen: ${JSON.stringify(r)}`);
    } finally { await page.close(); }
  });

  test('a card field edits like a table cell: the State picker moves the card; Best Price saves and repaints', async () => {
    seed();
    const page = await open();
    try {
      await page.click(`${tile(ids.shoes)} .tile-field[data-field="State"] .chip-trigger`);
      await page.locator('.picker-pop .picker-row', { hasText: 'Ready to Buy' }).first().click();
      assert.equal(await eventually(() => valueOf(ids.shoes, 'State'), 'Ready to Buy'), 'Ready to Buy');
      await page.waitForFunction((id) => !!document.querySelector(`.board-group[data-key="Ready to Buy"] .tile[data-eid="${id}"]`), ids.shoes);
      await page.waitForFunction(() => document.querySelector('#dock .name-edit')?.value === 'Dress shoes');
      assert.ok(await page.locator('#dock').isVisible(), 'a click on a field value opens the record beside its editor');
      await page.click(`${tile(ids.desk)} .tile-field[data-field="Best Price"] .num-dressed`);
      const price = page.locator(`${tile(ids.desk)} .tile-field[data-field="Best Price"] input.inline-edit`);
      await price.fill('399');
      await price.press('Enter');
      assert.equal(await eventually(() => weave.readEntity(ids.desk).raw['Best Price'], 399), 399);
      await page.waitForFunction((id) => /399/.test(document.querySelector(`.wv-board .tile[data-eid="${id}"] .tile-field[data-field="Best Price"]`)?.textContent + (document.querySelector(`.wv-board .tile[data-eid="${id}"] .tile-field[data-field="Best Price"] input`)?.value ?? '')), ids.desk);
    } finally { await page.close(); }
  });

  test('at 375 px stacked gives two columns, side by side scrolls inside the board, and the page never scrolls sideways', async () => {
    seed({ groups: 'stacked' });
    let page = await open({ width: 375, height: 812 });
    try {
      const xs = await page.$$eval('.board-group[data-key="Ready to Buy"] .tile', (ts) => [...new Set(ts.map((t) => Math.round(t.getBoundingClientRect().left)))]);
      assert.equal(xs.length, 2, `two columns of cards: ${xs}`);
      assert.equal(await page.evaluate(() => document.scrollingElement.scrollWidth), 375);
    } finally { await page.close(); }
    seed();
    page = await open({ width: 375, height: 812 });
    try {
      const board = await page.locator('.wv-board').evaluate((n) => ({ sw: n.scrollWidth, cw: n.clientWidth, ox: getComputedStyle(n).overflowX }));
      assert.ok(board.sw > board.cw && /auto|scroll/.test(board.ox), `the board scrolls sideways: ${JSON.stringify(board)}`);
      assert.equal(await page.evaluate(() => document.scrollingElement.scrollWidth), 375);
    } finally { await page.close(); }
  });

  test('the View pane\'s Display offers Board with the Columns and Gallery presets', async () => {
    seed({ layout: 'table' });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${list.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      await openPane(page, 'display');
      await page.click('#view-pane .view-layout .seg-opt:text-is("Board")');
      await page.waitForSelector('.wv-board .tile');
      assert.equal(view().layout, 'board');
      await openPane(page, 'display');
      await page.click('.board-preset:text-is("Gallery")');
      await eventually(() => view().groups, 'stacked');
      assert.equal(view().picture, 'medium', 'Gallery shows the cover at its own size');
      await openPane(page, 'display');
      await page.click('.board-preset:text-is("Columns")');
      await eventually(() => view().groups, 'side');
      assert.equal(view().picture, 'off');
      assert.equal(view().sort, undefined, 'Columns is Manual');
      await openPane(page, 'display');
      await page.click('.board-picture .seg-opt:text-is("Large")');
      await eventually(() => view().picture, 'large');
      await page.waitForFunction(() => document.querySelector('.wv-board')?.dataset.picture === 'large');
    } finally { await page.close(); }
  });

  test('Hide empty groups drops the column with no cards and saves on the view (Feature #345)', async () => {
    seed();
    const page = await open();
    try {
      assert.equal(await page.locator('.board-group[data-key="Bought"]').count(), 1);
      const pane = await openPane(page, 'group');
      await pane.locator('[data-hide-empty]').click();
      assert.equal(await pane.locator('[data-hide-empty] input').isChecked(), true);
      await eventually(() => view().hideEmpty, true);
      await page.waitForFunction(() => !document.querySelector('.board-group[data-key="Bought"]'));
      assert.equal(await page.locator('.board-group[data-key="Research"] .tile').count(), 2);
      assert.equal(await page.locator('.board-group[data-key="Ready to Buy"] .tile').count(), 3);
      await pane.locator('[data-hide-empty]').click();
      await eventually(() => view().hideEmpty, undefined);
      await page.waitForSelector('.board-group[data-key="Bought"] .board-empty');
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  });
}
