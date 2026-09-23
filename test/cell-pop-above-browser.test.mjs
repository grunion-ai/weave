/* Issue #346 (supersedes Kyle's #327) — "it blocks click and edit, should
   show above the row/cell instead" (Kyle, 2026-09-23).
   The hover expansion of a clipped cell used to open OVER the value: a copy
   pinned so its text sat exactly on the live text (2026-08-26). The copy is
   pointer-events: none, so the click reached the cell, but the editor, the
   caret and every typed character then sat under a static copy of the old
   value. The rule now:
     1. the pop opens ABOVE the cell — its bottom edge ~4px over the cell's
        top, its content on the cell's content left;
     2. it flips BELOW the row when the room above inside the wrap's visible
        area is shorter than the pop, so the first rows still get one;
     3. mousedown or focus inside the grid takes it down, and it never opens
        over a cell whose control has focus.
   Geometry and focus, not source: this suite drives a real browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const LONG = (i) => `Row ${i}: a name long enough that the grid column has to clip it before the end`;
let tasks;
const s = await launch('cell pop above', (weave) => {
  weave.createSpace({ name: 'Product' });
  tasks = weave.createTable({ space: 'Product', name: 'Task' });
  weave.addField(tasks, { name: 'Notes', type: 'text' });
  for (let i = 1; i <= 10; i++) weave.createEntity(tasks, { name: LONG(i), values: { Notes: LONG(i) } });
});

if (s) {
  const { base, browser } = s;
  async function grid(theme) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    if (theme) await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector('.wv-grid tbody td.name-cell.clipped');
    return page;
  }
  // The clipped Name cell of body row `n` (0-based), tagged so Playwright can
  // aim a real pointer at it.
  async function tag(page, n) {
    const ok = await page.evaluate((n) => {
      const rows = [...document.querySelectorAll('.wv-grid tbody tr')]
        .filter((r) => r.querySelector('td.name-cell.clipped'));
      const td = rows[n]?.querySelector('td.name-cell.clipped');
      document.querySelectorAll('[data-t]').forEach((x) => x.removeAttribute('data-t'));
      if (!td) return false;
      td.setAttribute('data-t', 'cell');
      return true;
    }, n);
    assert.ok(ok, `row ${n} has a clipped name to hover`);
    return page.locator('[data-t="cell"]');
  }
  // Hover the way a person does, then wait out CELL_POP_DELAY (Issue #67).
  async function hoverAndRead(page, cell) {
    await cell.hover({ position: { x: 30, y: 10 } });
    await page.waitForTimeout(400);
    return page.evaluate(() => {
      const td = document.querySelector('[data-t="cell"]');
      const pop = document.querySelector('.cell-pop');
      const wrap = td.closest('.table-wrap');
      const first = (n) => (n.firstElementChild ?? n).getBoundingClientRect();
      const r = td.getBoundingClientRect();
      const row = td.closest('tr').getBoundingClientRect();
      const w = wrap.getBoundingClientRect();
      if (!pop) return { pop: false };
      const p = pop.getBoundingClientRect();
      return {
        pop: true,
        cell: { top: r.top, bottom: r.bottom, width: r.width },
        row: { top: row.top, bottom: row.bottom },
        wrapTop: w.top + wrap.clientTop,
        box: { top: p.top, bottom: p.bottom, width: p.width },
        dx: first(pop).left - first(td).left,
        text: pop.textContent,
      };
    });
  }

  for (const theme of ['light', 'dark']) {
    test(`a clipped cell with room above opens its expansion above it (${theme})`, async () => {
      const page = await grid(theme);
      try {
        const cell = await tag(page, 5);
        const got = await hoverAndRead(page, cell);
        assert.equal(got.pop, true, 'hovering opens the expansion');
        assert.ok(got.box.bottom <= got.cell.top,
          `the pop ends above the cell (pop bottom ${got.box.bottom}, cell top ${got.cell.top})`);
        assert.ok(got.cell.top - got.box.bottom <= 8,
          `and sits right on it, not floating off (${got.cell.top - got.box.bottom}px gap)`);
        assert.ok(Math.abs(got.dx) <= 1, `the copy keeps the value's left edge (moved ${got.dx}px)`);
        assert.ok(got.box.width >= got.cell.width - 1, 'at least as wide as the cell');
        assert.ok(got.box.width <= 381, `and never past the 380px measure (${got.box.width})`);
        assert.ok(got.text.includes('before the end'), 'it holds the whole value');
      } finally { await page.close(); }
    });
  }

  test('the first row has no room above, so its expansion opens below the row', async () => {
    const page = await grid();
    try {
      const cell = await tag(page, 0);
      const got = await hoverAndRead(page, cell);
      assert.equal(got.pop, true, 'the first row still gets an expansion');
      assert.ok(got.box.top >= got.row.bottom,
        `below the row (pop top ${got.box.top}, row bottom ${got.row.bottom})`);
      assert.ok(got.box.top >= got.wrapTop, 'and never clipped off the top of the grid');
    } finally { await page.close(); }
  });

  test('clicking into a cell takes the expansion down and keeps it down while editing', async () => {
    const page = await grid();
    try {
      const cell = await tag(page, 5);
      const opened = await hoverAndRead(page, cell);
      assert.equal(opened.pop, true, 'the expansion is up before the click');
      await page.mouse.down();
      assert.equal(await page.locator('.cell-pop').count(), 0, 'mousedown takes it down');
      await page.mouse.up();
      // The pointer rests on the cell while the editor has focus: a fresh
      // mouseover must not put a copy back over what is being typed.
      await cell.hover({ position: { x: 60, y: 12 } });
      await page.waitForTimeout(400);
      const state = await page.evaluate(() => ({
        pop: document.querySelectorAll('.cell-pop').length,
        focusIn: document.querySelector('[data-t="cell"]').contains(document.activeElement),
      }));
      assert.equal(state.focusIn, true, 'the click put focus in the cell');
      assert.equal(state.pop, 0, 'no copy opens over a cell being edited');
    } finally { await page.close(); }
  });

  test('focus moving into the grid takes the expansion down', async () => {
    const page = await grid();
    try {
      const cell = await tag(page, 5);
      assert.equal((await hoverAndRead(page, cell)).pop, true, 'the expansion is up');
      await page.evaluate(() => {
        const other = [...document.querySelectorAll('.wv-grid tbody td[data-field="Notes"] input')][2];
        other.focus();
      });
      assert.equal(await page.locator('.cell-pop').count(), 0, 'focusin inside the grid hides it');
    } finally { await page.close(); }
  });
}
