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
let wide;
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
    assert.ok(heights > 1, 'the grid under test has rows of more than one height');
    return page;
  };

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
