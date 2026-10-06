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

  const focusedCell = (page) => page.evaluate(() => {
    const cell = document.activeElement?.closest?.('tr[data-eid] > td');
    if (!cell) return { eid: null, field: null, tag: document.activeElement?.tagName ?? null };
    return { eid: cell.parentElement.dataset.eid, field: cell.dataset.field ?? null, tag: document.activeElement.tagName };
  });

  const cursorInGrid = (page) => page.waitForFunction(() => {
    const td = document.activeElement?.closest?.('tr[data-eid] > td');
    if (!td) return false;
    return { eid: td.parentElement.dataset.eid, field: td.dataset.field ?? null, tag: document.activeElement.tagName };
  }).then((h) => h.jsonValue());

  const commitLands = (page) => page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/api\/entities\//.test(r.url()));
  const settledFocus = async (page, landed) => {
    await landed;
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    return page.waitForFunction(() => {
      const td = document.activeElement?.closest?.('tr[data-eid] > td');
      if (!td) return false;
      return { eid: td.parentElement.dataset.eid, field: td.dataset.field ?? null, tag: document.activeElement.tagName };
    }).then((h) => h.jsonValue());
  };

  test('a redraw triggered by an edit leaves focus on the row the reader tabbed into', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${rows.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`tr[data-eid="${second.id}"] td[data-field="Note"] input`);

    await page.click(`tr[data-eid="${second.id}"] td[data-field="Note"] input`);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('!');
    const landed = commitLands(page);
    await page.keyboard.press('Tab');

    assert.deepEqual(await cursorInGrid(page), { eid: second.id, field: 'Tail', tag: 'TD' },
      'Tab moves along the row');

    assert.deepEqual(await settledFocus(page, landed), { eid: second.id, field: 'Tail', tag: 'TD' },
      'the redraw puts focus back on the cell Tab had reached');

    await page.keyboard.press('Tab');
    assert.deepEqual(await focusedCell(page), { eid: second.id, field: 'Extra', tag: 'TD' },
      'the next Tab carries on along the same row');

    await page.keyboard.press('Shift+Tab');
    assert.deepEqual(await focusedCell(page), { eid: second.id, field: 'Tail', tag: 'TD' },
      'Shift-Tab walks back from the same cell');

    await page.close();
  });

  test('a cell that rests as a span, not a form control, is restored too', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${rows.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`tr[data-eid="${second.id}"] td[data-field="Name"] input`);

    await page.click(`tr[data-eid="${second.id}"] td[data-field="Name"] input`);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('!');
    const landed = commitLands(page);
    await page.keyboard.press('Tab');
    assert.deepEqual(await cursorInGrid(page), { eid: second.id, field: 'Description', tag: 'TD' },
      'Tab reaches the description cell');

    assert.deepEqual(await settledFocus(page, landed), { eid: second.id, field: 'Description', tag: 'TD' },
      'the redraw puts focus back on the cell the reader tabbed into');

    await page.close();
  });

  test('the cursor comes back however long the redraw takes', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${rows.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`tr[data-eid="${second.id}"] td[data-field="Note"] input`);

    await page.route('**/api/entities/*', async (route) => {
      await new Promise((r) => { setTimeout(r, 5500); });
      await route.continue();
    });

    await page.click(`tr[data-eid="${second.id}"] td[data-field="Note"] input`);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('!');
    const landed = commitLands(page);
    await page.keyboard.press('Tab');

    assert.deepEqual(await settledFocus(page, landed), { eid: second.id, field: 'Tail', tag: 'TD' },
      'the cursor is back on the cell Tab reached, 5.5 s after the edit');

    await page.close();
  });
}
