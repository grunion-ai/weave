import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const DESC = Array.from({ length: 10 }, (_, i) => `Line ${i + 1} of the table description.`).join('\n\n');

let wide;
const s = await launch('one scroll region on the table page', (weave) => {
  weave.createSpace({ name: 'Ledger' });
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
