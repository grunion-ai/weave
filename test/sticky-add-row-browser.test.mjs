/* The "+ New" row floats at the foot of the viewport (Feature #196).

   On a table of hundreds of rows the add row sat below the fold: adding a
   row meant scrolling to the end first. Now the row is position:sticky at
   the bottom of the page — visible from the top of the table, resting in its
   natural place (above the Σ footer) once the reader reaches the end.

   Why the header was never sticky on the table page either: `.table-wrap`
   scrolled horizontally (`overflow-x: auto`), which makes it a scroll
   container, and a sticky cell sticks to the NEAREST scroll container — a
   box exactly as tall as the table, so nothing ever stuck to the window. The
   wrap is measured: one whose grid fits clips (`.wv-fit`), so the table
   scrolls with the page and both edges stick; a wider one keeps its
   horizontal scroll, as before — and so does a wrap nobody measures.

   A new row must land ABOVE the floating foot, not behind it: focusNewRow
   scrolls with a bottom cover the height of the foot.

   Playwright is NOT a dependency; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tasks, wide, projects, alpha, seeded;
const s = await launch('sticky add row', (weave) => {
  weave.createSpace({ name: 'Work' });
  tasks = weave.createTable({ space: 'Work', name: 'Tasks' });
  weave.addField(tasks, { name: 'Note', type: 'text' });
  projects = weave.createTable({ space: 'Work', name: 'Projects' });
  weave.addRelation(projects, { name: 'Tasks', targetDb: 'Tasks', cardinality: 'one-to-many', inverseName: 'Project' });
  alpha = weave.createEntity(projects, { name: 'Alpha' });
  seeded = [];
  for (let i = 0; i < 200; i++) seeded.push(weave.createEntity(tasks, { name: `task ${i}`, values: { Note: 'n' } }).id);
  // Enough columns that the grid outgrows a 1280px window.
  wide = weave.createTable({ space: 'Work', name: 'Wide' });
  for (let i = 0; i < 12; i++) weave.addField(wide, { name: `A long column name ${i}`, type: 'text' });
  weave.createEntity(wide, { name: 'one' });
});

if (s) {
  const { base, browser } = s;
  const rect = (page, sel) => page.evaluate((q) => {
    const n = document.querySelector(q);
    return n ? { ...n.getBoundingClientRect().toJSON(), ih: innerHeight, iw: innerWidth } : null;
  }, sel);
  const inView = (r) => r.top >= 0 && r.bottom <= r.ih && r.height > 0;
  const overlap = (a, b) => a.top < b.bottom && b.top < a.bottom && a.left < b.right && b.left < a.right;
  const openTasks = async (page) => {
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`tr[data-eid="${seeded[0]}"] td[data-field="Name"] input`);
    await page.waitForSelector('.wv-grid .add-entity-btn');
  };

  test('the + New row is on screen from the top of a 200-row table, once', async () => {
    const page = await browser.newPage();
    await openTasks(page);
    assert.equal(await page.evaluate(() => scrollY), 0, 'the page opens at the top');
    assert.equal(await page.locator('.wv-grid .add-entity-btn').count(), 1, 'one foot button');
    const btn = await rect(page, '.wv-grid .add-entity-btn');
    assert.ok(inView(btn), `the foot sits inside the viewport: ${JSON.stringify(btn)}`);
    assert.ok(btn.bottom > btn.ih - 60, 'and at its bottom edge');
    // The header holds at the top edge too — the wrap no longer swallows sticky.
    await page.evaluate(() => scrollTo(0, 2000));
    await page.waitForTimeout(150);
    const th = await rect(page, '.wv-grid thead th.col-head');
    assert.ok(th.top >= 0 && th.top < 40, `the header stays at the top edge while scrolling: top=${th.top}`);
    const mid = await rect(page, '.wv-grid .add-entity-btn');
    assert.ok(inView(mid), 'the foot is still on screen mid-table');
    await page.close();
  });

  test('at the end of the table the foot rests in its natural place, above the Σ footer', async () => {
    const page = await browser.newPage();
    await openTasks(page);
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.wv-grid .add-entity-btn').count(), 1, 'still exactly one');
    const btn = await rect(page, '.wv-grid .add-entity-btn');
    const foot = await rect(page, '.wv-grid tfoot td');
    const last = await rect(page, `tr[data-eid="${seeded[199]}"]`);
    assert.ok(inView(btn), 'visible at the end');
    assert.ok(btn.top >= last.bottom - 1, 'below the last row');
    assert.ok(btn.bottom <= foot.top + 1, 'above the Σ footer');
    await page.close();
  });

  test('clicking it creates the row, focuses its Name cell, and the row is not under the foot', async () => {
    const page = await browser.newPage();
    await openTasks(page);
    await page.click('.wv-grid .add-entity-btn');
    await page.waitForFunction((ids) => {
      const cell = document.activeElement?.closest?.('tr[data-eid] > td');
      return !!cell && !ids.includes(cell.parentElement.dataset.eid);
    }, seeded, { timeout: 5000 });
    await page.waitForTimeout(400);
    const at = await page.evaluate(() => {
      const a = document.activeElement;
      const cell = a.closest('tr[data-eid] > td');
      const row = cell.parentElement;
      return { tag: a.tagName, field: cell.dataset.field, eid: row.dataset.eid, row: { ...row.getBoundingClientRect().toJSON(), ih: innerHeight } };
    });
    assert.equal(at.tag, 'INPUT');
    assert.equal(at.field, 'Name');
    assert.ok(!seeded.includes(at.eid), 'a new row');
    assert.ok(inView(at.row), `the new row is fully on screen: ${JSON.stringify(at.row)}`);
    const btn = await rect(page, '.wv-grid .add-entity-btn');
    assert.ok(!overlap(at.row, btn), `the foot does not cover the new row: row=${JSON.stringify(at.row)} foot=${JSON.stringify(btn)}`);
    await page.close();
  });

  test('a grid wider than its card keeps its horizontal scroll', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${wide.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid .add-entity-btn');
    await page.waitForTimeout(300);
    const wrap = await page.evaluate(() => {
      const w = document.querySelector('.table-wrap');
      return { overflowX: getComputedStyle(w).overflowX, scrolls: w.scrollWidth > w.clientWidth };
    });
    assert.equal(wrap.overflowX, 'auto');
    assert.ok(wrap.scrolls, 'the wide grid scrolls sideways inside its card');
    // Tasks fits, so it clips: no scroll container between the grid and the page.
    await openTasks(page);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.table-wrap')).overflowX === 'clip');
    await page.close();
  });

  test('the related-section foot on an entity page stays in the flow', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${alpha.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.related-section .add-entity-row td');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.related-section .add-entity-row td')).position), 'static');
    await page.close();
  });
}
