import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';

let list, ids;
const s = await launch('board dock save', (weave) => {
  weave.createSpace({ name: 'Work' });
  list = weave.createTable({ space: 'Work', name: 'Tasks' });
  weave.addField(list.id, {
    name: 'State',
    type: 'workflow',
    config: { states: [
      { id: 'open', name: 'Open', category: 'not-started', default: true },
      { id: 'done', name: 'Done', category: 'done' },
    ] },
  });
  weave.addField(list.id, { name: 'Owner', type: 'text' });
});

if (s) {
  const { base, browser, weave } = s;
  const seed = () => {
    for (const e of weave.listEntities(list.id)) weave.deleteEntity(e.id, { hard: true });
    const mk = (name) => weave.createEntity(list.id, { name, values: { State: 'Open', Owner: 'Ada' } }).id;
    ids = { call: mk('Call the vendor'), ship: mk('Ship the order') };
    weave.tableView(`${list.id}/Standard`, {
      layout: 'board', groups: 'side', picture: 'off', group: ['State'],
      fields: ['Name', 'State', 'Owner'], order: null, filters: {}, sort: [],
    });
  };
  const tile = (id) => `.wv-board .tile[data-eid="${id}"]`;
  const groupOf = (page, id) => page.locator(tile(id)).evaluate((n) => n.closest('.board-group')?.dataset.key ?? null);
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    await page.goto(`${base}/#/table/${list.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(tile(ids.call));
    return page;
  };
  const dockCard = async (page, id) => {
    await page.click(`${tile(id)} .tile-id`);
    await page.waitForSelector(`#dock[data-eid="${id}"]`);
  };

  test('moving a record to its next state in the docked pane moves its card to that group', async () => {
    seed();
    const page = await open();
    try {
      assert.equal(await groupOf(page, ids.call), 'Open');
      await dockCard(page, ids.call);
      await page.click('#dock .fieldrow[data-field="State"] .chip-trigger');
      await page.locator('.chip-pop-row', { hasText: 'Done' }).click();
      assert.equal(await eventually(() => groupOf(page, ids.call), 'Done'), 'Done', 'the card sits under Done with no reload');
      assert.equal(await groupOf(page, ids.ship), 'Open', 'the other card stays put');
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  });

  test('a field saved in the docked pane shows on the card', async () => {
    seed();
    const page = await open();
    try {
      await dockCard(page, ids.call);
      await page.click('#dock .fieldrow[data-field="Owner"] .text-dressed');
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type('Grace');
      await page.keyboard.press('Enter');
      const shown = () => page.locator(`${tile(ids.call)} [data-field="Owner"] dd`).evaluate((n) => (n.querySelector('input')?.value ?? n.innerText).trim());
      assert.equal(await eventually(shown, 'Grace'), 'Grace', 'the card shows the saved owner with no reload');
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  });
}
