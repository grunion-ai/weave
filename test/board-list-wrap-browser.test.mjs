import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage, settled } from './lib/browser.mjs';
import { probe } from './lib/cutoff.mjs';

const TITLE = 'A card title long enough that a board column has to wrap it across several lines';
const TAG = 'A tag whose label runs long enough to need a wrap';
const PROJECT = 'Billing rewrite with a name long enough to wrap in a chip';

let tasks, board, list, ids;
const s = await launch('board and list wrap long text', (weave) => {
  weave.createSpace({ name: 'Work' });
  const projects = weave.createTable({ space: 'Work', name: 'Project' });
  tasks = weave.createTable({ space: 'Work', name: 'Task' });
  weave.addField(tasks, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true }, { name: 'Done', category: 'done' }] } });
  weave.addField(tasks, { name: 'Window', type: 'daterange', config: { format: 'long' } });
  weave.addField(tasks, { name: 'Tags', type: 'multiselect', config: { options: ['Short', TAG] } });
  weave.addRelation(tasks, { name: 'Project', targetDb: projects, cardinality: 'many-to-one', inverseName: 'Tasks' });
  const p = weave.createEntity(projects, { name: PROJECT }).id;
  ids = [
    weave.createEntity(tasks, { name: TITLE, values: { Window: { start: '2026-08-01', end: '2026-09-15' }, Tags: ['Short', TAG], Project: p } }).id,
    weave.createEntity(tasks, { name: 'Short card', values: { Tags: [TAG] } }).id,
  ];
  board = weave.tableView(`${tasks.id}/Board`, { layout: 'board', group: ['Tags'] });
  list = weave.tableView(`${tasks.id}/List`, { layout: 'list', group: ['Status'] });
});

if (s) {
  const { base, browser } = s;
  const engines = [
    ['chromium 1440', () => browser.newPage({ viewport: { width: 1440, height: 900 } }), ['light', 'dark']],
    ['webkit phone', async () => { const b = await phoneBrowser(); return b && phonePage(b); }, ['light']],
  ];
  const open = async (make, theme, view, ready) => {
    const page = await make();
    if (!page) return null;
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/#/table/${tasks.id}/view/${view.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(ready);
    await settled(page.locator(ready).first());
    return page;
  };

  for (const [engine, make, themes] of engines) {
    for (const theme of themes) {
      test(`a board card wraps its title, group heading, chip labels and date range instead of cutting them (${engine}, ${theme}, Feature #TBD)`, async (t) => {
        const page = await open(make, theme, board, '.wv-board .tile');
        if (!page) return t.skip('webkit cannot launch here');
        try {
          const cut = (await page.evaluate(probe, '.wv-board')).map((f) => `${f.kind} ${f.selector} ${JSON.stringify(f.text)} by ${f.px}px`);
          assert.deepEqual(cut, [], 'nothing on the board is cut off');
          const card = page.locator(`.wv-board .tile[data-eid="${ids[0]}"]`).first();
          const lines = await card.locator('.tile-title').evaluate((n) => Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight || '20')));
          assert.ok(lines >= 2, `the long title takes more than one line, got ${lines}`);
          const range = await card.locator('.tile-field[data-field="Window"] input').evaluate((n) => ({ value: n.value, fits: n.scrollWidth <= n.clientWidth + 1 }));
          assert.ok(range.value && range.fits, `the whole range shows: ${JSON.stringify(range)}`);
          const head = await page.locator('.board-group-head .list-group-label', { hasText: TAG }).evaluate((n) => n.textContent.trim());
          assert.equal(head, TAG, 'the group heading names the whole tag');
        } finally { await page.close(); }
      });
    }
  }

  test('a desktop board keeps the calendar button beside a single date and a short range (Feature #TBD)', async () => {
    const page = await open(engines[0][1], 'light', board, '.wv-board .tile');
    try {
      const rows = await page.$$eval('.wv-board .tile .tile-field[data-field="Window"] .range-cell', (cells) => cells.map((c) => {
        const i = c.querySelector('input').getBoundingClientRect();
        const b = c.querySelector('.date-pick-btn').getBoundingClientRect();
        return { value: c.querySelector('input').value, sameLine: Math.abs(i.top + i.height / 2 - (b.top + b.height / 2)) < 4 };
      }));
      assert.ok(rows.some((r) => !r.value && r.sameLine), `an empty range keeps its button beside the placeholder: ${JSON.stringify(rows)}`);
    } finally { await page.close(); }
  });

  test('on a phone a list group fold and a list row title are 44px tap targets, and a board pick box answers across 44px (Feature #TBD)', async (t) => {
    const b = await phoneBrowser();
    if (!b) return t.skip('webkit cannot launch here');
    let page = await phonePage(b);
    try {
      await page.goto(`${base}/#/table/${tasks.id}/view/${list.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-list .list-row');
      const fold = await page.locator('.wv-list .list-group-head .list-fold').first().boundingBox();
      assert.ok(fold.width >= 44 && fold.height >= 44, `fold ${fold.width}x${fold.height}`);
      const title = await page.locator('.wv-list .list-title').first().boundingBox();
      assert.ok(title.height >= 44, `title ${title.height}px tall`);
      await page.close();
      page = await phonePage(b);
      await page.goto(`${base}/#/table/${tasks.id}/view/${board.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-board .tile');
      const pick = page.locator(`.wv-board .board-group:first-of-type .tile[data-eid="${ids[0]}"] .tile-pick`);
      const box = await pick.boundingBox();
      await page.touchscreen.tap(box.x + box.width / 2 + 20, box.y + box.height / 2 + 4);
      assert.equal(await pick.locator('input').isChecked(), true, 'a tap 20px right of the box centre still picks the card');
    } finally { await page.close(); }
  });

  test('a desktop list keeps its fold and title at their drawn size (Feature #TBD)', async () => {
    const page = await open(engines[0][1], 'light', list, '.wv-list .list-row');
    try {
      const fold = await page.locator('.wv-list .list-group-head .list-fold').first().boundingBox();
      assert.ok(fold.width < 44, `the desktop fold stays ${fold.width}px`);
      const title = await page.locator('.wv-list .list-title').first().boundingBox();
      assert.ok(title.height < 44, `the desktop title stays ${title.height}px`);
    } finally { await page.close(); }
  });
}
