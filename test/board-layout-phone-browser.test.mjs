import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually, phoneBrowser, phonePage, PHONE, atRest } from './lib/browser.mjs';
import { pointer, centre } from './lib/reorder-surfaces.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

let list, ids;
const s = await launch('board layout on a phone', (weave) => {
  weave.createSpace({ name: 'Buyer' });
  list = weave.createTable({ space: 'Buyer', name: 'Shopping List' });
  weave.updateTable(list.id, { noun: 'item' });
  weave.addField(list.id, { name: 'State', type: 'select', config: { options: [{ name: 'Research' }, { name: 'Ready to Buy', hue: 'green' }, { name: 'Bought', hue: 'blue' }] } });
  weave.addField(list.id, { name: 'Best Price', type: 'number', config: { format: 'currency', currency: 'USD' } });
  weave.addField(list.id, { name: 'Researched', type: 'date' });
  weave.addField(list.id, { name: 'Photo', type: 'attachments', config: { multiple: false, preview: 'cover', size: 'medium' } });
});

if (s) {
  const { base, browser, weave } = s;
  const seed = (view = {}) => {
    for (const e of weave.listEntities(list.id)) weave.deleteEntity(e.id, { hard: true });
    const mk = (name, State, price) => weave.createEntity(list.id, { name, values: { State, 'Best Price': price, Researched: '2026-10-09' } }).id;
    ids = {
      desk: mk('Standing desk', 'Ready to Buy', 449),
      chair: mk('Chair', 'Ready to Buy', 939),
      mat: mk('Walking mat', 'Ready to Buy', 1045),
      rug: mk('Rug', 'Ready to Buy', 249),
      pants: mk('Black pants', 'Research', 210),
      shoes: mk('Dress shoes', 'Research', 126),
    };
    for (const id of [ids.desk, ids.chair, ids.pants]) weave.attachToField(id, 'Photo', { name: 'p.png', mime: 'image/png', bytes: PNG });
    weave.tableView(`${list.id}/Standard`, {
      layout: 'board', groups: 'stacked', picture: null, group: ['State'],
      fields: ['Name', 'State', 'Best Price', 'Researched', 'Photo'], order: null, filters: {}, sort: [], ...view,
    });
  };
  const engines = [
    { name: 'Chromium 375 × 812', page: () => browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }) },
    { name: `WebKit ${PHONE}`, page: async () => phonePage(await phoneBrowser()) },
  ];
  const open = async (engine) => {
    const page = await engine.page();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.errors = errors;
    await page.goto(`${base}/#/table/${list.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-board .tile');
    return page;
  };
  const tile = (id) => `.wv-board .tile[data-eid="${id}"]`;
  const columnsOf = (page, key) => page.$$eval(`.board-group[data-key="${key}"] .tile`, (ts) => new Set(ts.map((t) => Math.round(t.getBoundingClientRect().left))).size);
  const pageScrollsSideways = (page) => page.evaluate(() => document.scrollingElement.scrollWidth > document.documentElement.clientWidth);

  for (const engine of engines) {
    test(`${engine.name}: stacked cards per row follow the picture size, and the page never scrolls sideways`, async () => {
      for (const [picture, cols, shown] of [['small', 3, 0], ['medium', 2, 2], ['large', 2, 2]]) {
        seed({ picture });
        const page = await open(engine);
        try {
          assert.equal(await columnsOf(page, 'Ready to Buy'), cols, `${picture}: ${cols} cards per row`);
          const visible = await page.$$eval(`${tile(ids.desk)} .tile-field`, (fs) => fs.filter((f) => (f.querySelector('dd')?.getBoundingClientRect().height ?? 0) > 0).length);
          assert.equal(visible, shown, `${picture}: ${shown} fields show on the card`);
          assert.equal(await pageScrollsSideways(page), false);
          assert.deepEqual(page.errors, []);
        } finally { await page.close(); }
      }
    });

    test(`${engine.name}: side by side snaps one column to the screen with the next one peeking, under sticky headings`, async () => {
      seed({ groups: 'side' });
      const page = await open(engine);
      try {
        const board = await page.locator('.wv-board').evaluate((n) => ({ snap: getComputedStyle(n).scrollSnapType, sw: n.scrollWidth, cw: n.clientWidth }));
        assert.match(board.snap, /x mandatory/);
        assert.ok(board.sw > board.cw, 'the board scrolls inside itself');
        const col = await page.locator('.board-group[data-key="Research"]').evaluate((n) => n.getBoundingClientRect().width);
        const vw = await page.evaluate(() => innerWidth);
        assert.ok(Math.abs(col - vw * 0.85) <= 8, `a column is about 85vw: ${col} of ${vw}`);
        const next = await page.locator('.board-group[data-key="Ready to Buy"]').evaluate((n) => n.getBoundingClientRect().left);
        assert.ok(next < vw, 'the next column peeks in');
        assert.equal(await page.locator('.board-group[data-key="Research"] .board-group-head').evaluate((n) => getComputedStyle(n).position), 'sticky');
        assert.equal(await page.locator(tile(ids.pants)).evaluate((n) => getComputedStyle(n).touchAction), 'pan-x pan-y');
        assert.equal(await pageScrollsSideways(page), false);
      } finally { await page.close(); }
    });

    test(`${engine.name}: a hold lifts a card and carries it into another column; a quick swipe only scrolls`, async () => {
      seed({ groups: 'side' });
      const page = await open(engine);
      try {
        const hand = pointer(page, { touch: true });
        const at = await centre(page.locator(`${tile(ids.shoes)} .tile-head`));
        await hand.press(at);
        await hand.to({ x: at.x, y: at.y - 40 }, 3);
        await page.waitForTimeout(400);
        assert.equal(await page.locator('.wv-reorder-lift').count(), 0, 'a finger that travels first scrolls');
        await hand.release();

        const from = await centre(page.locator(`${tile(ids.pants)} .tile-head`));
        await hand.press(from);
        await hand.hold();
        const vw = await page.evaluate(() => innerWidth);
        await hand.to({ x: vw - 6, y: from.y }, 8);
        await page.waitForFunction(() => document.querySelector('.wv-board').scrollLeft > 40, null, { timeout: 5000 });
        await hand.to({ x: vw - 60, y: from.y }, 3);
        await hand.release();
        const moved = await eventually(() => weave.readEntity(ids.pants).fields.State !== 'Research', true);
        assert.equal(moved, true, 'the card left Research for another column');
        const state = weave.readEntity(ids.pants).fields.State;
        await page.waitForFunction(([id, key]) => !!document.querySelector(`.board-group[data-key="${key}"] .tile[data-eid="${id}"]`), [ids.pants, state]);
        assert.ok(await page.locator('#dock').isHidden(), 'a drag never opens the record');
      } finally { await page.close(); }
    });

    test(`${engine.name}: the title, card fields and view controls are at least 44 px tall`, async () => {
      seed({ groups: 'side' });
      const page = await open(engine);
      try {
        const heights = await page.$$eval(`${tile(ids.desk)} :is(.tile-title, .tile-field > dd)`, (ns) => ns.map((n) => n.getBoundingClientRect().height));
        assert.ok(heights.length >= 2 && heights.every((h) => h >= 44), `targets: ${heights}`);
        await page.locator('.table-tools-btn').tap();
        await page.locator('.table-view-btn').tap();
        await page.waitForSelector('.table-view-popover .board-picture');
        const controls = await page.$$eval('.table-view-popover :is(.view-layout .seg-opt, .board-preset)', (ns) => ns.map((n) => [n.textContent, n.offsetHeight]));
        assert.ok(controls.length >= 10, `Layout, presets, Groups and Picture sit in the phone menu: ${controls.length}`);
        assert.deepEqual(controls.filter(([, h]) => h < 44), [], 'every control is a 44 px target');
      } finally { await page.close(); }
    });

    test(`${engine.name}: a long title wraps inside the card, stays a 44 px target and nothing is cut off (Issue #1123)`, async () => {
      seed();
      const long = weave.createEntity(list.id, { name: 'Standing desk: a title that runs well past the card so the tile has to wrap it somewhere sensible', values: { State: 'Research' } }).id;
      const page = await open(engine);
      try {
        const title = page.locator(`${tile(long)} .tile-title`);
        await atRest(title);
        const box = (n) => ({ height: n.getBoundingClientRect().height, over: n.scrollWidth - n.clientWidth });
        const got = await title.evaluate(box);
        const short = await page.locator(`${tile(ids.pants)} .tile-title`).evaluate(box);
        assert.ok(got.height > short.height && short.height >= 44, `the long title takes more lines than a short one and both stay 44 px targets: ${JSON.stringify({ got, short })}`);
        assert.ok(got.over <= 1, `no title text runs past the card: ${got.over}px hidden`);
        assert.equal(await pageScrollsSideways(page), false, 'a wrapped title never widens the page');
        assert.deepEqual(page.errors, []);
      } finally { await page.close(); }
    });

    test(`${engine.name}: a tap on a card or on one of its fields opens the full-screen sheet, and Back closes it`, async () => {
      seed();
      const page = await open(engine);
      try {
        await page.locator(`${tile(ids.desk)} .tile-cover`).tap();
        await page.waitForSelector('#dock:not([hidden]) .name-edit');
        const r = await page.locator('#dock').boundingBox();
        const vw = await page.evaluate(() => innerWidth);
        assert.ok(r.x <= 1 && r.width >= vw - 1, `the record covers the screen: ${JSON.stringify(r)}`);
        await page.goBack();
        await page.waitForSelector('#dock', { state: 'hidden' });
        await page.locator(`${tile(ids.chair)} .tile-field[data-field="State"] dd`).tap();
        await page.waitForSelector('#dock:not([hidden]) .name-edit');
        assert.equal(await page.inputValue('#dock .name-edit'), 'Chair');
        assert.equal(await page.locator('.picker-pop').count(), 0, 'the card opens no picker of its own on a phone');
        assert.equal(await page.evaluate(() => !!document.activeElement?.closest('.wv-board .tile-field')), false, 'no editor takes focus on the card');
        await page.goBack();
        await page.waitForSelector('#dock', { state: 'hidden' });
        assert.deepEqual(page.errors, []);
      } finally { await page.close(); }
    });
  }
}
