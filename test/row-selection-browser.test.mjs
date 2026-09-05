/* Row selection in the grid (Feature #132, slice 1) — the half only a browser
   can judge. The five-bars mockup settled the shape on 2026-08-24 and the
   Puck won; this is the selection underneath every one of the five.

   Four things the source can lie about and a real page cannot:
     1. the checkbox column sits to the LEFT of the # link, so the link never
        disappears while a selection is live. That is a geometry claim.
     2. the column is quiet until you aim at it — no box at rest, a box on
        hover, and every box visible once a selection exists.
     3. Ledger's one rule still holds: a bare cell click raises that cell's
        editor. Clicking the checkbox must NOT open an editor, and clicking a
        cell must NOT change the selection. The two gestures share a row.
     4. the selection survives a redraw (a sort re-orders every row) because
        it is keyed on entity id, and drops rows that leave the page.

   Playwright is NOT a dependency of weave (house rule: zero runtime deps).
   It is imported dynamically and the suite skips when it is absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tasks, people, ids = [], ann;
const s = await launch('row selection', (weave) => {
  weave.createSpace({ name: 'Product' });
  people = weave.createTable({ space: 'Product', name: 'Person' });
  tasks = weave.createTable({ space: 'Product', name: 'Task' });
  weave.addField(tasks, { name: 'Estimate', type: 'number' });
  weave.addField(tasks, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true }, { name: 'Done', category: 'done' }] } });
  weave.addRelation(tasks, { name: 'Owner', targetDb: people, cardinality: 'many-to-one', inverseName: 'Tasks' });
  ann = weave.createEntity(people, { name: 'Ann' });
  weave.createEntity(people, { name: 'Bob' });
  // Five rows, named so a sort re-orders them against insertion order —
  // that is what proves the selection is keyed on id and not on position.
  for (const [name, est] of [['Echo', 5], ['Delta', 4], ['Charlie', 3], ['Bravo', 2], ['Alpha', 1]]) {
    ids.push(weave.createEntity(tasks, { name, values: { Estimate: est } }).id);
  }
});
if (s) {
  const { base, browser } = s;

  async function grid() {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    return page;
  }

  const boxes = (page) => page.locator('.wv-grid tbody .sel-box');

  /* ── 1 · the column is left of the # link ───────────────────────────── */
  test('the checkbox sits left of the # link, in both the head and the row', async () => {
    const page = await grid();
    try {
      const geo = await page.evaluate(() => {
        const row = document.querySelector('.wv-grid tbody tr.entity-row');
        const head = document.querySelector('.wv-grid thead tr');
        const r = (n) => n.getBoundingClientRect();
        return {
          rowSel: r(row.querySelector('.sel-cell')).left,
          rowPid: r(row.querySelector('.pid-cell')).left,
          headSel: r(head.querySelector('.sel-head')).left,
          headPid: r(head.querySelector('.pid-head')).left,
          // The # link is the thing that must never be displaced.
          linkVisible: !!row.querySelector('.pid-cell .open-link')?.offsetParent,
        };
      });
      assert.ok(geo.rowSel < geo.rowPid, 'the row checkbox is left of #');
      assert.ok(geo.headSel < geo.headPid, 'the header checkbox is left of #');
      assert.ok(geo.linkVisible, 'the # link is still on the page');
    } finally { await page.close(); }
  });

  /* ── 2 · quiet at rest, present on hover, present once a selection lives ── */
  test('the column is invisible at rest and shows itself on hover', async () => {
    const page = await grid();
    try {
      const opacity = () => page.evaluate(() =>
        getComputedStyle(document.querySelector('.wv-grid tbody .sel-box')).opacity);
      assert.equal(await opacity(), '0', 'nothing is drawn until you aim at it');
      await page.locator('.wv-grid tbody tr.entity-row').first().hover();
      // The reveal is a .12s fade, so this waits for it to land rather than
      // reading a frame mid-transition. It still fails if it never arrives.
      await page.waitForFunction(() =>
        getComputedStyle(document.querySelector('.wv-grid tbody .sel-box')).opacity === '1',
        null, { timeout: 2000 });
      assert.equal(await opacity(), '1', 'hovering the row reveals its box');
    } finally { await page.close(); }
  });

  test('once a row is chosen every box is visible, so the column can be worked', async () => {
    const page = await grid();
    try {
      await boxes(page).nth(2).check();
      // Move the pointer away: the boxes must stay because a selection is
      // live, not because the mouse happens to be over a row.
      await page.mouse.move(5, 5);
      await page.waitForFunction(() =>
        [...document.querySelectorAll('.wv-grid tbody .sel-box')]
          .every((b) => getComputedStyle(b).opacity === '1'),
        null, { timeout: 2000 }).catch(() => {});
      const all = await page.evaluate(() =>
        [...document.querySelectorAll('.wv-grid tbody .sel-box')]
          .every((b) => getComputedStyle(b).opacity === '1'));
      assert.ok(all, 'a live selection lights the whole column');
    } finally { await page.close(); }
  });

  /* ── 3 · selection and editing share a row without fighting ─────────── */
  test('checking a row opens no editor, and clicking a cell changes no selection', async () => {
    const page = await grid();
    try {
      await boxes(page).first().check();
      assert.equal(await page.locator('.wv-grid tbody td .cell-editing, .wv-grid input:focus:not(.sel-box)').count(), 0,
        'the checkbox is not a cell click');
      // Ledger's rule: a bare cell click raises that field's editor. It must
      // leave the selection exactly as it was.
      await page.locator('.wv-grid tbody tr.entity-row').nth(3).locator('td.name-cell').click();
      assert.equal(await page.locator('.wv-grid tbody .sel-box:checked').count(), 1,
        'editing a different row did not select it');
    } finally { await page.close(); }
  });

  /* ── 4 · the header box reads none / some / all ─────────────────────── */
  test('the header box goes indeterminate on a partial selection and clears everything on a second click', async () => {
    const page = await grid();
    try {
      const head = page.locator('.wv-grid thead .sel-box');
      await boxes(page).nth(1).check();
      assert.ok(await head.evaluate((b) => b.indeterminate), 'some rows chosen reads as a dash');
      await head.click();                                   // -> all
      assert.equal(await page.locator('.wv-grid tbody .sel-box:checked').count(), 5);
      assert.ok(await head.evaluate((b) => b.checked && !b.indeterminate));
      await head.click();                                   // -> none
      assert.equal(await page.locator('.wv-grid tbody .sel-box:checked').count(), 0);
    } finally { await page.close(); }
  });

  /* ── 5 · shift extends from the last box hit ────────────────────────── */
  test('shift-clicking a box takes the whole span between it and the last one', async () => {
    const page = await grid();
    try {
      await boxes(page).nth(1).check();
      await boxes(page).nth(3).click({ modifiers: ['Shift'] });
      assert.equal(await page.locator('.wv-grid tbody .sel-box:checked').count(), 3,
        'rows 2 through 4 inclusive');
    } finally { await page.close(); }
  });

  /* ── 6 · a redraw keeps the rows, not the positions ─────────────────── */
  test('a sort re-orders the grid and the same rows stay chosen', async () => {
    const page = await grid();
    try {
      const chosen = () => page.evaluate(() =>
        [...document.querySelectorAll('.wv-grid tbody .sel-box:checked')]
          .map((b) => b.closest('tr').dataset.eid).sort());
      await boxes(page).nth(0).check();
      await boxes(page).nth(1).check();
      const before = await chosen();
      // Sorting redraws every row from scratch. A selection keyed on index
      // would move onto different records here without saying so.
      await page.locator('.wv-grid thead .col-head').first().locator('.field-menu').click();
      await page.locator('.chip-pop .chip-pop-row', { hasText: 'Sort descending' }).click();
      await page.waitForTimeout(120);
      assert.deepEqual(await chosen(), before, 'the same entity ids survive the sort');
    } finally { await page.close(); }
  });

  /* ── 7 · Escape is the way out ──────────────────────────────────────── */
  test('Escape clears the selection', async () => {
    const page = await grid();
    try {
      await boxes(page).nth(0).check();
      await boxes(page).nth(2).check();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.wv-grid tbody .sel-box:checked').count(), 0);
    } finally { await page.close(); }
  });

  test('Escape aimed at a dialog closes the dialog and leaves the selection alone', async () => {
    // The guard used to look for .tray-back and .modal-back as classes; the
    // backdrops only ever carry ids, so the guard never matched and the
    // keystroke that closed the tray also emptied the selection under it.
    const page = await grid();
    try {
      await boxes(page).nth(1).check();
      await page.click('.add-field-btn');
      await page.waitForSelector('#tray-back');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('#tray-back'), null, { timeout: 2000 });
      assert.equal(await page.locator('.wv-grid tbody .sel-box:checked').count(), 1,
        'the tray took the Escape; the row stays chosen');
    } finally { await page.close(); }
  });

  /* ── the puck (slice 2) ─────────────────────────────────────────────── */
  test('there is no bar until a row is chosen, and none left once it is cleared', async () => {
    const page = await grid();
    try {
      assert.equal(await page.locator('.sel-puck').count(), 0, 'an idle grid carries no bar');
      await boxes(page).nth(0).check();
      await page.waitForSelector('.sel-puck');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.sel-puck'), null, { timeout: 2000 });
      assert.equal(await page.locator('.sel-puck').count(), 0);
    } finally { await page.close(); }
  });

  test('the count says what the bar holds, and follows the selection', async () => {
    const page = await grid();
    try {
      await boxes(page).nth(0).check();
      assert.equal((await page.locator('.sel-count').textContent()).trim(), '1 record');
      await boxes(page).nth(2).click({ modifiers: ['Shift'] });
      assert.equal((await page.locator('.sel-count').textContent()).trim(), '3 records');
    } finally { await page.close(); }
  });

  test('the bar carries only built commands — no dead icons', async () => {
    const page = await grid();
    try {
      await boxes(page).nth(0).check();
      const labels = await page.locator('.sel-puck .sel-act').evaluateAll(
        (bs) => bs.map((b) => b.getAttribute('aria-label')));
      assert.deepEqual(labels, ['Set a field…', 'Link to…', 'Duplicate', 'More', 'Move to trash'],
        'slice 3: the full designed set is built');
      // Trash is past a hairline, and it is the only one wearing danger.
      assert.equal(await page.locator('.sel-puck .sel-sep').count(), 1);
      assert.equal(await page.locator('.sel-puck .sel-act.danger').count(), 1);
    } finally { await page.close(); }
  });

  test('the grid grows a floor while the bar is up, so it never covers the last row', async () => {
    const page = await grid();
    try {
      const lastRowBottom = () => page.evaluate(() => {
        const rows = [...document.querySelectorAll('.wv-grid tbody tr.entity-row')];
        return rows.at(-1).getBoundingClientRect().bottom;
      });
      await boxes(page).nth(0).check();
      await page.waitForSelector('.sel-puck');
      const gap = await page.evaluate((bottom) => {
        const puck = document.querySelector('.sel-puck').getBoundingClientRect();
        return puck.top - bottom;
      }, await lastRowBottom());
      assert.ok(gap > 0, `the bar clears the last row (overlap of ${-gap}px)`);
    } finally { await page.close(); }
  });

  test('Duplicate copies the chosen rows and leaves the selection empty', async () => {
    const page = await grid();
    try {
      const count = () => page.locator('.wv-grid tbody tr.entity-row').count();
      const before = await count();
      await boxes(page).nth(0).check();
      await page.locator('.sel-puck .sel-act[aria-label="Duplicate"]').click();
      await page.waitForFunction((n) =>
        document.querySelectorAll('.wv-grid tbody tr.entity-row').length === n + 1,
        before, { timeout: 4000 });
      assert.equal(await count(), before + 1);
      assert.equal(await page.locator('.sel-puck').count(), 0, 'the bar goes with the selection');
    } finally { await page.close(); }
  });

  /* ── the commands (slice 3) ─────────────────────────────────────────── */
  const act = (page, label) => page.locator(`.sel-puck .sel-act[aria-label="${label}"]`);
  const pickRow = (page, text) => page.locator('.picker-pop .picker-row', { hasText: text }).first().click();

  test('Set a field… walks field → value and writes one state across the selection', async () => {
    const page = await grid();
    try {
      await boxes(page).nth(0).check();
      await boxes(page).nth(1).check();
      await act(page, 'Set a field…').click();
      // Step one is the field list, search-first (Feature #100), and it
      // offers no relation, no computed field.
      await page.waitForSelector('.picker-pop .picker-search:focus');
      const fields = await page.locator('.picker-pop .picker-row .picker-label').allTextContents();
      assert.deepEqual(fields, ['Name', 'Estimate', 'Status'], 'Owner is a relation: Link to…\'s, not here');
      await pickRow(page, 'Status');
      // Step two: the state chips.
      await page.waitForSelector('.picker-pop .picker-search:focus');
      await pickRow(page, 'Done');
      await page.waitForFunction(() =>
        document.querySelectorAll('.wv-grid tbody tr.entity-row td[data-field="Status"] button')
          .length && !document.querySelector('.sel-puck'), null, { timeout: 4000 });
      const states = await page.locator('.wv-grid tbody tr.entity-row td[data-field="Status"] button').allTextContents();
      assert.equal(states.filter((t) => /Done/.test(t)).length, 2, 'both chosen rows are Done, the rest untouched');
      assert.equal(await page.locator('.sel-puck').count(), 0, 'the bar goes with the selection');
    } finally { await page.close(); }
  });

  test('Set a field… on a number takes a typed value and applies it on Return', async () => {
    const page = await grid();
    try {
      await boxes(page).nth(2).check();
      await act(page, 'Set a field…').click();
      await pickRow(page, 'Estimate');
      const input = page.locator('.value-pop input');
      await input.waitFor();
      assert.ok(await input.evaluate((n) => n === document.activeElement), 'the cursor is already in the box');
      await input.fill('42');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.querySelector('.sel-puck'), null, { timeout: 4000 });
      // A number rests as its input, so the value is read off the control.
      const cells = await page.locator('.wv-grid tbody tr.entity-row td[data-field="Estimate"] input').evaluateAll((ns) => ns.map((n) => n.value));
      assert.equal(cells.filter((t) => t === '42').length, 1);
    } finally { await page.close(); }
  });

  test('Link to… walks relation → target and connects every chosen row', async () => {
    const page = await grid();
    try {
      await boxes(page).nth(3).check();
      await boxes(page).nth(4).check();
      await act(page, 'Link to…').click();
      await page.waitForSelector('.picker-pop .picker-search:focus');
      await pickRow(page, 'Owner');
      // The target step searches the far table.
      await page.waitForSelector('.picker-pop .picker-search:focus');
      await page.keyboard.type('an');
      await pickRow(page, 'Ann');
      await page.waitForFunction(() => !document.querySelector('.sel-puck'), null, { timeout: 4000 });
      const owners = await page.locator('.wv-grid tbody tr.entity-row td[data-field="Owner"]').allTextContents();
      assert.equal(owners.filter((t) => /Ann/.test(t)).length, 2);
    } finally { await page.close(); }
  });

  test('Escape closes a puck picker and leaves the selection alone', async () => {
    // The picker removed itself on Escape and the same keystroke then reached
    // the grid's listener, which saw no popover and emptied the selection.
    const page = await grid();
    try {
      await boxes(page).nth(0).check();
      await act(page, 'Set a field…').click();
      await page.waitForSelector('.picker-pop .picker-search:focus');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.picker-pop'), null, { timeout: 2000 });
      assert.equal(await page.locator('.wv-grid tbody .sel-box:checked').count(), 1, 'the picker took the Escape');
      await act(page, 'Set a field…').click();
      await pickRow(page, 'Estimate');
      await page.locator('.value-pop input').waitFor();
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.value-pop'), null, { timeout: 2000 });
      assert.equal(await page.locator('.wv-grid tbody .sel-box:checked').count(), 1, 'so did the value box');
    } finally { await page.close(); }
  });

  test('⋯ opens the overflow: Move to table…, Roll up…, Copy links', async () => {
    const page = await grid();
    try {
      await boxes(page).nth(0).check();
      await act(page, 'More').click();
      await page.waitForSelector('.picker-pop .picker-search:focus');
      const rows = (await page.locator('.picker-pop .picker-row .picker-label').allTextContents()).map((t) => t.trim());
      assert.deepEqual(rows, ['Move to table…', 'Roll up into a new record…', 'Copy links']);
    } finally { await page.close(); }
  });

  test('Copy links puts one permalink per chosen row on the clipboard', async () => {
    const page = await grid();
    try {
      await page.evaluate(() => {
        window.__copied = null;
        navigator.clipboard.writeText = async (t) => { window.__copied = t; };
      });
      await boxes(page).nth(0).check();
      await boxes(page).nth(1).check();
      await act(page, 'More').click();
      await pickRow(page, 'Copy links');
      await page.waitForFunction(() => window.__copied != null, null, { timeout: 4000 });
      const lines = (await page.evaluate(() => window.__copied)).split('\n');
      assert.equal(lines.length, 2);
      assert.ok(lines.every((l) => /^http:\/\/127\.0\.0\.1:\d+\/e\/[0-9a-f-]{36}$/.test(l)), `permalinks: ${lines.join(' ')}`);
      assert.equal(await page.locator('.sel-puck').count(), 1, 'copying does not spend the selection');
    } finally { await page.close(); }
  });

  test('Roll up… creates one parent in the relation\'s table and links the selection to it', async () => {
    const page = await grid();
    try {
      await boxes(page).nth(0).check();
      await boxes(page).nth(1).check();
      await act(page, 'More').click();
      await pickRow(page, 'Roll up');
      await page.waitForSelector('.picker-pop .picker-search:focus');
      await pickRow(page, 'Owner');
      const input = page.locator('.value-pop input');
      await input.waitFor();
      await input.fill('Carol');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.querySelector('.sel-puck'), null, { timeout: 4000 });
      const owners = await page.locator('.wv-grid tbody tr.entity-row td[data-field="Owner"]').allTextContents();
      assert.equal(owners.filter((t) => /Carol/.test(t)).length, 2);
    } finally { await page.close(); }
  });

  test('Move to table… re-homes the rows and they leave this grid', async () => {
    const page = await grid();
    try {
      const count = () => page.locator('.wv-grid tbody tr.entity-row').count();
      const before = await count();
      await boxes(page).nth(0).check();
      await act(page, 'More').click();
      await pickRow(page, 'Move to table');
      await page.waitForSelector('.picker-pop .picker-search:focus');
      const tables = await page.locator('.picker-pop .picker-row .picker-label').allTextContents();
      assert.ok(tables.includes('Person') && !tables.includes('Task'), `other tables only: ${tables}`);
      await pickRow(page, 'Person');
      await page.waitForFunction((n) =>
        document.querySelectorAll('.wv-grid tbody tr.entity-row').length === n - 1, before, { timeout: 4000 });
      assert.equal(await count(), before - 1);
    } finally { await page.close(); }
  });

  /* ── Issue #161 · the bar is fixed to the viewport, not the table ───── */
  test('the bar sits at the bottom centre of the viewport even when the table runs off it', async () => {
    const page = await browser.newPage({ viewport: { width: 1100, height: 260 } });
    try {
      await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      await boxes(page).nth(0).check();
      await page.waitForSelector('.sel-puck');
      // Let the 14px rise land before measuring where the bar rests.
      await page.locator('.sel-puck').evaluate((n) => Promise.all(n.getAnimations().map((a) => a.finished)));
      const geo = await page.evaluate(() => {
        const p = document.querySelector('.sel-puck').getBoundingClientRect();
        const last = [...document.querySelectorAll('.wv-grid tbody tr.entity-row')].at(-1).getBoundingClientRect();
        return { bottom: p.bottom, cx: (p.left + p.right) / 2, w: innerWidth, h: innerHeight, lastBottom: last.bottom };
      });
      assert.ok(geo.lastBottom > geo.h, 'the table runs past the viewport');
      assert.ok(geo.h - geo.bottom >= 8 && geo.h - geo.bottom <= 24, `the bar hugs the viewport bottom (${geo.h - geo.bottom}px)`);
      assert.ok(Math.abs(geo.cx - geo.w / 2) < 2, `the bar is centred on the viewport (${geo.cx} vs ${geo.w / 2})`);
    } finally { await page.close(); }
  });

  /* ── 8 · the add-a-row line is not a row ────────────────────────────── */
  test('the "+ New" line carries no checkbox', async () => {
    const page = await grid();
    try {
      assert.equal(await page.locator('.wv-grid tbody tr.add-entity-row .sel-box').count(), 0);
      // And it still spans the full grid now that a column has been added —
      // a colspan left at the old count would leave a gap at the bottom.
      const spans = await page.evaluate(() => {
        const add = document.querySelector('.wv-grid tbody tr.add-entity-row td');
        return { colspan: Number(add.getAttribute('colspan')),
                 heads: document.querySelectorAll('.wv-grid thead th').length };
      });
      assert.equal(spans.colspan, spans.heads, 'the add row spans every column');
    } finally { await page.close(); }
  });
}
