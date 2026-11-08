import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { read } from './lib/source.mjs';

const FILE = '/board-view.js';
let grid, board, row;
const s = await launch('board view lazy', (weave) => {
  weave.createSpace({ name: 'Buyer' });
  grid = weave.createTable({ space: 'Buyer', name: 'Vendor' });
  row = weave.createEntity(grid, { name: 'Acme' });
  board = weave.createTable({ space: 'Buyer', name: 'Shopping List' });
  weave.addField(board.id, { name: 'State', type: 'select', config: { options: [{ name: 'Research' }, { name: 'Bought', hue: 'blue' }] } });
  weave.createEntity(board, { name: 'Desk', values: { State: 'Research' } });
  weave.tableView(`${board.id}/Standard`, { layout: 'board', group: ['State'], fields: ['Name', 'State'] });
});

test('the board and compare code lives in board-view.js, and app.js keeps only its loader (Issue #1041)', () => {
  const app = read('public/app.js');
  const view = read(`public${FILE}`);
  for (const fn of ['renderBoard', 'openCompare', 'drawCompare', 'closeCompare']) {
    assert.match(view, new RegExp(`function ${fn}\\(`), `${fn} is in board-view.js`);
    assert.doesNotMatch(app, new RegExp(`function ${fn}\\(`), `app.js no longer carries ${fn}`);
  }
  assert.match(app, /const \[, result, everyone, domains\] = await Promise\.all\(\[\n\s+boardView\(\),/, 'a board view fetches the file beside its rows');
});

if (s) {
  const { base, browser } = s;
  const watch = (page) => {
    const fetched = [];
    page.on('request', (r) => { if (new URL(r.url()).pathname === FILE) fetched.push(FILE); });
    return fetched;
  };

  for (const [name, hash, ready] of [
    ['home', () => '', '#ws-new svg'],
    ['grid table', () => `#/table/${grid.id}`, '.wv-grid tbody tr.entity-row'],
    ['row', () => `#/entity/${row.id}`, '.wv-entity, main h1, main'],
  ]) {
    test(`a cold ${name} load fetches no ${FILE} (Issue #1041)`, async () => {
      const page = await browser.newPage();
      try {
        const fetched = watch(page);
        await page.goto(`${base}/${hash()}`, { waitUntil: 'networkidle' });
        await page.waitForSelector(ready);
        assert.deepEqual(fetched, []);
      } finally { await page.close(); }
    });
  }

  test('a cold board view fetches the file once and paints its cards (Issue #1041)', async () => {
    const page = await browser.newPage();
    try {
      const fetched = watch(page);
      await page.goto(`${base}/#/table/${board.id}`, { waitUntil: 'networkidle' });
      await page.locator('.wv-board .tile', { hasText: 'Desk' }).waitFor();
      assert.deepEqual(fetched, [FILE]);
      await page.evaluate((id) => { location.hash = `#/table/${id}`; }, grid.id);
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      await page.evaluate((id) => { location.hash = `#/table/${id}`; }, board.id);
      await page.locator('.wv-board .tile', { hasText: 'Desk' }).waitFor();
      assert.deepEqual(fetched, [FILE], 'a second visit reuses the loaded file');
    } finally { await page.close(); }
  });

  test('a board whose code fails to load paints the route error with the reason, and the app keeps routing (Issue #1041)', async () => {
    const page = await browser.newPage();
    try {
      await page.route(`**${FILE}`, (r) => r.abort());
      await page.goto(`${base}/#/table/${board.id}`, { waitUntil: 'networkidle' });
      await page.locator('#main .wv-route-error-msg', { hasText: 'The board did not load' }).waitFor();
      await page.evaluate((id) => { location.hash = `#/table/${id}`; }, grid.id);
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
    } finally { await page.close(); }
  });
}
