/* The bottom of a table holds still (Issue #317).

   Kyle filed it against the Issue table in Safari: "bouncing scroll when
   hitting the bottom of a table". Measured on a copy of that data, every
   wheel notch at the last row moved the box between two content heights,
   11,377px and 11,566px, and two scroll positions, 10,809 and 10,782, for as
   long as he kept pushing: twelve backwards jumps in twelve notches.

   The loop: rows are not all the same height (the live Issue grid measures
   46.5, 47, 48 and 50), the spacers stand in for the rows not drawn at ONE
   height, and the window paints a double buffer behind the direction of
   travel. At the bottom the leading edge is pinned to the last row, so a
   direction flip moves only the trailing edge — a buffer of rows swaps with a
   spacer that does not weigh the same, the content height moves, the box
   clamps its own scroll to the new bottom, and that clamp reads as backwards
   travel, which flips the direction again. The 27px was the box correcting
   itself, not a gesture.

   What this pins is what the reader feels: the box comes to rest on the last
   row and pushing does not move it. The rule underneath — a direction is a
   row of travel, never a pixel — is pinned in test/grid-window.test.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const N = 800;
let wide, tall;
const s = await launch('the bottom of a table holds still', (weave) => {
  weave.createSpace({ name: 'Ledger' });
  // Wider than its card, so the wrap is the scroller (Issue #233) and the
  // grid owns the vertical scroll the reader reaches the end of.
  wide = weave.createTable({ space: 'Ledger', name: 'Wide' });
  for (let i = 0; i < 12; i++) weave.addField(wide, { name: `A long column name ${i}`, type: 'number' });
  for (let i = 0; i < N; i++) {
    // Uneven rows, the way every real weave grid is uneven: a description
    // preview with a code span in it sits a pixel taller than an empty one,
    // so no single measured height is every row's height.
    weave.createEntity('Wide', {
      name: `w${String(i).padStart(4, '0')}`,
      values: { Description: i % 7 === 0 ? 'A body with `code` in it and words after' : '', 'A long column name 0': i },
    });
  }
  /* The second shape, and the one Kyle filed #324 against: a grid that FITS
     its card, so the page is the scroller and the spacer above the window is
     thousands of pixels of it. Row heights vary by a pixel — a description
     preview here, a chip there, on strides that share no factor with the
     buffer, so the row heading the window is not always the same height. */
  tall = weave.createTable({ space: 'Ledger', name: 'Tall' });
  weave.addField(tall, { name: 'Severity', type: 'select', config: { options: ['Low', 'Medium', 'High'] } });
  for (let i = 0; i < 600; i++) {
    weave.createEntity('Tall', {
      name: `t${String(i).padStart(4, '0')}`,
      values: {
        Description: i % 3 === 0 ? 'A body with `code` in it and a few more words after' : '',
        ...(i % 5 === 0 ? { Severity: 'High' } : {}),
      },
    });
  }
});

