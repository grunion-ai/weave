import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, engineOf, phonePage, settled } from './lib/browser.mjs';
import { probe } from './lib/cutoff.mjs';

const NOTES = 'Compare the three standing desks on frame stability, motor noise and the warranty terms, then check whether the walnut top ships before the move, ask the store to hold the oak sample, and write the measurements for the alcove beside the window into the Shopping List so the order can go out on Friday without another trip to the showroom.';
const DENSITIES = ['compact', 'comfortable', 'spacious'];

let list, ids;
const s = await launch('board tile density', (weave) => {
  weave.createSpace({ name: 'Buyer' });
  list = weave.createTable({ space: 'Buyer', name: 'Desks' });
  weave.addField(list.id, { name: 'Notes', type: 'text' });
  weave.addField(list.id, { name: 'State', type: 'select', config: { options: [{ name: 'Research' }, { name: 'Ready', hue: 'green' }] } });
  ids = {
    long: weave.createEntity(list.id, { name: 'Standing desk', values: { Notes: NOTES, State: 'Research' } }).id,
    short: weave.createEntity(list.id, { name: 'Lamp', values: { Notes: 'Oak', State: 'Research' } }).id,
    other: weave.createEntity(list.id, { name: 'Chair', values: { Notes: NOTES, State: 'Research' } }).id,
    ready: weave.createEntity(list.id, { name: 'Rug', values: { Notes: NOTES, State: 'Ready' } }).id,
  };
});

if (s) {
  const { base, browser, weave } = s;
  const cells = [
    { name: 'desktop Chromium 1440x900', page: (theme) => browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: theme }) },
    { name: 'phone WebKit 390x844', page: async (theme) => phonePage(await engineOf('webkit'), { viewport: { width: 390, height: 844 }, colorScheme: theme }) },
  ];
  const open = async (cell, density, theme = 'light') => {
    weave.tableView(`${list.id}/Standard`, {
      layout: 'board', groups: 'stacked', picture: 'off', group: ['State'], density,
      fields: ['Name', 'Notes', 'State'], order: null, filters: {}, sort: [],
    });
    const page = await cell.page(theme);
    await page.goto(`${base}/#/table/${list.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`.board-wrap[data-density="${density}"] .wv-board .tile`);
    await page.evaluate(() => document.fonts.ready);
    await settled(page.locator('.wv-board'));
    return page;
  };
  const notes = (page, id) => page.evaluate((eid) => {
    const box = document.querySelector(`.tile[data-eid="${eid}"] .tile-field[data-field="Notes"] dd > .text-dressed`);
    const cs = getComputedStyle(box);
    const range = document.createRange();
    range.selectNodeContents(box);
    const rows = new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
    return { rows, text: box.textContent, clamp: cs.webkitLineClamp, hidden: box.scrollHeight > box.clientHeight + 0.5 || box.closest('dd').scrollHeight > box.closest('dd').clientHeight + 0.5 };
  }, id);
  const columns = (page) => page.evaluate(() => new Set([...document.querySelector('.board-group[data-key="Research"] .board-cards').querySelectorAll(':scope > .tile')].map((t) => Math.round(t.getBoundingClientRect().left))).size);

  test('desktop Chromium 1440x900: a long text field shows in full at every density', async () => {
    const [desktop] = cells;
    for (const density of DENSITIES) {
      const page = await open(desktop, density);
      try {
        const got = await notes(page, ids.long);
        assert.equal(got.text, NOTES, `${density}: the card carries the whole Notes value`);
        assert.equal(got.clamp, 'none', `${density}: Notes takes no line clamp`);
        assert.equal(got.hidden, false, `${density}: no line of Notes is hidden`);
        assert.ok(got.rows > 4, `${density}: the long Notes value wraps onto all its lines, got ${got.rows}`);
        assert.deepEqual(await page.evaluate(probe, '.wv-board'), [], `${density}: the board slices no glyph`);
      } finally { await page.close(); }
    }
  });

  test('phone WebKit 390x844: Spacious drops the stacked board to one column, Comfortable keeps two, and long text shows in full', async () => {
    const [, phone] = cells;
    for (const density of DENSITIES) {
      for (const theme of ['light', 'dark']) {
        const page = await open(phone, density, theme);
        try {
          if (density !== 'compact') assert.equal(await columns(page), density === 'spacious' ? 1 : 2, `${density} ${theme}: columns`);
          const got = await notes(page, ids.long);
          assert.equal(got.text, NOTES, `${density} ${theme}: the card carries the whole Notes value`);
          assert.equal(got.clamp, 'none', `${density} ${theme}: Notes takes no line clamp`);
          assert.equal(got.hidden, false, `${density} ${theme}: no line of Notes is hidden`);
          assert.equal(await page.evaluate(() => document.scrollingElement.scrollWidth > document.documentElement.clientWidth), false, `${density} ${theme}: the page never scrolls sideways`);
          assert.deepEqual(await page.evaluate(probe, '.wv-board'), [], `${density} ${theme}: the board slices no glyph`);
        } finally { await page.close(); }
      }
    }
  });
}
