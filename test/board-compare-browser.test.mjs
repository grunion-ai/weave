import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';
import { pointer, centre } from './lib/reorder-surfaces.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

let list, ids, pics;
const s = await launch('board compare', (weave) => {
  weave.createSpace({ name: 'Buyer' });
  list = weave.createTable({ space: 'Buyer', name: 'Shopping List' });
  weave.updateTable(list.id, { noun: 'item' });
  weave.addField(list.id, { name: 'State', type: 'select', config: { options: [{ name: 'Research' }, { name: 'Ready to Buy', hue: 'green' }] } });
  weave.addField(list.id, { name: 'Best Price', type: 'number', config: { format: 'currency', currency: 'USD' } });
  weave.addField(list.id, { name: 'Store', type: 'text' });
  weave.addField(list.id, { name: 'Photo', type: 'attachments', config: { multiple: false, preview: 'cover', size: 'medium' } });
});

if (s) {
  const { base, browser, weave } = s;
  const seed = () => {
    for (const e of weave.listEntities(list.id)) weave.deleteEntity(e.id, { hard: true });
    const mk = (name, price, Store = 'Costco') => weave.createEntity(list.id, { name, values: { State: 'Ready to Buy', 'Best Price': price, Store } }).id;
    ids = { desk: mk('Standing desk', 449), chair: mk('Chair', 939), mat: mk('Walking mat', 449), rug: mk('Rug', 249), lamp: mk('Lamp', 89, 'IKEA') };
    pics = { desk: weave.attachToField(ids.desk, 'Photo', { name: 'desk.png', mime: 'image/png', bytes: PNG }) };
    weave.tableView(`${list.id}/Standard`, {
      layout: 'board', groups: 'stacked', picture: 'medium', group: ['State'],
      fields: ['Name', 'State', 'Best Price', 'Store', 'Photo'], order: null, filters: {}, sort: [],
    });
  };
  const open = async ({ theme = 'light', phone = false } = {}) => {
    const page = await browser.newPage(phone
      ? { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, colorScheme: theme }
      : { viewport: { width: 1280, height: 900 }, colorScheme: theme });
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    await page.goto(`${base}/#/table/${list.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-board .tile');
    return page;
  };
  const tile = (id) => `.wv-board .tile[data-eid="${id}"]`;
  const pick = (page, id) => page.click(`${tile(id)} .tile-pick`);
  const picked = (page) => page.$$eval('.wv-board .tile.is-picked', (ts) => ts.map((t) => t.dataset.eid));
  const columns = (page) => page.$$eval('#dock .wv-compare thead th[data-eid]', (ths) => ths.map((th) => th.dataset.eid));

  for (const theme of ['light', 'dark']) {
    test(`a card's pick box waits for hover or focus, and picking leaves the pane shut (${theme})`, async () => {
      seed();
      const page = await open({ theme });
      try {
        const box = page.locator(`${tile(ids.desk)} .tile-pick`);
        assert.equal(await box.evaluate((n) => getComputedStyle(n).opacity), '0', 'hidden at rest');
        await page.hover(tile(ids.desk));
        assert.equal(await box.evaluate((n) => getComputedStyle(n).opacity), '1', 'shown on hover');
        await page.mouse.move(2, 2);
        await page.focus(tile(ids.chair));
        assert.equal(await page.locator(`${tile(ids.chair)} .tile-pick`).evaluate((n) => getComputedStyle(n).opacity), '1', 'shown on focus');
        await pick(page, ids.desk);
        assert.deepEqual(await picked(page), [ids.desk]);
        assert.equal(await page.locator(`${tile(ids.desk)} .tile-pick input`).isChecked(), true);
        await page.waitForLoadState('networkidle');
        assert.ok(await page.locator('#dock').isHidden(), 'a pick opens no record');
        const ring = await page.locator(tile(ids.desk)).evaluate((n) => [getComputedStyle(n).borderLeftWidth, getComputedStyle(n).borderRightWidth]);
        assert.equal(ring[0], ring[1], 'the picked card wears no one-side stripe');
        assert.deepEqual(page.errors, []);
      } finally { await page.close(); }
    });
  }

  test('Shift-click picks and unpicks; the footer Compare button counts the picks', async () => {
    seed();
    const page = await open();
    try {
      assert.equal(await page.locator('.board-footer .board-compare').count(), 0, 'no Compare until a card is picked');
      await page.click(`${tile(ids.desk)} .tile-body`, { modifiers: ['Shift'] });
      assert.deepEqual(await picked(page), [ids.desk]);
      assert.ok(await page.locator('#dock').isHidden(), 'Shift-click opens no record');
      const btn = page.locator('.board-footer .board-compare');
      assert.equal((await btn.textContent()).trim(), 'Compare 1');
      assert.equal(await btn.isDisabled(), true, 'one card has nothing to compare against');
      await page.click(`${tile(ids.chair)} .tile-cover`, { modifiers: ['Shift'] });
      assert.equal((await btn.textContent()).trim(), 'Compare 2');
      assert.equal(await btn.isDisabled(), false);
      await page.click(`${tile(ids.desk)} .tile-body`, { modifiers: ['Shift'] });
      assert.deepEqual(await picked(page), [ids.chair]);
    } finally { await page.close(); }
  });

  test('the footer picks slot holds only Compare and Clear, at every pick count under the cap', async () => {
    seed();
    const page = await open();
    try {
      const slot = page.locator('.board-footer .board-picks');
      for (const [n, order] of [[1, [ids.desk]], [2, [ids.desk, ids.chair]], [4, [ids.desk, ids.chair, ids.mat, ids.rug]]]) {
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForSelector('.wv-board .tile');
        for (const id of order) await pick(page, id);
        assert.equal((await slot.textContent()).trim(), `Compare ${n}Clear`, `${n} picked: the slot carries the two buttons and nothing else`);
        assert.doesNotMatch(await page.locator('.board-footer').textContent(), /null/, `${n} picked: no stray null in the footer`);
      }
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  });

  test('a fifth pick is refused with a footer hint', async () => {
    seed();
    const page = await open();
    try {
      for (const id of [ids.desk, ids.chair, ids.mat, ids.rug]) await pick(page, id);
      await pick(page, ids.lamp);
      assert.deepEqual((await picked(page)).sort(), [ids.desk, ids.chair, ids.mat, ids.rug].sort());
      assert.equal(await page.locator(`${tile(ids.lamp)} .tile-pick input`).isChecked(), false, 'the fifth box stays clear');
      assert.match(await page.locator('.board-footer').textContent(), /Compare takes up to 4/);
      assert.equal((await page.locator('.board-footer .board-compare').textContent()).trim(), 'Compare 4');
    } finally { await page.close(); }
  });

  for (const theme of ['light', 'dark']) {
    test(`Compare opens one column per card in the pane row, covers on top, fields aligned, differing rows tinted (${theme})`, async () => {
      seed();
      const page = await open({ theme });
      try {
        for (const id of [ids.desk, ids.chair, ids.mat]) await pick(page, id);
        await page.click('.board-footer .board-compare');
        await page.waitForSelector('#dock:not([hidden]) .wv-compare');
        assert.deepEqual(await columns(page), [ids.desk, ids.chair, ids.mat], 'columns follow the pick order');
        const board = await page.locator('#main').boundingBox();
        const dock = await page.locator('#dock').boundingBox();
        assert.ok(dock.x >= board.x + board.width - 1, 'the compare pane sits beside the board');
        assert.match(await page.locator(`#dock .wv-compare thead th[data-eid="${ids.desk}"] img`).getAttribute('src'), new RegExp(pics.desk.id));
        assert.equal(await page.locator(`#dock .wv-compare thead th[data-eid="${ids.chair}"] .tile-cover.is-empty`).count(), 1, 'a card with no picture keeps the slot');
        const rows = await page.$$eval('#dock .wv-compare tbody tr', (trs) => trs.map((tr) => [tr.dataset.field, tr.classList.contains('is-different'), tr.querySelectorAll('td').length]));
        assert.deepEqual(rows, [['State', false, 3], ['Best Price', true, 3], ['Store', false, 3]], 'the view fields, one row each, a cell per card');
        const tint = (field) => page.locator(`#dock .wv-compare tbody tr[data-field="${field}"] td`).first().evaluate((n) => getComputedStyle(n).backgroundColor);
        assert.notEqual(await tint('Best Price'), await tint('State'), 'a differing row is tinted');
        const edges = await page.$$eval('#dock .wv-compare tbody tr.is-different > *', (cs) => cs.map((c) => getComputedStyle(c).borderLeftWidth === getComputedStyle(c).borderRightWidth));
        assert.ok(edges.every(Boolean), 'the tint carries no one-side stripe');
        assert.equal(await page.locator('#dock .wv-compare .tile-pick').count(), 0);
        assert.deepEqual(page.errors, []);
      } finally { await page.close(); }
    });
  }

  test('a value in the compare pane edits like a card field, and the row tint follows', async () => {
    seed();
    const page = await open();
    try {
      await pick(page, ids.desk);
      await pick(page, ids.chair);
      await page.click('.board-footer .board-compare');
      await page.waitForSelector('#dock .wv-compare tr[data-field="Best Price"].is-different');
      await page.click(`#dock .wv-compare tr[data-field="Best Price"] td[data-eid="${ids.chair}"] .num-dressed`);
      const input = page.locator(`#dock .wv-compare tr[data-field="Best Price"] td[data-eid="${ids.chair}"] input.inline-edit`);
      await input.fill('449');
      await input.press('Enter');
      assert.equal(await eventually(() => weave.readEntity(ids.chair).raw['Best Price'], 449), 449);
      await page.waitForSelector('#dock .wv-compare tr[data-field="Best Price"]:not(.is-different)');
      await page.waitForFunction((id) => /449/.test(document.querySelector(`.wv-board .tile[data-eid="${id}"] .tile-field[data-field="Best Price"]`)?.textContent ?? ''), ids.chair);
      await page.click(`#dock .wv-compare tr[data-field="State"] td[data-eid="${ids.desk}"] .chip-trigger`);
      await page.locator('.picker-pop .picker-row', { hasText: 'Research' }).first().click();
      assert.equal(await eventually(() => weave.readEntity(ids.desk).fields.State, 'Research'), 'Research');
      await page.waitForSelector('#dock .wv-compare tr[data-field="State"].is-different');
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  });

  test('Esc closes the compare pane; a card click swaps it for the record', async () => {
    seed();
    const page = await open();
    try {
      await pick(page, ids.desk);
      await pick(page, ids.chair);
      await page.click('.board-footer .board-compare');
      await page.waitForSelector('#dock:not([hidden]) .wv-compare');
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press('Escape');
      await page.waitForSelector('#dock', { state: 'hidden' });
      assert.deepEqual(await picked(page), [ids.desk, ids.chair], 'closing keeps the picks');
      await page.click('.board-footer .board-compare');
      await page.waitForSelector('#dock:not([hidden]) .wv-compare');
      await page.click(`${tile(ids.rug)} .tile-title`);
      await page.waitForFunction(() => document.querySelector('#dock .name-edit')?.value === 'Rug');
      assert.equal(await page.locator('#dock .wv-compare').count(), 0);
      await page.click('.board-footer .board-clear');
      assert.deepEqual(await picked(page), []);
      assert.equal(await page.locator('.board-footer .board-compare').count(), 0);
    } finally { await page.close(); }
  });

  test('on a phone a long-press picks, taps then pick, and Compare opens a full-screen sheet that scrolls sideways', async () => {
    seed();
    const page = await open({ phone: true });
    try {
      const hand = pointer(page, { touch: true });
      await hand.press(await centre(page.locator(`${tile(ids.desk)} .tile-head`)));
      await hand.hold();
      await hand.release();
      await page.waitForFunction((id) => document.querySelector(`.wv-board .tile[data-eid="${id}"]`)?.classList.contains('is-picked'), ids.desk);
      assert.ok(await page.locator('#dock').isHidden(), 'a long-press opens no record');
      await page.locator(`${tile(ids.chair)} .tile-head`).tap();
      await page.locator(`${tile(ids.mat)} .tile-head`).tap();
      assert.deepEqual(await picked(page), [ids.desk, ids.chair, ids.mat], 'while picking, a tap picks');
      assert.ok(await page.locator('#dock').isHidden());
      const btn = page.locator('.board-footer .board-compare');
      assert.ok((await btn.boundingBox()).height >= 44, 'the Compare button is a 44 px target');
      await btn.tap();
      await page.waitForSelector('#dock:not([hidden]) .wv-compare');
      const r = await page.locator('#dock').boundingBox();
      assert.ok(r.x <= 1 && r.width >= 374, `the compare pane covers the screen: ${JSON.stringify(r)}`);
      const scroller = await page.locator('#dock .compare-scroll').evaluate((n) => ({ sw: n.scrollWidth, cw: n.clientWidth, snap: getComputedStyle(n).scrollSnapType }));
      assert.ok(scroller.sw > scroller.cw, `the cards scroll sideways: ${JSON.stringify(scroller)}`);
      assert.match(scroller.snap, /x mandatory/);
      assert.equal(await page.evaluate(() => document.scrollingElement.scrollWidth > document.documentElement.clientWidth), false, 'the page never scrolls sideways');
      await page.locator('#dock .compare-close').tap();
      await page.waitForSelector('#dock', { state: 'hidden' });
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  });
}
