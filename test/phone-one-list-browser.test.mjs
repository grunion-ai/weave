import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage } from './lib/browser.mjs';

let issues;
const s = await launch('phone one list', (weave) => {
  weave.createSpace({ name: 'Development' });
  issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.addField(issues, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'Fixed', category: 'done' }] } });
  weave.addField(issues, { name: 'Severity', type: 'select', config: { options: ['Low', 'High'] } });
  for (const n of ['Area', 'Owner', 'Notes', 'Steps', 'Expected', 'Actual']) weave.addField(issues, { name: n, type: 'text' });
  for (let i = 0; i < 8; i++) weave.createEntity(issues, { name: `Issue ${i}`, values: { Status: 'Open', Severity: i % 2 ? 'High' : 'Low', Area: 'Grid', Owner: 'Kyle' } });
  return {
    views: {
      'Saved list': weave.tableView(`${issues.id}/Saved list`, { from: 'Standard', layout: 'list' }).id,
      'Saved table': weave.tableView(`${issues.id}/Saved table`, { from: 'Standard', layout: 'table' }).id,
    },
  };
});

if (s) {
  const { base, browser, views } = s;
  const open = async (view, { desktop = false } = {}) => {
    const page = desktop ? await browser.newPage({ viewport: { width: 1280, height: 900 } }) : await phonePage(await phoneBrowser());
    const at = view === 'Standard' ? `#/table/${issues.id}` : `#/table/${issues.id}/view/${views[view]}`;
    await page.goto(`${base}/${at}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main :is(.wv-list .list-row, .wv-grid tbody tr.entity-row)');
    return page;
  };
  const shape = (page) => page.evaluate(() => {
    const sig = (n) => `${n.tagName.toLowerCase()}.${[...n.classList].filter((c) => c !== 'done').sort().join('.')}(${[...n.children].map(sig).join(',')})`;
    const main = document.querySelector('#main');
    const grid = main.querySelector('.wv-grid');
    const wrap = main.querySelector('.table-wrap');
    const row = main.querySelector('.wv-list .list-row');
    return {
      list: !!main.querySelector('.wv-list'),
      grid: !!grid,
      rows: main.querySelectorAll('.wv-list .list-row').length,
      row: row ? sig(row) : null,
      head: grid?.tHead ? getComputedStyle(grid.tHead).display : null,
      sideways: wrap ? wrap.scrollWidth > wrap.clientWidth + 1 : false,
      page: document.documentElement.scrollWidth <= innerWidth,
    };
  });

  test('on a phone the Standard view and a view saved as List draw the same list component and the same row DOM (Issue #740)', async () => {
    const standard = await open('Standard');
    const saved = await open('Saved list');
    try {
      const a = await shape(standard);
      const b = await shape(saved);
      assert.equal(a.list, true, 'the Standard view draws the List component on a phone');
      assert.equal(a.grid, false, 'and no restyled grid');
      assert.equal(b.list, true, 'a view saved as List draws the List component');
      assert.equal(a.rows, 8);
      assert.equal(b.rows, 8);
      assert.equal(a.row, b.row, 'one row DOM for both views');
    } finally { await standard.close(); await saved.close(); }
  });

  test('on a phone a view saved as Table draws a true table that scrolls sideways (Issue #740)', async () => {
    const page = await open('Saved table');
    try {
      const t = await shape(page);
      assert.equal(t.grid, true, 'a saved Table view draws the grid');
      assert.equal(t.list, false, 'not the list');
      assert.notEqual(t.head, 'none', 'the column header shows');
      assert.equal(t.sideways, true, 'the table scrolls sideways inside its card');
      assert.equal(t.page, true, 'the page itself never scrolls sideways');
    } finally { await page.close(); }
  });

  test('on a desktop the Standard view stays a table (Issue #740)', async () => {
    const page = await open('Standard', { desktop: true });
    try {
      const t = await shape(page);
      assert.equal(t.grid, true);
      assert.equal(t.list, false);
    } finally { await page.close(); }
  });
}
