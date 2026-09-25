/* A density flip keeps the reader's place (Issue #342).

   Density is a way of READING the table (Kyle, 2026-08-24), so flipping it
   part way down a long grid must leave the reader on the row they were
   reading. It did not: the spacers that stand in for the rows not drawn are
   sized at one measured row height, and the flip re-measured that height and
   re-windowed at the same scroll position in PIXELS. Compact rows are
   shorter, so the same pixels are further down the table: measured before
   this fix, Comfortable to Compact moved the row heading the view from 125
   to 184 in the wrap-scrolled grid below, and from 222 to 326 in the
   page-scrolled one at the Issue's 10,800px.

   Both scroll modes are pinned. The wide table's wrap is the scroller (Issue
   #233), and the fitting table scrolls the page. The toolbar stays on
   screen in both (Issue #321; before that it scrolled away with a page, and
   Playwright's own click travelled back to the top to reach it, which is how
   the Issue measured row 191 to row 0), so the flip is a real pointer click
   where the reader stands, in both modes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let wide, tall;
const s = await launch('a density flip keeps the reader\'s place', (weave) => {
  weave.createSpace({ name: 'Ledger' });
  // Wider than its card, so the wrap is the scroller.
  wide = weave.createTable({ space: 'Ledger', name: 'Wide' });
  for (let i = 0; i < 12; i++) weave.addField(wide, { name: `A long column name ${i}`, type: 'number' });
  // Uneven rows, the way every real weave grid is uneven (Issue #317).
  for (let i = 0; i < 600; i++) {
    weave.createEntity('Wide', {
      name: `w${String(i).padStart(4, '0')}`,
      values: { Description: i % 7 === 0 ? 'A body with `code` in it and words after' : '', 'A long column name 0': i },
    });
  }
  // The Issue's own shape: 600 rows that fit their card, so the page scrolls.
  tall = weave.createTable({ space: 'Ledger', name: 'Tall' });
  for (let i = 0; i < 600; i++) {
    weave.createEntity('Tall', {
      name: `t${String(i).padStart(4, '0')}`,
      values: { Description: i % 3 === 0 ? 'A body with `code` in it and a few more words after' : '' },
    });
  }
});

if (s) {
  const { base, browser } = s;
  const COMPACT = '.seg-opt[title="Short rows, for scanning"]';
  const ROOMY = '.seg-opt[title="Roomy rows, for reading"]';

  /* The row heading the reader's view: the first drawn row whose bottom
     clears the sticky header, in whichever box scrolls. The header's CELLS
     stick; the <thead> box itself scrolls away in the flow, so its bottom is
     read off the cells, and never above the scrolling box's own top. */
  const place = (page) => page.evaluate(() => {
    const wrap = document.querySelector('.table-wrap');
    const box = wrap.classList.contains('wv-grid-scroll') ? wrap.getBoundingClientRect().top : 0;
    const line = Math.max(box, ...[...document.querySelector('.wv-grid thead').rows]
      .map((r) => r.cells[0]?.getBoundingClientRect().bottom ?? 0));
    const row = [...document.querySelectorAll('.wv-grid tbody tr.entity-row')]
      .find((r) => r.getBoundingClientRect().bottom > line + 1);
    return {
      row: Number(row.dataset.i),
      h: row.getBoundingClientRect().height,
      mode: wrap.classList.contains('wv-grid-scroll') ? 'wrap' : 'page',
      at: Math.round(wrap.classList.contains('wv-grid-scroll') ? wrap.scrollTop : scrollY),
    };
  });

  const open = async ({ table, viewport, theme, mode, top }) => {
    const page = await browser.newPage({ viewport });
    // The density is remembered per browser; every case starts Comfortable.
    await page.addInitScript(() => { try { localStorage.clear(); } catch { /* blocked */ } });
    await page.goto(`${base}/#/table/${table.id}`, { waitUntil: 'load' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.waitForFunction((m) => {
      const w = document.querySelector('.table-wrap');
      return m === 'wrap' ? !!(w?.classList.contains('wv-grid-scroll') && w.style.maxHeight) : !!w?.classList.contains('wv-fit');
    }, mode);
    await page.evaluate((t) => {
      const w = document.querySelector('.table-wrap');
      (w.classList.contains('wv-grid-scroll') ? w : document.scrollingElement).scrollTo({ top: t, behavior: 'instant' });
    }, top);
    await page.waitForTimeout(500);
    return page;
  };

  const flipBothWays = async (page, click, mode) => {
    const roomy = await place(page);
    assert.equal(roomy.mode, mode, `the grid under test scrolls the ${mode}`);
    assert.ok(roomy.row > 100, `the reader stands part way down: ${JSON.stringify(roomy)}`);
    await click(COMPACT);
    await page.waitForTimeout(600);
    const compact = await place(page);
    assert.ok(compact.h < roomy.h - 4, `the flip took: compact rows are shorter ${JSON.stringify({ roomy, compact })}`);
    assert.equal(compact.row, roomy.row, `Comfortable → Compact keeps the row heading the view: ${JSON.stringify({ roomy, compact })}`);
    await click(ROOMY);
    await page.waitForTimeout(600);
    const back = await place(page);
    assert.equal(back.row, roomy.row, `Compact → Comfortable keeps it too: ${JSON.stringify({ roomy, compact, back })}`);
  };

  for (const theme of ['light', 'dark']) {
    test(`a density flip keeps the row heading a wrap-scrolled grid, both ways (${theme})`, async () => {
      const page = await open({ table: wide, viewport: { width: 1470, height: 900 }, theme, mode: 'wrap', top: 6000 });
      try {
        await flipBothWays(page, (sel) => page.click(sel), 'wrap');
      } finally {
        await page.close();
      }
    });

    test(`a density flip keeps the row heading a page-scrolled grid, both ways (${theme})`, async () => {
      // The Issue's own numbers: 600 rows, 2187x1359, standing at 10,800.
      const page = await open({ table: tall, viewport: { width: 2187, height: 1359 }, theme, mode: 'page', top: 10800 });
      try {
        // The pinned toolbar is on screen far down the page: a real click.
        await flipBothWays(page, (sel) => page.click(sel), 'page');
      } finally {
        await page.close();
      }
    });
  }
}
