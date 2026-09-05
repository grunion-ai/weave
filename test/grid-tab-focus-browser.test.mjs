/* Tab carries on from the row you are on (Issue #83).

   Editing a cell and tabbing out fires `change`, which PATCHes and then
   redraws the whole grid. The redraw lands a beat AFTER Tab has already put
   focus on the next cell, so it tore that cell's input out of the document
   and dropped focus on <body> — and the next Tab restarted at the top of the
   page instead of continuing along the row.

   Playwright is NOT a dependency; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let rows, second;
const s = await launch('grid tab focus', (weave) => {
  weave.createSpace({ name: 'Ledger' });
  rows = weave.createTable({ space: 'Ledger', name: 'Rows' });
  weave.addField(rows, { name: 'Note', type: 'text' });
  weave.addField(rows, { name: 'Tail', type: 'text' });
  weave.addField(rows, { name: 'Extra', type: 'text' });
  weave.createEntity(rows, { name: 'first', values: { Note: 'a', Tail: 'x', Extra: 'p' } });
  second = weave.createEntity(rows, { name: 'second', values: { Note: 'b', Tail: 'y', Extra: 'q' } });
  weave.createEntity(rows, { name: 'third', values: { Note: 'c', Tail: 'z', Extra: 'r' } });
});

if (s) {
  const { base, browser } = s;

  /* Where focus is, named by row and column, so a failure says which cell the
     browser landed on rather than "not the one we wanted". */
  const focusedCell = (page) => page.evaluate(() => {
    const cell = document.activeElement?.closest?.('tr[data-eid] > td');
    if (!cell) return { eid: null, field: null, tag: document.activeElement?.tagName ?? null };
    return { eid: cell.parentElement.dataset.eid, field: cell.dataset.field ?? null, tag: document.activeElement.tagName };
  });

  test('a redraw triggered by an edit leaves focus on the row the reader tabbed into', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${rows.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`tr[data-eid="${second.id}"] td[data-field="Note"] input`);

    // Mark the live grid: the redraw replaces the whole <tbody>, so the mark
    // vanishing is the signal that the PATCH round trip has landed.
    await page.evaluate(() => { document.querySelector('#main tbody').dataset.mark = '1'; });

    // Edit the middle row's Note, then Tab — the gesture in the report.
    await page.click(`tr[data-eid="${second.id}"] td[data-field="Note"] input`);
    await page.keyboard.type('!');
    await page.keyboard.press('Tab');

    // Focus is on Tail of the same row before the redraw — that much the
    // browser does on its own.
    assert.deepEqual(await focusedCell(page), { eid: second.id, field: 'Tail', tag: 'INPUT' },
      'Tab moves along the row');

    await page.waitForFunction(() => !document.querySelector('#main tbody[data-mark]'), null, { timeout: 5000 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    // ...and it is still there after the grid rebuilds itself underneath.
    assert.deepEqual(await focusedCell(page), { eid: second.id, field: 'Tail', tag: 'INPUT' },
      'the redraw puts focus back on the cell Tab had reached');

    // Which is what makes the NEXT Tab continue along the row instead of
    // restarting at the top of the page.
    await page.keyboard.press('Tab');
    assert.deepEqual(await focusedCell(page), { eid: second.id, field: 'Extra', tag: 'INPUT' },
      'the next Tab carries on along the same row');

    // Backwards walks from the same place, for the same reason: nothing
    // handles Tab, so restoring focus is all Shift-Tab ever needed.
    await page.keyboard.press('Shift+Tab');
    assert.deepEqual(await focusedCell(page), { eid: second.id, field: 'Tail', tag: 'INPUT' },
      'Shift-Tab walks back from the same cell');

    await page.close();
  });

  test('a cell that rests as a span, not a form control, is restored too', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${rows.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`tr[data-eid="${second.id}"] td[data-field="Name"] input`);
    await page.evaluate(() => { document.querySelector('#main tbody').dataset.mark = '1'; });

    // Description follows Name, and it rests as a preview span rather than a
    // form control — the very column the report was tabbing into. Restoring
    // only `button,input,select` put focus on <body> here even with the cell
    // correctly remembered.
    await page.click(`tr[data-eid="${second.id}"] td[data-field="Name"] input`);
    await page.keyboard.type('!');
    await page.keyboard.press('Tab');
    assert.deepEqual(await focusedCell(page), { eid: second.id, field: 'Description', tag: 'SPAN' },
      'Tab reaches the description cell');

    await page.waitForFunction(() => !document.querySelector('#main tbody[data-mark]'), null, { timeout: 5000 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    assert.deepEqual(await focusedCell(page), { eid: second.id, field: 'Description', tag: 'SPAN' },
      'the redraw puts focus back on the span the reader tabbed into');

    await page.close();
  });
}
