import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';
import { pointer, centre } from './lib/reorder-surfaces.mjs';

let list, ids;
const s = await launch('board swimlanes', (weave) => {
  weave.createSpace({ name: 'Buyer' });
  list = weave.createTable({ space: 'Buyer', name: 'Shopping List' });
  weave.updateTable(list.id, { noun: 'item' });
  weave.addField(list.id, { name: 'State', type: 'select', config: { options: [{ name: 'Research' }, { name: 'Ready to Buy', hue: 'green' }, { name: 'Bought', hue: 'blue' }] } });
  weave.addField(list.id, { name: 'Room', type: 'select', config: { options: [{ name: 'Office' }, { name: 'Bedroom' }, { name: 'Kitchen' }] } });
  weave.addField(list.id, { name: 'Best Price', type: 'number', config: { format: 'currency', currency: 'USD' } });
});

if (s) {
  const { base, browser, weave } = s;
  const SEP = ' › ';
  const seed = (view = {}) => {
    for (const e of weave.listEntities(list.id)) weave.deleteEntity(e.id, { hard: true });
    const mk = (name, State, Room, price) => weave.createEntity(list.id, { name, values: { State, Room, 'Best Price': price } }).id;
    ids = {
      desk: mk('Standing desk', 'Ready to Buy', 'Office', 449),
      chair: mk('Chair', 'Ready to Buy', 'Office', 939),
      bed: mk('Bed frame', 'Research', 'Bedroom', 610),
      lamp: mk('Lamp', 'Research', 'Office', 89),
    };
    weave.tableView(`${list.id}/Standard`, {
      layout: 'board', groups: 'side', picture: 'off', group: ['State', 'Room'], collapsed: null,
      fields: ['Name', 'State', 'Room', 'Best Price'], order: null, filters: {}, sort: [], ...view,
    });
  };
  const open = async ({ theme = 'light', phone = false } = {}) => {
    const page = await browser.newPage(phone
      ? { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, colorScheme: theme }
      : { viewport: { width: 1280, height: 900 }, colorScheme: theme });
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    await page.goto(`${base}/#/table/${list.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-board .tile', { state: 'attached' });
    return page;
  };
  const view = () => weave.tableView(`${list.id}/Standard`);
  const raw = (id, f) => weave.readEntity(id).fields[f];
  const card = (id) => `.tile[data-eid="${id}"]`;
  const tile = (id) => `.wv-board ${card(id)}`;
  const cell = (state, room) => `.wv-board .board-lane[data-key="${room}"] .board-group[data-key="${state}${SEP}${room}"]`;
  const inCell = (page, state, room) => page.$$eval(`${cell(state, room)} .tile`, (ts) => ts.map((t) => t.dataset.eid));
  const drag = async (page, fromSel, toSel) => {
    const from = await page.locator(fromSel).boundingBox();
    const to = await page.locator(toSel).boundingBox();
    const x0 = from.x + from.width / 2, y0 = from.y + Math.min(14, from.height / 2);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + 6, y0 + 6, { steps: 3 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    const there = await page.locator(toSel).boundingBox();
    await page.mouse.move(there.x + there.width / 2, there.y + there.height / 2, { steps: 4 });
    await page.mouse.move(there.x + there.width / 2 + 1, there.y + there.height / 2 + 1, { steps: 2 });
    await page.mouse.up();
  };

  for (const theme of ['light', 'dark']) {
    test(`side by side with a second group draws lanes across the columns, a cell per column (${theme})`, async () => {
      seed();
      const page = await open({ theme });
      try {
        assert.equal(await page.locator('.wv-board').getAttribute('data-lanes'), 'true');
        assert.deepEqual(await page.$$eval('.wv-board .board-col-head', (hs) => hs.map((h) => h.dataset.key)), ['Research', 'Ready to Buy', 'Bought']);
        assert.deepEqual(await page.$$eval('.wv-board .board-lane', (ls) => ls.map((l) => l.dataset.key)), ['Office', 'Bedroom', 'Kitchen'], 'every Room option is a lane, the empty one too');
        assert.equal(await page.locator('.board-lane[data-key="Office"] .board-group').count(), 3);
        assert.deepEqual(await inCell(page, 'Ready to Buy', 'Office'), [ids.desk, ids.chair]);
        assert.deepEqual(await inCell(page, 'Research', 'Office'), [ids.lamp]);
        assert.deepEqual(await inCell(page, 'Research', 'Bedroom'), [ids.bed]);
        const head = await page.locator('.wv-board .board-col-head[data-key="Ready to Buy"]').boundingBox();
        for (const room of ['Office', 'Bedroom', 'Kitchen']) {
          const c = await page.locator(cell('Ready to Buy', room)).boundingBox();
          assert.ok(Math.abs(c.x - head.x) <= 1 && Math.abs(c.width - head.width) <= 1, `${room} lines up under its column`);
        }
        const lane = page.locator('.board-lane[data-key="Office"] .board-lane-title');
        assert.equal(await lane.evaluate((n) => getComputedStyle(n).position), 'sticky');
        await page.setViewportSize({ width: 860, height: 900 });
        await page.locator('.wv-board').evaluate((n) => { n.scrollLeft = 400; });
        const board = await page.locator('.wv-board').boundingBox();
        await page.waitForFunction(() => document.querySelector('.wv-board').scrollLeft > 0);
        const at = await lane.boundingBox();
        assert.ok(Math.abs(at.x - board.x) <= 16, `the lane heading sticks to the left edge: ${at.x} vs ${board.x}`);
        const ink = await lane.evaluate((n) => getComputedStyle(n).color);
        const bg = await lane.evaluate((n) => getComputedStyle(n).backgroundColor);
        assert.notEqual(ink, bg, `${theme}: the lane heading reads`);
        assert.deepEqual(page.errors, []);
      } finally { await page.close(); }
    });
  }

  test('dragging a card into another lane writes the second group field, into another column the first', async () => {
    seed();
    const page = await open();
    try {
      await drag(page, tile(ids.lamp), cell('Research', 'Kitchen'));
      assert.equal(await eventually(() => raw(ids.lamp, 'Room'), 'Kitchen'), 'Kitchen');
      assert.equal(raw(ids.lamp, 'State'), 'Research', 'the column field stays');
      await page.waitForFunction((sel) => !!document.querySelector(sel), `${cell('Research', 'Kitchen')} ${card(ids.lamp)}`);
      const note = page.locator('.wv-toast', { hasText: `moved to Research${SEP}Kitchen` });
      await note.waitFor();
      await drag(page, tile(ids.bed), cell('Bought', 'Bedroom'));
      assert.equal(await eventually(() => raw(ids.bed, 'State'), 'Bought'), 'Bought');
      assert.equal(raw(ids.bed, 'Room'), 'Bedroom', 'the lane field stays');
      await page.locator('.wv-toast', { hasText: `moved to Bought${SEP}Bedroom` }).locator('.wv-toast-action').click();
      assert.equal(await eventually(() => raw(ids.bed, 'State'), 'Research'), 'Research', 'Undo puts the card back');
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  });

  test('a lane heading folds the lane through the collapsed group paths, and the fold is saved', async () => {
    seed();
    let page = await open();
    try {
      await page.click('.board-lane[data-key="Office"] .list-fold');
      await page.waitForFunction(() => document.querySelector('.board-lane[data-key="Office"]')?.classList.contains('shut'));
      assert.equal(await page.locator(`${cell('Ready to Buy', 'Office')}`).isHidden(), true, 'the lane cells hide');
      assert.equal(await page.locator('.board-lane[data-key="Office"] .list-fold').getAttribute('aria-expanded'), 'false');
      const want = ['Research', 'Ready to Buy', 'Bought'].map((st) => `${st}${SEP}Office`);
      await eventually(() => JSON.stringify((view().collapsed ?? []).filter((k) => k.endsWith('Office')).sort()), JSON.stringify([...want].sort()));
    } finally { await page.close(); }
    page = await open();
    try {
      assert.ok(await page.locator('.board-lane[data-key="Office"]').evaluate((n) => n.classList.contains('shut')), 'the fold survives a reload');
      assert.equal(await page.locator('.board-lane[data-key="Office"] .list-count').textContent(), '3', 'a folded lane still counts its cards');
      await page.click('.board-lane[data-key="Office"] .list-fold');
      await eventually(() => (view().collapsed ?? []).some((k) => k.endsWith('Office')), false);
      assert.ok(await page.locator(cell('Ready to Buy', 'Office')).isVisible());
    } finally { await page.close(); }
  });

  test('empty lanes follow empty groups: a search hides them as it hides empty columns', async () => {
    seed();
    const page = await open();
    try {
      assert.equal(await page.locator('.board-lane[data-key="Kitchen"]').count(), 1);
      await page.fill('.table-search input, input.table-search', 'desk');
      await page.waitForFunction(() => document.querySelectorAll('.wv-board .tile').length === 1);
      assert.deepEqual(await page.$$eval('.wv-board .board-lane', (ls) => ls.map((l) => l.dataset.key)), ['Office']);
      assert.deepEqual(await page.$$eval('.wv-board .board-col-head', (hs) => hs.map((h) => h.dataset.key)), ['Ready to Buy']);
      await page.fill('.table-search input, input.table-search', '');
      await page.waitForFunction(() => document.querySelectorAll('.wv-board .tile').length === 4);
    } finally { await page.close(); }
  });

  test('stacked keeps its nested sections and draws no lanes', async () => {
    seed({ groups: 'stacked' });
    const page = await open();
    try {
      assert.equal(await page.locator('.wv-board .board-lane').count(), 0);
      assert.equal(await page.locator('.wv-board').getAttribute('data-lanes'), null);
      assert.ok(await page.locator(`.wv-board .board-group[data-key="Ready to Buy${SEP}Office"] ${card(ids.desk)}`).count());
      assert.equal(await page.locator('.wv-board > .board-group').count(), 3, 'one section per State, the first level');
      const parent = page.locator('.wv-board > .board-group[data-key="Ready to Buy"]');
      assert.equal(await parent.locator(':scope > .board-group-head .list-group-label').innerText(), 'Ready to Buy', 'the first level heads its section');
      assert.equal(await parent.locator(':scope > .board-group-head .list-count').innerText(), '2');
      assert.ok(await parent.locator(`:scope > .board-groups > .board-group[data-key="Ready to Buy${SEP}Office"] ${card(ids.desk)}`).count(), 'the second level nests inside the first');
      assert.equal(await page.locator('.wv-board .board-group-head .list-group-label', { hasText: 'Office' }).count(), 3, 'a second-level heading repeats under each first-level section');
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  });

  test('on a phone the columns snap at 85vw, lane headings stick left, targets are 44 px and a hold carries a card to another lane', async () => {
    seed();
    const page = await open({ phone: true });
    try {
      await page.waitForFunction(() => { const n = document.querySelector('.wv-board'); return n.scrollWidth > n.clientWidth; });
      const board = await page.locator('.wv-board').evaluate((n) => ({ snap: getComputedStyle(n).scrollSnapType, sw: n.scrollWidth, cw: n.clientWidth }));
      assert.match(board.snap, /x mandatory/);
      assert.ok(board.sw > board.cw);
      const vw = await page.evaluate(() => innerWidth);
      const col = await page.locator(cell('Research', 'Office')).evaluate((n) => n.getBoundingClientRect().width);
      assert.ok(Math.abs(col - vw * 0.85) <= 8, `a column is about 85vw: ${col} of ${vw}`);
      assert.ok((await page.locator('.board-lane[data-key="Office"] .list-fold').boundingBox()).height >= 44, 'the lane fold is a 44 px target');
      assert.equal(await page.evaluate(() => document.scrollingElement.scrollWidth > document.documentElement.clientWidth), false);
      const hand = pointer(page, { touch: true });
      await hand.press(await centre(page.locator(`${tile(ids.lamp)} .tile-head`)));
      await hand.hold();
      await hand.to(await centre(page.locator(`${cell('Research', 'Bedroom')} .tile, ${cell('Research', 'Bedroom')} .board-empty`).first()), 10);
      await hand.release();
      assert.equal(await eventually(() => raw(ids.lamp, 'Room'), 'Bedroom'), 'Bedroom');
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  });
}
