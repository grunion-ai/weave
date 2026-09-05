/* Cells rest as values: arrows and Tab navigate, Space selects, Return opens
   (Feature #134, REST) — against a real page.

   The pure keymap is pinned in test/grid-keymap.test.mjs. What this suite
   proves is the DOM half in public/app.js: that a cell is a focus stop and
   its control is not, that the verbs land on the right cell, that a commit
   survives the redraw it triggers, and that the columns Issue #84 named
   (select, multi-select, checkbox, date) are stops while a document chip
   column is not.

   Playwright is NOT a dependency of weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let rows, first, second, third;
const s = await launch('grid keymap', (weave) => {
  weave.createSpace({ name: 'Ledger' });
  rows = weave.createTable({ space: 'Ledger', name: 'Rows' });
  weave.addField(rows, { name: 'Note', type: 'text' });
  weave.addField(rows, { name: 'Kind', type: 'select', config: { options: ['bug', 'chore'] } });
  weave.addField(rows, { name: 'Tags', type: 'multiselect', config: { options: ['a', 'b'] } });
  weave.addField(rows, { name: 'Done', type: 'checkbox' });
  weave.addField(rows, { name: 'When', type: 'date' });
  weave.addField(rows, { name: 'Spec', type: 'document' });
  weave.addField(rows, { name: 'Tail', type: 'text' });
  first = weave.createEntity(rows, { name: 'first', values: { Note: 'a', Kind: 'bug', Tail: 'x' } });
  second = weave.createEntity(rows, { name: 'second', values: { Note: 'b', Tail: 'y' } });
  third = weave.createEntity(rows, { name: 'third', values: { Note: 'c', Tail: 'z' } });
});

if (s) {
  const { base, browser } = s;

  /* Where focus is: the cell it is in (by row and field) and whether the
     cell itself holds it (rest) or something inside it (open). */
  const at = (page) => page.evaluate(() => {
    const a = document.activeElement;
    const cell = a?.closest?.('tr[data-eid] > td');
    if (!cell) return { eid: null, field: null, tag: a?.tagName ?? null };
    return { eid: cell.parentElement.dataset.eid, field: cell.dataset.field ?? null, tag: a.tagName };
  });
  const chosen = (page) => page.evaluate(() =>
    [...document.querySelectorAll('.wv-grid tbody tr.row-selected')].map((r) => r.dataset.eid));

  const grid = async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${rows.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`tr[data-eid="${second.id}"] td[data-field="Note"]`);
    return page;
  };
  /* A commit PATCHes and redraws, and the redraw puts the cursor back a
     frame later. Where the cursor is BETWEEN those is not the contract;
     where it is once the marked <tbody> has been replaced and focus has
     landed is. */
  const settledOn = (page, eid, field) => page.waitForFunction(([e, f]) => {
    if (document.querySelector('#main tbody[data-mark]')) return false; // the redraw has not landed yet
    const td = document.activeElement?.closest?.('tr[data-eid] > td');
    return document.activeElement === td && td?.parentElement.dataset.eid === e && td?.dataset.field === f;
  }, [eid, field], { timeout: 5000 });
  const restOn = async (page, eid, field) => {
    await page.focus(`tr[data-eid="${eid}"] td[data-field="${field}"]`);
    assert.deepEqual(await at(page), { eid, field, tag: 'TD' }, `resting on ${field}`);
  };

  /* ── a cell is the stop; its control is not ───────────────────────── */

  test('every field cell is a focus stop and the controls inside are not', async () => {
    const page = await grid();
    try {
      const stops = await page.evaluate((eid) => {
        const row = document.querySelector(`tr[data-eid="${eid}"]`);
        return [...row.querySelectorAll('td[tabindex="0"]')].map((td) => td.dataset.field);
      }, first.id);
      assert.deepEqual(stops, ['Name', 'Description', 'Note', 'Kind', 'Tags', 'Done', 'When', 'Tail'],
        'select, multi-select, checkbox and date cells are stops (Issue #84); the Spec chip column is not');
      const inner = await page.evaluate((eid) => {
        const row = document.querySelector(`tr[data-eid="${eid}"]`);
        return [...row.querySelectorAll('input, button, a, [tabindex]')]
          .filter((n) => n.tagName !== 'TD').map((n) => n.tabIndex);
      }, first.id);
      assert.ok(inner.length > 3, 'the row holds controls');
      assert.ok(inner.every((t) => t === -1), 'none of them is in the Tab order — the cell is');
    } finally { await page.close(); }
  });

  /* ── at rest: the arrows and Tab navigate ─────────────────────────── */

  test('arrows move the resting cursor in all four directions', async () => {
    const page = await grid();
    try {
      await restOn(page, second.id, 'Note');
      await page.keyboard.press('ArrowRight');
      assert.deepEqual(await at(page), { eid: second.id, field: 'Kind', tag: 'TD' });
      await page.keyboard.press('ArrowLeft');
      assert.deepEqual(await at(page), { eid: second.id, field: 'Note', tag: 'TD' });
      await page.keyboard.press('ArrowDown');
      assert.deepEqual(await at(page), { eid: third.id, field: 'Note', tag: 'TD' });
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');
      assert.deepEqual(await at(page), { eid: first.id, field: 'Note', tag: 'TD' });
      await page.keyboard.press('ArrowUp');
      assert.deepEqual(await at(page), { eid: first.id, field: 'Note', tag: 'TD' }, '↑ on the first row stays');
    } finally { await page.close(); }
  });

  test('Tab walks the row, skips the document chip, wraps into the next row, and never leaves the grid', async () => {
    const page = await grid();
    try {
      await restOn(page, first.id, 'When');
      await page.keyboard.press('Tab');
      assert.deepEqual(await at(page), { eid: first.id, field: 'Tail', tag: 'TD' }, 'Spec is not a stop');
      await page.keyboard.press('Tab');
      assert.deepEqual(await at(page), { eid: second.id, field: 'Name', tag: 'TD' }, 'Tab wraps into the next row');
      await page.keyboard.press('Shift+Tab');
      assert.deepEqual(await at(page), { eid: first.id, field: 'Tail', tag: 'TD' }, '⇧Tab wraps back');
      await restOn(page, third.id, 'Tail');
      await page.keyboard.press('Tab');
      assert.deepEqual(await at(page), { eid: third.id, field: 'Tail', tag: 'TD' },
        'the last cell of the last row is the end of the grid, not the start of the browser chrome (Issue #84)');
    } finally { await page.close(); }
  });

  /* ── Return / a character open; Esc reverts; Return commits down ──── */

  test('Return opens a text cell with the value selected; Esc puts it back and rests', async () => {
    const page = await grid();
    try {
      await restOn(page, second.id, 'Note');
      await page.keyboard.press('Enter');
      assert.deepEqual(await at(page), { eid: second.id, field: 'Note', tag: 'INPUT' }, 'open');
      assert.deepEqual(await page.evaluate(() => [document.activeElement.selectionStart, document.activeElement.selectionEnd]), [0, 1],
        'the whole value is selected, so typing replaces it');
      await page.keyboard.type('zzz');
      await page.keyboard.press('Escape');
      assert.deepEqual(await at(page), { eid: second.id, field: 'Note', tag: 'TD' }, 'back at rest');
      assert.equal(await page.inputValue(`tr[data-eid="${second.id}"] td[data-field="Note"] input`), 'b', 'the value is restored');
    } finally { await page.close(); }
  });

  test('a typed character opens the cell and lands in it, replacing the value', async () => {
    const page = await grid();
    try {
      await restOn(page, third.id, 'Tail');
      await page.keyboard.type('q');
      assert.deepEqual(await at(page), { eid: third.id, field: 'Tail', tag: 'INPUT' });
      assert.equal(await page.inputValue(`tr[data-eid="${third.id}"] td[data-field="Tail"] input`), 'q');
      await page.keyboard.press('Escape');
    } finally { await page.close(); }
  });

  test('open, ← and → belong to the caret', async () => {
    const page = await grid();
    try {
      await restOn(page, second.id, 'Note');
      await page.keyboard.press('Enter');
      await page.keyboard.press('ArrowLeft');
      assert.deepEqual(await at(page), { eid: second.id, field: 'Note', tag: 'INPUT' }, '← stayed in the cell');
      assert.equal(await page.evaluate(() => document.activeElement.selectionStart), 0, 'and moved the caret');
      await page.keyboard.press('ArrowRight');
      assert.deepEqual(await at(page), { eid: second.id, field: 'Note', tag: 'INPUT' }, '→ stayed too');
      await page.keyboard.press('Escape');
    } finally { await page.close(); }
  });

  test('Return commits down the column and the cursor survives the redraw', async () => {
    const page = await grid();
    try {
      await page.evaluate(() => { document.querySelector('#main tbody').dataset.mark = '1'; });
      await restOn(page, first.id, 'Note');
      await page.keyboard.press('Enter');
      await page.keyboard.type('A!');
      await page.keyboard.press('Enter');
      await settledOn(page, second.id, 'Note');
      assert.deepEqual(await at(page), { eid: second.id, field: 'Note', tag: 'TD' }, 'down one, at rest');
      await page.waitForFunction(() => !document.querySelector('#main tbody[data-mark]'), null, { timeout: 5000 });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      assert.deepEqual(await at(page), { eid: second.id, field: 'Note', tag: 'TD' }, 'still there after the grid rebuilt');
      assert.equal(await page.inputValue(`tr[data-eid="${first.id}"] td[data-field="Note"] input`), 'A!', 'the edit landed');
      // And the value is on the server, not only on the page.
      const saved = await page.evaluate(async (id) => (await (await fetch(`/api/entities/${id}`)).json()).fields.Note, first.id);
      assert.equal(saved, 'A!');
    } finally { await page.close(); }
  });

  test('Tab out of an open cell commits across; ⇧Tab walks back from where it landed', async () => {
    const page = await grid();
    try {
      await page.evaluate(() => { document.querySelector('#main tbody').dataset.mark = '1'; });
      await restOn(page, second.id, 'Note');
      await page.keyboard.press('Enter');
      await page.keyboard.type('!');
      await page.keyboard.press('Tab');
      await settledOn(page, second.id, 'Kind');
      assert.deepEqual(await at(page), { eid: second.id, field: 'Kind', tag: 'TD' }, 'across one, at rest');
      await page.waitForFunction(() => !document.querySelector('#main tbody[data-mark]'), null, { timeout: 5000 });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      assert.deepEqual(await at(page), { eid: second.id, field: 'Kind', tag: 'TD' }, 'the redraw put the cursor back');
      await page.keyboard.press('Shift+Tab');
      assert.deepEqual(await at(page), { eid: second.id, field: 'Note', tag: 'TD' });
    } finally { await page.close(); }
  });

  /* ── the other field types open on Return too ─────────────────────── */

  test('Return on a select cell opens its picker; Return on a checkbox flips it', async () => {
    const page = await grid();
    try {
      await restOn(page, second.id, 'Kind');
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('.chip-pop').count(), 1, 'the picker is up');
      await page.keyboard.press('Escape');
      await page.locator('.chip-pop').waitFor({ state: 'detached' });

      await page.evaluate(() => { document.querySelector('#main tbody').dataset.mark = '1'; });
      await restOn(page, second.id, 'Done');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.querySelector('#main tbody[data-mark]'), null, { timeout: 5000 });
      const done = await page.evaluate(async (id) => (await (await fetch(`/api/entities/${id}`)).json()).fields.Done, second.id);
      assert.equal(done, true, 'the box flipped and saved');
    } finally { await page.close(); }
  });

  /* ── selection from the keyboard ──────────────────────────────────── */

  test('Space picks the row up, ⇧↓ extends the run, ⌘A takes the table, Esc lets go', async () => {
    const page = await grid();
    try {
      await restOn(page, first.id, 'Note');
      await page.keyboard.press('Space');
      assert.deepEqual(await chosen(page), [first.id]);
      assert.deepEqual(await at(page), { eid: first.id, field: 'Note', tag: 'TD' }, 'Space did not open the cell');
      await page.keyboard.press('Shift+ArrowDown');
      assert.deepEqual(await chosen(page), [first.id, second.id], 'the run grew');
      assert.deepEqual(await at(page), { eid: second.id, field: 'Note', tag: 'TD' }, 'and the cursor went with it');
      await page.keyboard.press('Space');
      assert.deepEqual(await chosen(page), [first.id], 'Space toggles the row it is on');
      await page.keyboard.press('ControlOrMeta+a');
      assert.deepEqual(await chosen(page), [first.id, second.id, third.id]);
      await page.keyboard.press('Escape');
      assert.deepEqual(await chosen(page), []);
    } finally { await page.close(); }
  });

  test('open, Space is a space', async () => {
    const page = await grid();
    try {
      await restOn(page, third.id, 'Note');
      await page.keyboard.press('Enter');
      await page.keyboard.press('End');
      await page.keyboard.press('Space');
      assert.equal(await page.inputValue(`tr[data-eid="${third.id}"] td[data-field="Note"] input`), 'c ');
      assert.deepEqual(await chosen(page), [], 'nothing was selected');
      await page.keyboard.press('Escape');
    } finally { await page.close(); }
  });

  /* ── ⇧Return makes the next row; ⌘Return opens the record ─────────── */

  test('⇧Return creates a row and opens its first cell', async () => {
    const page = await grid();
    try {
      const before = await page.locator('.wv-grid tbody tr.entity-row').count();
      await restOn(page, third.id, 'Tail');
      await page.keyboard.press('Shift+Enter');
      await page.waitForFunction((n) => document.querySelectorAll('.wv-grid tbody tr.entity-row').length === n + 1, before, { timeout: 5000 });
      await page.waitForFunction(() => document.activeElement?.closest?.('tr[data-eid] > td[data-field="Name"] ') && document.activeElement.tagName === 'INPUT', null, { timeout: 3000 });
      const where = await at(page);
      assert.equal(where.field, 'Name');
      assert.equal(where.tag, 'INPUT', 'the new row is open on its name');
      assert.ok(![first.id, second.id, third.id].includes(where.eid), 'and it is a NEW row');
    } finally { await page.close(); }
  });

  test('⌘Return opens the record beside the table', async () => {
    const page = await grid();
    try {
      await restOn(page, second.id, 'Note');
      await page.keyboard.press('ControlOrMeta+Enter');
      await page.waitForSelector(`tr[data-eid="${second.id}"].row-docked`, { timeout: 3000 });
      assert.equal(await page.locator('.row-docked').count(), 1, 'the row is lit as docked');
    } finally { await page.close(); }
  });

  /* ── the pointer path is unchanged ────────────────────────────────── */

  test('a click still opens the cell it lands on, and hover arms it', async () => {
    const page = await grid();
    try {
      const cell = page.locator(`tr[data-eid="${second.id}"] td[data-field="Note"]`);
      const restBorder = await cell.locator('input').evaluate((n) => getComputedStyle(n).borderTopColor);
      await cell.hover();
      await page.waitForTimeout(300); // Tabler transitions the border in
      const armedBorder = await cell.locator('input').evaluate((n) => getComputedStyle(n).borderTopColor);
      assert.notEqual(armedBorder, restBorder, 'the control shows itself under the pointer');
      await cell.click();
      assert.deepEqual(await at(page), { eid: second.id, field: 'Note', tag: 'INPUT' });
    } finally { await page.close(); }
  });

  test('the resting cursor is drawn on the cell, in both themes', async () => {
    const page = await grid();
    try {
      for (const theme of ['light', 'dark']) {
        await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
        await restOn(page, second.id, 'Note');
        const shadow = await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow);
        assert.notEqual(shadow, 'none', `${theme}: the cell wears the cursor`);
      }
    } finally { await page.close(); }
  });
}
