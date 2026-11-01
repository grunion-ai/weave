import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let ids = null;
const s = await launch('space home recents', (weave) => {
  weave.markOnboarded();
  weave.createSpace({ name: 'Sales' });
  const deal = weave.createTable({ space: 'Sales', name: 'Deal' });
  const saved = weave.tableView(`${deal.id}/Pipeline`, { search: '' });
  const first = weave.getTable(deal.id).tableViews[0];
  const row = weave.createEntity(deal.id, { Name: 'Northstar renewal' });
  ids = { deal: deal.id, first: first.id, saved: saved.id, row: row.id };
});

if (s) {
  const recents = (page) => page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('weave-recent:'));
    return key ? JSON.parse(localStorage.getItem(key)) : [];
  });

  test('opening a saved view and a row notes them with their table and the time', async () => {
    const page = await s.browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      const before = Date.now();
      await page.goto(`${s.base}/#/table/${ids.deal}/view/${ids.saved}`);
      await page.waitForFunction(() => Object.keys(localStorage).some((k) => k.startsWith('weave-recent:')));
      await page.evaluate((id) => openEntity(id), ids.row);
      await page.waitForFunction(() => {
        const key = Object.keys(localStorage).find((k) => k.startsWith('weave-recent:'));
        return JSON.parse(localStorage.getItem(key)).some((r) => r.kind === 'entity');
      });
      const list = await recents(page);
      const view = list.find((r) => r.kind === 'table-view');
      assert.equal(view.id, ids.saved);
      assert.equal(view.name, 'Pipeline');
      assert.equal(view.tableId, ids.deal);
      assert.ok(view.at >= before);
      const row = list.find((r) => r.kind === 'entity');
      assert.equal(row.dbId, ids.deal);
      assert.ok(row.at >= before);
    } finally {
      await page.close();
    }
  });

  test('the table\'s first view is the table, so it is not a recent view', async () => {
    const page = await s.browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      await page.goto(`${s.base}/#/table/${ids.deal}/view/${ids.first}`);
      await page.waitForFunction(() => Object.keys(localStorage).some((k) => k.startsWith('weave-recent:')));
      assert.deepEqual((await recents(page)).filter((r) => r.kind === 'table-view'), []);
    } finally {
      await page.close();
    }
  });

  test('the palette keeps its eight newest and opens a saved view', async () => {
    const page = await s.browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      await page.goto(`${s.base}/#/table/${ids.deal}/view/${ids.saved}`);
      await page.waitForFunction(() => Object.keys(localStorage).some((k) => k.startsWith('weave-recent:')));
      await page.evaluate(() => {
        const key = Object.keys(localStorage).find((k) => k.startsWith('weave-recent:'));
        const list = JSON.parse(localStorage.getItem(key));
        const view = list.find((r) => r.kind === 'table-view');
        const rows = Array.from({ length: 20 }, (_, i) => ({ kind: 'entity', id: `x${i}`, name: `Old ${i}`, db: 'Sales/Deal', publicId: i, url: `/e/x${i}` }));
        localStorage.setItem(key, JSON.stringify([view, ...rows]));
        location.hash = '#/';
      });
      await page.evaluate(() => openPalette());
      const results = page.locator('.cmdk-list .result, .result');
      await results.first().waitFor();
      assert.equal(await results.count(), 8);
      assert.match(await results.first().innerText(), /Pipeline/);
      await results.first().click();
      await page.waitForFunction((want) => location.hash.endsWith(want), `/view/${ids.saved}`);
    } finally {
      await page.close();
    }
  });
}