if (s) {
  const { base, browser } = s;

  /* Opens the table and wheels down to the last row, the way a reader gets
     there, then hands back the page with the pointer over the grid. */
  const atTheBottom = async () => {
    const page = await browser.newPage({ viewport: { width: 1470, height: 900 } });
    await page.goto(`${base}/#/table/${wide.id}`, { waitUntil: 'load' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.waitForFunction(() => !!document.querySelector('.table-wrap.wv-grid-scroll')?.style.maxHeight);
    const box = await page.evaluate(() => {
      const r = document.querySelector('.table-wrap.wv-grid-scroll').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.move(box.x, box.y);
    const atEnd = () => page.evaluate(() => {
      const w = document.querySelector('.table-wrap.wv-grid-scroll');
      return w.scrollTop >= w.scrollHeight - w.clientHeight - 1;
    });
    for (let i = 0; i < 80 && !(await atEnd()); i++) { await page.mouse.wheel(0, 900); await page.waitForTimeout(40); }
    await page.waitForTimeout(400);
    const heights = await page.evaluate(() => new Set([...document.querySelectorAll('.wv-grid tbody tr.entity-row')]
      .map((r) => Math.round(r.getBoundingClientRect().height))).size);
    // Feature #239: rows no longer vary; every row is its density's token.
    assert.equal(heights, 1, 'every row of the grid under test is one declared height');
    return page;
  };

  /* The reporter's own viewport, where the Issue table's rows measure 46.5,
     47 and 48 — the variance that this suite's second table stands in for. */
  const atTheBottomOfTall = async () => {
    const page = await browser.newPage({ viewport: { width: 2187, height: 1359 } });
    await page.goto(`${base}/#/table/${tall.id}`, { waitUntil: 'load' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.waitForFunction(() => document.querySelector('.table-wrap')?.classList.contains('wv-fit'));
    await page.mouse.move(1000, 1000);
    for (let i = 0; i < 80 && !(await page.evaluate(() => scrollY >= document.documentElement.scrollHeight - innerHeight - 1)); i++) {
      await page.mouse.wheel(0, 900); await page.waitForTimeout(25);
    }
    await page.waitForTimeout(1200);
    const heights = await page.evaluate(() => new Set([...document.querySelectorAll('.wv-grid tbody tr.entity-row')]
      .map((r) => Math.round(r.getBoundingClientRect().height))).size);
    // Feature #239: rows no longer vary; every row is its density's token.
    assert.equal(heights, 1, 'every row of the grid under test is one declared height');
    return page;
  };

  /* Kyle: "clicking new breaks scroll". What broke it was there before the
     click and outlasted it: at the last row the page scrolled by itself,
     three positions in a cycle, thirty times a second, and the console filled
     with "ResizeObserver loop completed with undelivered notifications".
     The row height feeding the spacer was re-read from whichever row headed
     the window on every pass, so a pixel of row-to-row variance became
     hundreds of pixels of page height, the box at the bottom clamped to it,
     and the observer that measured it fired again on the clamp. */
  test('the last row of a page-scrolled grid comes to rest (Issue #324)', async () => {
    const page = await atTheBottomOfTall();
    try {
      await page.evaluate(() => {
        window.__moves = [];
        addEventListener('scroll', () => window.__moves.push(Math.round(scrollY)), true);
      });
      // No wheel, no key, no pointer: the page is left alone for two seconds.
      await page.waitForTimeout(2000);
      const moves = await page.evaluate(() => window.__moves);
      assert.deepEqual(moves, [], `the page does not scroll itself: ${JSON.stringify(moves.slice(0, 9))}`);
    } finally {
      await page.close();
    }
  });

  /* And the gesture the Issue is named for: the + New foot at the bottom of
     that same grid leaves the reader in the row it made, with the caret in
     its Name cell, and the page still. */
  test('+ New at the bottom lands the caret and leaves the page still (Issue #324)', async () => {
    const page = await atTheBottomOfTall();
    try {
      await page.click('.add-entity-btn');
      await page.waitForFunction(() => document.activeElement?.closest?.('td')?.dataset?.field === 'Name', null, { timeout: 8000 });
      await page.waitForTimeout(600);
      await page.evaluate(() => {
        window.__moves = [];
        addEventListener('scroll', () => window.__moves.push(Math.round(scrollY)), true);
      });
      await page.waitForTimeout(1500);
      const moves = await page.evaluate(() => window.__moves);
      assert.deepEqual(moves, [], `the page rests after the new row (Issue #324): ${JSON.stringify(moves.slice(0, 9))}`);
    } finally {
      await page.close();
    }
  });

  /* The height is kept per table, density and width, so the two things that
     really do change it still change it. A density flip is the one a reader
     makes by hand. */
  test('a density flip re-measures the row the spacer stands in for (Issue #324)', async () => {
    const page = await browser.newPage({ viewport: { width: 2187, height: 1359 } });
    try {
      await page.goto(`${base}/#/table/${tall.id}`, { waitUntil: 'load' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      // Part way down, so there is a spacer above the window to read the
      // height back off: its pixels over the rows it stands in for.
      await page.mouse.move(1000, 1000);
      for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 900); await page.waitForTimeout(25); }
      await page.waitForTimeout(600);
      const spacerRow = () => page.evaluate(() => {
        const tb = document.querySelector('.wv-grid tbody');
        const first = tb.querySelector('tr.entity-row');
        return {
          estimate: parseFloat(tb.querySelector('tr.wv-spacer td').style.height) / Number(first.dataset.i),
          real: first.getBoundingClientRect().height,
        };
      });
      const roomy = await spacerRow();
      assert.ok(Math.abs(roomy.estimate - roomy.real) < 2, `the spacer stands in at the row's own height: ${JSON.stringify(roomy)}`);
      await page.click('.table-density-btn');
      await page.click('.seg-opt[title="Short rows, for scanning"]');
      // The flip leaves the reader where they were reading (Issue #342), so
      // the spacer above the window still has rows to stand in for.
      await page.waitForTimeout(600);
      for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 900); await page.waitForTimeout(25); }
      await page.waitForTimeout(600);
      const compact = await spacerRow();
      assert.ok(compact.real < roomy.real - 4, `compact rows are shorter: ${JSON.stringify({ roomy, compact })}`);
      assert.ok(Math.abs(compact.estimate - compact.real) < 2, `and the spacer follows them down: ${JSON.stringify(compact)}`);
    } finally {
      await page.close();
    }
  });

  test('pushing past the last row moves nothing (Issue #317)', async () => {
    const page = await atTheBottom();
    try {
      await page.evaluate(() => {
        const w = document.querySelector('.table-wrap.wv-grid-scroll');
        window.__moves = [];
        w.addEventListener('scroll', () => window.__moves.push([Math.round(w.scrollTop), w.scrollHeight]));
      });
      for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(90); }
      await page.waitForTimeout(300);
      const moves = await page.evaluate(() => window.__moves);
      const back = moves.filter((m, i) => i > 0 && m[0] < moves[i - 1][0] - 2).length;
      assert.equal(back, 0, `the box never travels backwards under a push forward: ${JSON.stringify(moves.slice(0, 8))}`);
      const rest = await page.evaluate(() => {
        const w = document.querySelector('.table-wrap.wv-grid-scroll');
        return { top: Math.round(w.scrollTop), end: w.scrollHeight - w.clientHeight };
      });
      assert.equal(rest.top, rest.end, `and rests on the last row: ${JSON.stringify(rest)}`);
    } finally {
      await page.close();
    }
  });

}
