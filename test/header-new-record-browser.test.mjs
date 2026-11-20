import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';

let bugs, board;
const s = await launch('header new record', (weave) => {
  weave.createSpace({ name: 'Development' });
  bugs = weave.createTable({ space: 'Development', name: 'Issue', icon: 'lucide:bug' });
  weave.updateTable(bugs.id, { noun: 'bug' });
  weave.addField(bugs, { name: 'Status', type: 'select', config: { options: ['Open', 'Fixed'] } });
  weave.createEntity(bugs, { name: 'Picker chip', values: { Status: 'Open' } });
  board = weave.tableView(`${bugs.id}/Board`, { layout: 'board', group: ['Status'], fields: ['Name', 'Status'], filters: {}, sort: [] });
});

if (s) {
  const { base, browser, weave } = s;
  const count = () => weave.listEntities(bugs.id).length;
  const place = (page) => page.evaluate(() => {
    const header = document.querySelector('#main .view-header');
    const btn = header.querySelector('.new-record-btn');
    const r = btn.getBoundingClientRect();
    const row1 = header.querySelector(':scope > .crumb-row').getBoundingClientRect();
    const row2 = header.querySelector(':scope > .head-bar');
    const last = [...row2.children].filter((n) => n.getClientRects().length).at(-1);
    return { text: btn.textContent.trim(), inRow2: row2.contains(btn), last: last === btn, below: r.top >= row1.bottom, visible: r.width > 0 && r.height > 0 };
  });

  test('a table view has a New bug button at the far right of row 2 that adds a row to the table (Feature #384)', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${bugs.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main .wv-grid tbody tr.entity-row');
      assert.deepEqual(await place(page), { text: 'New bug', inRow2: true, last: true, below: true, visible: true });
      const before = count();
      await page.click('#main .view-header .new-record-btn');
      await eventually(count, before + 1);
      await page.waitForSelector(`#main .wv-grid tbody tr.entity-row >> nth=${before}`);
    } finally { await page.close(); }
  });

  test('a board view has the same New bug button in row 2, and it creates a card in that table (Feature #384)', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${bugs.id}/view/${board.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main .board-wrap');
      assert.deepEqual(await place(page), { text: 'New bug', inRow2: true, last: true, below: true, visible: true });
      const before = count();
      await page.click('#main .view-header .new-record-btn');
      await page.fill('.new-row-name', 'Board card from the header');
      await page.click('.tray-actions button[type="submit"]');
      await eventually(count, before + 1);
      assert.ok(weave.listEntities(bugs.id).some((e) => e.name === 'Board card from the header'), 'the card lands in Issue');
    } finally { await page.close(); }
  });
}
