/* One scroll region on the table page (Issue #136).

   Kyle filed it against the Issue table in Safari: "double nested scroll bar
   when trying to scroll past the end". Issue #233 gave a grid wider than its
   card a vertical scroller of its own — the header and the Σ row stick to
   that box — and its suite pins the other half of the deal, that the page
   behind it does not scroll. The floor in that height (`max(50vh, …)`) broke
   the deal on a short window: a box half the screen tall, hung below chrome
   that already used more than half, pushes the page past the viewport, and
   the reader gets the two nested bars back — the inner one ends, the outer
   one takes over.

   The rule under test is the whole of it: on the table page exactly one box
   scrolls vertically. Heights below are ordinary laptop windows, not corner
   cases; the description above the grid is what makes the chrome tall, which
   is what every real weave table looks like. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const DESC = Array.from({ length: 10 }, (_, i) => `Line ${i + 1} of the table description.`).join('\n\n');

let wide;
const s = await launch('one scroll region on the table page', (weave) => {
  weave.createSpace({ name: 'Ledger' });
  // Wider than its card, so the wrap is the scroller (Issue #233), and long
  // enough that it has somewhere to scroll.
  wide = weave.createTable({ space: 'Ledger', name: 'Wide', description: DESC });
  for (let i = 0; i < 12; i++) weave.addField(wide, { name: `A long column name ${i}`, type: 'number' });
  for (let i = 0; i < 40; i++) weave.createEntity('Wide', { name: `w${i}`, values: { 'A long column name 0': i } });
});

if (s) {
  const { base, browser } = s;

  const geometry = async (height) => {
    const page = await browser.newPage({ viewport: { width: 1470, height } });
    try {
      await page.goto(`${base}/#/table/${wide.id}`, { waitUntil: 'load' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      // The description renders on its own schedule and moves the box down
      // when it lands, so a page whose chrome is still arriving says nothing
      // about the cut. Wait for the box to come to rest — its own position,
      // read on two consecutive frames — and read the geometry then. Where
      // the box ends is what is under test, so it is not part of the wait.
      await page.waitForFunction(() => {
        const w = document.querySelector('.table-wrap.wv-grid-scroll');
        if (!w || !w.style.maxHeight) return false;
        const top = Math.round(w.getBoundingClientRect().top);
        const rested = window.__gridTop === top;
        window.__gridTop = top;
        return rested;
      });
      return await page.evaluate(() => {
        const wrap = document.querySelector('.table-wrap.wv-grid-scroll');
        const cs = getComputedStyle(wrap);
        return {
          wrapScrolls: wrap.scrollHeight > wrap.clientHeight + 1 && /auto|scroll/.test(cs.overflowY),
          wrapHeight: wrap.clientHeight,
          wrapTop: Math.round(wrap.getBoundingClientRect().top + window.scrollY),
          pageOverflow: document.documentElement.scrollHeight - innerHeight,
          innerHeight,
        };
      });
    } finally {
      await page.close();
    }
  };

  for (const height of [794, 700, 600, 560, 520]) {
    test(`a ${height}px-tall window scrolls the grid box and not the page behind it (Issue #136)`, async () => {
      const g = await geometry(height);
      assert.ok(g.wrapScrolls, `the grid box owns the vertical scroll: ${JSON.stringify(g)}`);
      assert.ok(g.pageOverflow <= 1, `and the page behind it does not scroll too: ${JSON.stringify(g)}`);
      assert.ok(g.wrapHeight >= 120, `the box is still worth reading: ${JSON.stringify(g)}`);
    });
  }
}
