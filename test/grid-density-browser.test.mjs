/* The density flip keeps the reader's place (Issue #342).

   Density is a way of READING the table (Kyle, 2026-08-24), so flipping it
   part way down a long grid should leave the row under the reader's eye
   under it. It did not: the row window is placed from a body-relative
   offset divided by the row height, and shorter rows put a different row
   under the same offset, so a flip at row 209 drew from row 332.

   Both scrollers are pinned, because the geometry differs. A grid wider
   than its card scrolls inside its own wrap with the toolbar standing
   still, which is the flip a reader actually makes; a grid that fits
   scrolls the page, and its control is above the fold, so the pick is
   dispatched rather than clicked. The third case is the strip itself: it
   rebuilt its buttons on every pick, so the button the reader had just
   clicked left the document and focus fell to <body>.

   The fourth pair is Issue #413: a page-scrolled grid of UNEVEN rows (every
   third one carries a body with code in it, the way real weave grids do)
   at the reporter's 2187x1359, flipped both ways in both themes. There the
   flip landed one row off, row 224 heading the view where 223 had: the row
   was put back under the header once, and the re-window that followed moved
   it again.

   Playwright is NOT a dependency of weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const N = 600;
let narrow, wide, tall;
const s = await launch('the density flip', (weave) => {
  weave.createSpace({ name: 'Quality' });
  narrow = weave.createTable({ space: 'Quality', name: 'Case' });
  weave.addField(narrow, { name: 'Status', type: 'select', config: { options: ['pass', 'fail'] } });
  // Ten text columns take the grid past its card, so its wrap is the box
  // that scrolls and the toolbar stays on screen.
  wide = weave.createTable({ space: 'Quality', name: 'Run' });
  const notes = {};
  for (let k = 0; k < 10; k++) { weave.addField(wide, { name: `Note ${k}`, type: 'text' }); notes[`Note ${k}`] = `note ${k} value`; }
  for (let i = 0; i < N; i++) {
    const name = `case ${String(i).padStart(4, '0')}`;
    weave.createEntity(narrow, { name, values: { Status: i % 2 ? 'pass' : 'fail' } });
    weave.createEntity(wide, { name, values: notes });
  }
  // Issue #413's shape: 600 rows that fit their card, uneven in height.
  tall = weave.createTable({ space: 'Quality', name: 'Ledger' });
  for (let i = 0; i < N; i++) {
    weave.createEntity(tall, {
      name: `t${String(i).padStart(4, '0')}`,
      values: { Description: i % 3 === 0 ? 'A body with `code` in it and a few more words after' : '' },
    });
  }
});

if (s) {
  const { base, browser } = s;
  const COMPACT = '.seg-opt[title="Short rows, for scanning"]';
  const ROOMY = '.seg-opt[title="Roomy rows, for reading"]';

  const open = async (db) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${base}/#/table/${db.id}`, { waitUntil: 'load' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.waitForTimeout(300);
    return page;
  };
  // Which box scrolls, the index of the row at the top edge (a row still on
  // its way holds its place, so every row with a data-i counts), and what a
  // row measures at.
  const view = (page) => page.evaluate(() => {
    const wrap = document.querySelector('.table-wrap');
    const table = document.querySelector('.wv-grid');
    const box = wrap.classList.contains('wv-grid-scroll') ? wrap : null;
    // The lower edge of a STUCK field header is where the readable body
    // starts, in either box — and below the view header, which holds at the
    // top of the page itself (Issue #321).
    const edge = table.querySelector('thead th').getBoundingClientRect().bottom;
    let top = null;
    for (const tr of table.querySelectorAll('tbody tr[data-i]')) {
      if (tr.getBoundingClientRect().bottom > edge + 1) { top = Number(tr.dataset.i); break; }
    }
    return {
      scroller: box ? 'wrap' : 'page',
      top,
      scrollTop: Math.round((box ?? document.scrollingElement).scrollTop),
      rowH: Math.round(table.querySelector('tbody tr.entity-row').getBoundingClientRect().height * 10) / 10,
      density: table.dataset.density,
    };
  });
  const scrollTo = async (page, top) => {
    await page.evaluate((t) => {
      const wrap = document.querySelector('.table-wrap');
      (wrap.classList.contains('wv-grid-scroll') ? wrap : document.scrollingElement).scrollTo({ top: t, behavior: 'instant' });
    }, top);
    await page.waitForTimeout(400);
  };
  const settle = (page) => page.waitForTimeout(400);

  test('a density flip on a wide grid leaves the reader on the same row, both ways', async () => {
    const page = await open(wide);
    try {
      await scrollTo(page, 10800);
      const before = await view(page);
      assert.equal(before.scroller, 'wrap', 'a grid wider than its card scrolls in its own box');
      assert.ok(before.top > 100, `the reader is deep in the table: ${JSON.stringify(before)}`);

      await page.click(COMPACT);
      await settle(page);
      const compact = await view(page);
      assert.equal(compact.density, 'compact');
      assert.ok(compact.rowH < before.rowH - 4, `compact rows are shorter: ${before.rowH} to ${compact.rowH}`);
      assert.ok(compact.scrollTop > 0, `the reader is not back at the top: ${JSON.stringify(compact)}`);
      assert.equal(compact.top, before.top, `the same row heads the view: ${JSON.stringify({ before, compact })}`);

      await page.click(ROOMY);
      await settle(page);
      const roomy = await view(page);
      assert.ok(roomy.rowH > compact.rowH + 4, 'comfortable rows are taller again');
      assert.equal(roomy.top, before.top, `and the flip back carries it too: ${JSON.stringify({ before, roomy })}`);
    } finally { await page.close(); }
  });

  /* A grid that fits scrolls the page, so the toolbar is off the top of the
     window by the time the reader is this far down and a real click would
     have to travel to it first. The pick is dispatched instead: what is
     under test is the arithmetic on the page scroller, where the body's
     offset is read against the window rather than against a box. */
  test('a density flip on a page-scrolling grid leaves the reader on the same row', async () => {
    const page = await open(narrow);
    try {
      await scrollTo(page, 10800);
      const before = await view(page);
      assert.equal(before.scroller, 'page', 'a grid that fits its card scrolls the page');
      assert.ok(before.top > 100, `the reader is deep in the table: ${JSON.stringify(before)}`);

      await page.evaluate((sel) => document.querySelector(sel).click(), COMPACT);
      await settle(page);
      const compact = await view(page);
      assert.equal(compact.density, 'compact');
      assert.ok(compact.rowH < before.rowH - 4, `compact rows are shorter: ${before.rowH} to ${compact.rowH}`);
      assert.ok(compact.scrollTop > 0, `the reader is not back at the top: ${JSON.stringify(compact)}`);
      assert.equal(compact.top, before.top, `the same row heads the view: ${JSON.stringify({ before, compact })}`);
    } finally { await page.close(); }
  });

  /* Issue #413. The flip is dispatched for the reason above; what is pinned
     is the row heading the view after each flip, read off the stuck header
     cells, in both directions and both themes. */
  for (const theme of ['light', 'dark']) {
    test(`a density flip keeps the row heading a page-scrolled grid of uneven rows, both ways (${theme})`, async () => {
      const page = await browser.newPage({ viewport: { width: 2187, height: 1359 } });
      try {
        await page.goto(`${base}/#/table/${tall.id}`, { waitUntil: 'load' });
        await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
        await page.waitForSelector('.wv-grid tbody tr.entity-row');
        await page.waitForTimeout(300);
        await scrollTo(page, 10800);
        const pick = (sel) => page.evaluate((q) => document.querySelector(q).click(), sel);
        const roomy = await view(page);
        assert.equal(roomy.scroller, 'page', 'a grid that fits its card scrolls the page');
        assert.ok(roomy.top > 100, `the reader stands part way down: ${JSON.stringify(roomy)}`);

        await pick(COMPACT);
        await settle(page);
        const compact = await view(page);
        assert.ok(compact.rowH < roomy.rowH - 4, `the flip took: ${JSON.stringify({ roomy, compact })}`);
        assert.equal(compact.top, roomy.top, `Comfortable → Compact keeps the row heading the view: ${JSON.stringify({ roomy, compact })}`);

        await pick(ROOMY);
        await settle(page);
        const back = await view(page);
        assert.equal(back.top, roomy.top, `Compact → Comfortable keeps it too: ${JSON.stringify({ roomy, compact, back })}`);
      } finally { await page.close(); }
    });
  }

  test('picking a density keeps the focus on the button the reader clicked', async () => {
    const page = await open(wide);
    try {
      await page.click(COMPACT);
      await settle(page);
      const focused = await page.evaluate(() => ({
        tag: document.activeElement?.tagName ?? null,
        text: document.activeElement?.textContent?.trim() ?? null,
        on: document.activeElement?.classList.contains('on') ?? false,
      }));
      assert.deepEqual(focused, { tag: 'BUTTON', text: 'Compact', on: true },
        'the clicked button is still in the document, still focused, and wears the mark');
    } finally { await page.close(); }
  });
}
