import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const LONG = 'Single-writer: CLI and server must not write one workspace file at the same time';

let tasks;

const s = await launch('clipped cells', (weave) => {
  weave.createSpace({ name: 'Product' });
  tasks = weave.createTable({ space: 'Product', name: 'Task' });
  weave.addField(tasks, { name: 'Notes', type: 'text' });
  weave.createEntity(tasks, { name: LONG, values: { Notes: LONG } });
  weave.createEntity(tasks, { name: 'Short', values: { Notes: 'brief' } });
});

if (s) {
  const { base, browser } = s;

  async function grid(theme) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    if (theme) await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector('.wv-grid tbody tr');
    await page.waitForTimeout(200);
    return page;
  }

  for (const theme of ['light', 'dark']) {
    test(`a name whose value overflows its control is marked clipped (${theme})`, async () => {
      const page = await grid(theme);
      try {
        const seen = await page.evaluate(() => [...document.querySelectorAll('.wv-grid tbody td.name-cell')]
          .map((td) => {
            const inp = td.querySelector('input');
            return {
              value: inp?.value ?? '',
              clipped: td.classList.contains('clipped'),
              overflows: !!inp && inp.scrollWidth > inp.clientWidth + 1,
            };
          }));
        const long = seen.find((c) => c.value.length > 40);
        assert.ok(long, 'the long name is on the page');
        assert.equal(long.overflows, true, 'and its control really does cut the value off');
        assert.equal(long.clipped, true, 'so the cell is marked, and hover has something to open');
        const short = seen.find((c) => c.value === 'Short');
        assert.equal(short.clipped, false, 'a value that fits gets no marker');
      } finally { await page.close(); }
    });

    test(`the expansion shows the whole name, not another clipped box (${theme})`, async () => {
      const page = await grid(theme);
      try {
        const shown = await page.evaluate(async () => {
          const td = [...document.querySelectorAll('.wv-grid tbody td.name-cell.clipped')][0];
          if (!td) return null;
          td.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 400));
          const pop = document.querySelector('.cell-pop');
          if (!pop) return { pop: false };
          return {
            pop: true,
            text: pop.textContent,
            hidden: pop.scrollWidth - pop.clientWidth,
            popHeight: pop.getBoundingClientRect().height,
            cellHeight: td.getBoundingClientRect().height,
            boxed: !!pop.querySelector('input'),
          };
        });
        assert.ok(shown, 'the name cell is marked, so it can be hovered');
        assert.equal(shown.pop, true, 'hovering it opens the expansion');
        assert.ok(shown.text.includes('at the same time'),
          `the copy holds the end of the value (${shown.text})`);
        assert.ok(shown.hidden <= 1, `and hides none of it (${shown.hidden}px overflowing)`);
        assert.equal(shown.boxed, false, 'the value reads as text — a control could neither wrap nor grow');
        assert.ok(shown.popHeight > shown.cellHeight,
          `so it wraps onto lines the row had no room for (${shown.popHeight} vs ${shown.cellHeight})`);
      } finally { await page.close(); }
    });
  }

  test('a plain text cell expands the same way the name does', async () => {
    const page = await grid();
    try {
      const seen = await page.evaluate(() => {
        const td = [...document.querySelectorAll('.wv-grid tbody td[data-field="Notes"]')]
          .find((t) => (t.querySelector('input')?.value ?? '').length > 40);
        return { clipped: td?.classList.contains('clipped') ?? null };
      });
      assert.equal(seen.clipped, true, 'a long note is marked too');
    } finally { await page.close(); }
  });
}
