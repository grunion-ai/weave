/* The dock never scrolls sideways (Issue #372). A description holding a
   markdown table of full, unbroken URLs has a min-content width far past
   any dock; the dock's entity grid must keep its track at the panel width
   so the table scrolls inside its own box and the paragraphs wrap. A date
   row (input + picker button) must also fit the dock at its 360 px floor.
   Playwright is NOT a dependency; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const url = `https://www.example.com/products/${'ergonomic-office-chair-'.repeat(12)}sku-000123?ref=research&utm_source=weave`;
const doc = [
  'Research notes: a paragraph long enough to wrap at the width of the dock when the grid track keeps its size.',
  '',
  '| Store | Price | Link |',
  '| --- | --- | --- |',
  `| Example | $499 | ${url} |`,
  `| Other | $479 | ${url}&alt=1 |`,
].join('\n');

let list, row;
const s = await launch('entity dock overflow', (weave) => {
  weave.createSpace({ name: 'Buyer' });
  list = weave.createTable({ space: 'Buyer', name: 'Shopping List' });
  weave.addField(list, { name: 'Last Researched', type: 'date' });
  weave.addField(list, { name: 'Event Date', type: 'date', config: { format: 'ordinal' } });
  row = weave.createEntity(list, { name: 'Office chair', values: { 'Last Researched': '2026-09-20', 'Event Date': '2026-09-30' }, doc });
});
if (s) {
  const { base, browser } = s;
  async function openDocked(pinned) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.goto(`${base}/#/table/${list.id}`, { waitUntil: 'networkidle' });
    if (pinned) await page.evaluate((w) => localStorage.setItem('wv-dock-width', String(w)), pinned);
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.click(`tr[data-eid="${row.id}"] .open-link`);
    await page.waitForSelector('#dock:not([hidden]) .entity-body table');
    // The date box sizes itself to its text a frame after it lands.
    await page.waitForFunction(() => [...document.querySelectorAll('#dock .entity-values .date-text')].every((x) => x.style.getPropertyValue('--date-fit')));
    return page;
  }
  const measure = (page) => page.evaluate(() => {
    const d = document.querySelector('#dock');
    return { client: d.clientWidth, scroll: d.scrollWidth };
  });

  for (const [label, pinned] of [['at its 360 px minimum', 360], ['at the even split', 0]]) {
    test(`the dock does not scroll sideways ${label}`, async () => {
      const page = await openDocked(pinned);
      const m = await measure(page);
      if (pinned) assert.ok(m.client <= pinned + 1, `the dock sits at its pinned width: ${m.client}`);
      assert.ok(m.scroll <= m.client + 1, `#dock scrollWidth ${m.scroll} vs clientWidth ${m.client}`);
      await page.close();
    });
  }
}
