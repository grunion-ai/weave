import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const WIDTHS = [800, 920];

const READ = (to) => {
  const wrap = document.querySelector('#main .table-wrap');
  wrap.scrollLeft = to === 'end' ? wrap.scrollWidth : 0;
  const box = wrap.getBoundingClientRect();
  const scrolls = /auto|scroll/.test(getComputedStyle(wrap).overflowX) && wrap.scrollWidth > wrap.clientWidth + 1;
  const plus = wrap.querySelector('.add-field-btn')?.getBoundingClientRect();
  const heads = [...wrap.querySelectorAll('thead th.col-head')].map((th) => {
    const r = th.getBoundingClientRect();
    return { name: th.dataset.field ?? th.textContent.trim(), left: r.left, right: r.right };
  });
  const cells = [...wrap.querySelectorAll('tbody tr:first-child td')].map((td) => td.getBoundingClientRect().right);
  return {
    vw: innerWidth,
    wrapRight: box.right,
    scrolls,
    overflowX: getComputedStyle(wrap).overflowX,
    scrollWidth: wrap.scrollWidth,
    clientWidth: wrap.clientWidth,
    plus: plus && { left: plus.left, right: plus.right, top: plus.top, bottom: plus.bottom },
    heads,
    cellRight: Math.max(...cells),
  };
};

const s = await launch('tablet grid clip', (weave) => {
  weave.createSpace({ name: 'Backlog' });
  const task = weave.createTable({ space: 'Backlog', name: 'Task' });
  const names = ['State', 'Due', 'Workstream', 'Category', 'Tracks', 'Owner note', 'Next step', 'Context'];
  for (const name of names) weave.addField(task, { name, type: 'text' });
  for (let i = 0; i < 6; i++) {
    weave.createEntity(task, {
      name: `Task ${i}: a reasonably long record name that wants room`,
      values: Object.fromEntries(names.map((n) => [n, `${n} value ${i} with words`])),
    });
  }
  return { table: task.id, names };
});

if (s) {
  const { base, browser, table, names } = s;
  for (const theme of ['light', 'dark']) {
    for (const width of WIDTHS) {
      test(`a table wider than the pane scrolls sideways at ${width}px instead of clipping its last columns, and its + sits after the last header (${theme}, Issue #1356)`, async () => {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
        await page.goto(`${base}/#/table/${table}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('#main .table-wrap thead th.col-head');
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        const seen = await page.evaluate(READ, 'start');
        const drawn = seen.heads.map((h) => h.name);
        for (const n of names) assert.ok(drawn.some((d) => d.includes(n)), `${n} has a header at ${width}px`);
        const lastHead = Math.max(...seen.heads.map((h) => h.right));
        const clipped = lastHead > seen.wrapRight + 1 || seen.cellRight > seen.wrapRight + 1;
        assert.ok(!clipped || seen.scrolls, `columns run past the pane edge without a horizontal scroll at ${width}px: ${JSON.stringify(seen)}`);
        assert.ok(seen.plus, 'the add-field + is drawn');
        const covered = seen.heads.filter((h) => seen.plus.left < h.right - 1 && seen.plus.right > h.left + 1);
        assert.deepEqual(covered.map((h) => h.name), [], `the + covers a header at ${width}px`);
        const end = await page.evaluate(READ, 'end');
        const last = end.heads.at(-1);
        assert.ok(last.right <= end.wrapRight + 1, `scrolled to the end, ${last.name} shows whole at ${width}px (${last.right} > ${end.wrapRight})`);
        assert.ok(end.plus.left >= last.right - 1 && end.plus.right <= end.wrapRight + 1, `scrolled to the end, the + sits after ${last.name} inside the pane at ${width}px`);
        await page.close();
      });
    }
  }
}
