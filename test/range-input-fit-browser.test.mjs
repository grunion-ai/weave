import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, engineOf, phoneProfile } from './lib/browser.mjs';
import { CELLS, probe, settle } from './lib/cutoff.mjs';

const CENTURY = 'Jan 1, 1999 – Dec 31, 2099';
let table;
let board;
let century;

const s = await launch('range input fit', (weave) => {
  weave.createSpace({ name: 'Lab' });
  table = weave.createTable({ space: 'Lab', name: 'Sample' });
  weave.addField(table, { name: 'Status', type: 'workflow', config: { states: [{ name: 'Open', category: 'not-started', default: true }, { name: 'Done', category: 'done' }] } });
  weave.addField(table, { name: 'Window', type: 'daterange', config: { format: 'long' } });
  board = weave.tableView(`${table.id}/Board`, { layout: 'board', group: ['Status'] }).id;
  century = weave.createEntity(table, { name: 'Century', values: { Window: { start: '1999-01-01', end: '2099-12-31' } } }).id;
  weave.createEntity(table, { name: 'Season', values: { Window: { start: '2026-08-01', end: '2026-09-15' } } });
});

if (s) {
  const handset = await engineOf(CELLS.phone.engine);
  const pages = {
    desktop: (colorScheme) => s.browser.newPage({ viewport: CELLS.desktop.viewport, colorScheme }),
    phone: (colorScheme) => handset.newPage({ ...phoneProfile().page, viewport: CELLS.phone.viewport, colorScheme }),
  };
  const rangeCuts = async (page, root) => (await page.evaluate(probe, root)).filter((f) => f.selector.includes('range-cell'));

  for (const colorScheme of ['light', 'dark']) {
    for (const cell of Object.keys(CELLS)) {
      test(`${cell} ${colorScheme}: a board tile shows the whole date range (Issue #1126)`, async (t) => {
        if (cell === 'phone' && !handset) return t.skip(`${CELLS.phone.engine} cannot launch here`);
        const page = await pages[cell](colorScheme);
        try {
          await page.goto(`${s.base}/#/table/${table.id}/view/${board}`, { waitUntil: 'networkidle' });
          await page.waitForSelector('.wv-board .tile .range-cell input');
          await settle(page);
          assert.deepEqual(await rangeCuts(page, null), [], 'a tile cuts its range input');
          const values = await page.locator('.wv-board .tile .range-text').evaluateAll((is) => is.map((i) => i.value).sort());
          assert.deepEqual(values, ['Aug 1 – Sep 15, 2026', CENTURY], 'each tile still reads its whole range in one box');
        } finally { await page.close(); }
      });
    }

    test(`phone ${colorScheme}: the record page shows the whole date range (Issue #1162)`, async (t) => {
      if (!handset) return t.skip(`${CELLS.phone.engine} cannot launch here`);
      const page = await pages.phone(colorScheme);
      try {
        await page.goto(`${s.base}/#/table/${table.id}?e=${century}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('#dock .entity-fields .fieldrow .range-cell input');
        await settle(page);
        assert.deepEqual(await rangeCuts(page, '#dock'), [], 'the field row cuts its range input');
        assert.equal(await page.locator('#dock .fieldrow .range-text').inputValue(), CENTURY);
      } finally { await page.close(); }
    });
  }
}
