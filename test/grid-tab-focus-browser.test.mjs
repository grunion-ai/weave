/* Tab carries on from the row you are on (Issue #83).

   Editing a cell and tabbing out fires `change`, which PATCHes and then
   redraws the whole grid. The redraw lands a beat AFTER Tab has already put
   focus on the next cell, so it tore that cell's input out of the document
   and dropped focus on <body> — and the next Tab restarted at the top of the
   page instead of continuing along the row.

   Since Feature #134 (cells rest as values) Tab out of an open cell commits
   it and lands the resting cursor on the NEXT CELL — the <td> is the focus
   stop, its control is not — so what the redraw has to put back is the
   cell, not a control inside it. The shape of the bug is the same.

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

  /* Where the cursor is once it is in a grid cell at all.

     Tab's own claim must not wait on the redraw: whether the keystroke or the
     rebuild wins the frame is not the contract, landing on the right cell is.
     This returns as soon as focus is inside a row, from whichever side of the
     redraw it catches, and names the cell so a failure still reads as a diff. */
  const cursorInGrid = (page) => page.waitForFunction(() => {
    const td = document.activeElement?.closest?.('tr[data-eid] > td');
    if (!td) return false;
    return { eid: td.parentElement.dataset.eid, field: td.dataset.field ?? null, tag: document.activeElement.tagName };
  }).then((h) => h.jsonValue());

  /* The cursor after the round trip, read in the SAME evaluate that waited
     for it (Issue #199).

     A wait and a separate read are two round trips with a frame between them,
     and that is the frame a redraw lands in: replacing the <tbody> drops
     focus on <body> until `restoreGridFocus` puts it back, so a read arriving
     there sees BODY on a grid that is behaving correctly. Waiting for the
     LAST step — the commit has settled AND the cursor is in a cell — and
     reporting that cell from inside the wait closes the window. Which cell it
     is stays the assertion, so this is still a test and not a tautology.

     "Settled" is the write coming back. Since Issue #257 a commit whose field
     cannot move the row does not redraw at all — it swaps that row's cells
     where they stand — so a marked <tbody> being replaced is no longer a
     signal that arrives on every path; the PATCH landing is. `landed` is
     registered BEFORE the gesture, so the wait cannot miss it.

     No cap of its own, so it falls back on Playwright's 30 s default: under
     the full gate this suite has taken 52 s (review-logs/227-1) and 27 s
     (282-1) while every wait in it was capped at 5 s. A hand-written budget
     on a client round trip is how a green change gets voted Verified −1 —
     wait on the signal, and let the default catch a grid that never puts the
     cursor back at all (Issue #216). */
  const commitLands = (page) => page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/api\/entities\//.test(r.url()));
  const settledFocus = async (page, landed) => {
    await landed;
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    return page.waitForFunction(() => {
      const td = document.activeElement?.closest?.('tr[data-eid] > td');
      if (!td) return false; // the grid has not put the cursor back yet
      return { eid: td.parentElement.dataset.eid, field: td.dataset.field ?? null, tag: document.activeElement.tagName };
    }).then((h) => h.jsonValue());
  };

  test('a redraw triggered by an edit leaves focus on the row the reader tabbed into', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${rows.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`tr[data-eid="${second.id}"] td[data-field="Note"] input`);

    // Edit the middle row's Note, then Tab — the gesture in the report.
    await page.click(`tr[data-eid="${second.id}"] td[data-field="Note"] input`);
    await page.keyboard.press('ArrowRight');   // the click selects the value (Feature #221); → collapses it to the end
    await page.keyboard.type('!');
    const landed = commitLands(page);
    await page.keyboard.press('Tab');

    // Tab lands the resting cursor on Tail of the same row.
    assert.deepEqual(await cursorInGrid(page), { eid: second.id, field: 'Tail', tag: 'TD' },
      'Tab moves along the row');

    // ...and it is still there after the grid rebuilds itself underneath.
    assert.deepEqual(await settledFocus(page, landed), { eid: second.id, field: 'Tail', tag: 'TD' },
      'the redraw puts focus back on the cell Tab had reached');

    /* Which is what makes the NEXT Tab continue along the row instead of
       restarting at the top of the page. Read, not waited for, and that is the
       point: Tab out of a RESTING cell writes nothing, so no redraw is in
       flight and focus has already moved when the key returns. Waiting here
       would hide a cursor that never moved behind a wait that never ends —
       wait where there is a round trip, read where there is none. */
    await page.keyboard.press('Tab');
    assert.deepEqual(await focusedCell(page), { eid: second.id, field: 'Extra', tag: 'TD' },
      'the next Tab carries on along the same row');

    // Backwards walks from the same place, for the same reason.
    await page.keyboard.press('Shift+Tab');
    assert.deepEqual(await focusedCell(page), { eid: second.id, field: 'Tail', tag: 'TD' },
      'Shift-Tab walks back from the same cell');

    await page.close();
  });

  test('a cell that rests as a span, not a form control, is restored too', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${rows.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`tr[data-eid="${second.id}"] td[data-field="Name"] input`);

    // Description follows Name, and it rests as a preview span rather than a
    // form control — the very column the report was tabbing into. Restoring
    // only `button,input,select` put focus on <body> here even with the cell
    // correctly remembered.
    await page.click(`tr[data-eid="${second.id}"] td[data-field="Name"] input`);
    await page.keyboard.press('ArrowRight');   // the click selects the value (Feature #221); → collapses it to the end
    await page.keyboard.type('!');
    const landed = commitLands(page);
    await page.keyboard.press('Tab');
    assert.deepEqual(await cursorInGrid(page), { eid: second.id, field: 'Description', tag: 'TD' },
      'Tab reaches the description cell');

    assert.deepEqual(await settledFocus(page, landed), { eid: second.id, field: 'Description', tag: 'TD' },
      'the redraw puts focus back on the cell the reader tabbed into');

    await page.close();
  });

  /* The round trip is a signal, not a budget (Issue #199). Under the full
     gate this suite has taken 52 s (review-logs/227-1) and 27 s (282-1) while
     every wait inside it was capped at 5 s — close enough that the clock
     alone could vote a green change Verified −1. Hold the redraw's own query
     open past that old cap: the cursor still has to come back to the cell Tab
     reached, however long the grid took to rebuild. */
  test('the cursor comes back however long the redraw takes', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${rows.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`tr[data-eid="${second.id}"] td[data-field="Note"] input`);

    /* The commit's own round trip is held. Since Issue #257 a Note commit
       does not re-read the table at all, so the write itself is what a slow
       network delays — and the cursor still has to be on the cell Tab
       reached when it lands. */
    await page.route('**/api/entities/*', async (route) => {
      await new Promise((r) => { setTimeout(r, 5500); });
      await route.continue();
    });

    await page.click(`tr[data-eid="${second.id}"] td[data-field="Note"] input`);
    await page.keyboard.press('ArrowRight');   // the click selects the value (Feature #221); → collapses it to the end
    await page.keyboard.type('!');
    const landed = commitLands(page);
    await page.keyboard.press('Tab');

    // 5.5 s: longer than the 5 s cap these waits used to carry, so this case
    // is red on the budget and green on the signal.
    assert.deepEqual(await settledFocus(page, landed), { eid: second.id, field: 'Tail', tag: 'TD' },
      'the cursor is back on the cell Tab reached, 5.5 s after the edit');

    await page.close();
  });
}
