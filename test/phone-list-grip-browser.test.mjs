import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage, eventually } from './lib/browser.mjs';

let todo;
const s = await launch('phone list grip', (weave) => {
  weave.createSpace({ name: 'Plans' });
  todo = weave.createTable({ space: 'Plans', name: 'To-do' });
  weave.addField(todo.id, { name: 'Done', type: 'checkbox' });
  for (const name of ['Alpha', 'Bravo', 'Charlie']) weave.createEntity(todo.id, { name, values: { Done: false } });
  for (const v of weave.tableView(todo).views) if (v.name !== 'Standard') weave.tableView(`${todo.id}/${v.id}`, { delete: true });
  weave.tableView(`${todo.id}/Standard`, {
    layout: 'list', group: [], completedBy: 'Done', collapsed: null, order: null, filters: {}, sort: [],
  });
});

if (s) {
  const { base, browser } = s;
  const MIN = 44;
  const open = async (theme) => {
    const page = await phonePage(await phoneBrowser());
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/#/table/${todo.id}`, { waitUntil: 'networkidle' });
    return page;
  };

  test('the List surface renders its rows at phone width (Issue #805)', async () => {
    const page = await open('light');
    await page.waitForSelector('.wv-list .list-row', { timeout: 15000 });
    const rows = await page.locator('.wv-list .list-row').count();
    assert.ok(rows >= 3, `the list draws its rows on a phone, got ${rows}`);
    await page.close();
  });

  for (const theme of ['light', 'dark']) {
    test(`a List row grip is a 44px touch target on a phone (${theme}, Issue #805)`, async () => {
      const page = await open(theme);
      await page.waitForSelector('.wv-list .list-row .list-grip', { timeout: 15000 });
      const grip = page.locator('.wv-list .list-row .list-grip').first();
      const box = await eventually(async () => {
        const b = await grip.boundingBox();
        return b && Math.min(Math.round(b.width), Math.round(b.height)) >= MIN;
      }, true);
      const b = await grip.boundingBox();
      assert.equal(box, true, `the grip is ${Math.round(b.width)}x${Math.round(b.height)}, under the ${MIN}px minimum a finger needs`);
      const icon = await grip.locator('svg').boundingBox();
      assert.ok(icon.width <= 20, `the glyph stays small inside the target, got ${Math.round(icon.width)}px`);
      const cx = Math.abs((b.x + b.width / 2) - (icon.x + icon.width / 2));
      const cy = Math.abs((b.y + b.height / 2) - (icon.y + icon.height / 2));
      assert.ok(cx <= 1 && cy <= 1, `the glyph is centred in the target, off by ${cx.toFixed(1)}x${cy.toFixed(1)}`);
      await page.close();
    });
  }

  test('the bigger target does not inflate the List row past a touch row height (Issue #805)', async () => {
    const page = await open('light');
    await page.waitForSelector('.wv-list .list-row', { timeout: 15000 });
    const row = await page.locator('.wv-list .list-row').first().boundingBox();
    assert.ok(Math.round(row.height) <= 46, `the row stays a touch row, got ${Math.round(row.height)}px`);
    assert.ok(Math.round(row.height) >= 44, `the row is tall enough to hold the target, got ${Math.round(row.height)}px`);
    await page.close();
  });

  test('a desktop pointer keeps the small hover grip (Issue #805)', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${base}/#/table/${todo.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-list .list-row .list-grip', { timeout: 15000 });
    const b = await page.locator('.wv-list .list-row .list-grip').first().boundingBox();
    assert.ok(Math.round(b.width) < 30 && Math.round(b.height) < 30, `the desktop grip stays small, got ${Math.round(b.width)}x${Math.round(b.height)}`);
    await page.close();
  });

  test('the grip still drags a List row into a new order on a phone (Issue #805)', async () => {
    const page = await open('light');
    await page.waitForSelector('.wv-list .list-row', { timeout: 15000 });
    const names = () => page.$$eval('.wv-list .list-row .list-title', (n) => n.map((e) => e.textContent.trim()));
    assert.deepEqual(await names(), ['Alpha', 'Bravo', 'Charlie']);
    const from = await page.locator('.wv-list .list-row:has(.list-title:text-is("Charlie")) .list-grip').boundingBox();
    const onto = await page.locator('.wv-list .list-row:has(.list-title:text-is("Alpha"))').boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(onto.x + onto.width / 2, onto.y + 2, { steps: 12 });
    await page.mouse.up();
    assert.deepEqual(await eventually(names, ['Charlie', 'Alpha', 'Bravo']), ['Charlie', 'Alpha', 'Bravo']);
    await page.close();
  });
}
