/* Trash from the selection bar is instant and takes it back (Issue #259).

   The 2026-09-12 audit trashed a row from the floating bar by accident: the
   rows went at once, the toast said "Moved to trash 1 bug" with nothing to
   press, focus fell to <body>, and ⌘Z did nothing although POST /api/undo
   works. The rule this suite holds the page to is the one Linear and Notion
   teach: delete is instant, the toast carries Undo, and ⌘Z steps the last
   gesture back.

   Three things only a real page can show:
     1. the toast's Undo brings back EVERY row the gesture took, and the grid
        redraws with them, while the cursor lands on a row rather than <body>;
     2. ⌘Z on a resting cell does the same for the whole gesture;
     3. ⌘Z inside an open cell editor is the text box's own undo and never
        reaches /api/undo. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let bugs;
const s = await launch('trash undo', (weave) => {
  weave.createSpace({ name: 'Dev' });
  bugs = weave.createTable({ space: 'Dev', name: 'Bug' });
  for (const name of ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']) weave.createEntity(bugs, { name });
});
if (s) {
  const { base, browser, weave } = s;

  async function grid(theme) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.goto(`${base}/#/table/${bugs.id}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    return page;
  }
  const rowIds = (page) => page.$$eval('.wv-grid tbody tr.entity-row', (rs) => rs.map((r) => r.dataset.eid));
  const live = (id) => !weave.state.entities[id].deletedAt;
  const waitRows = (page, n) => page.waitForFunction(
    (k) => document.querySelectorAll('.wv-grid tbody tr.entity-row').length === k, n, { timeout: 5000 });

  // Tick the second and third drawn rows and press the bar's trash.
  async function trashTwo(page) {
    const before = await rowIds(page);
    const boxes = page.locator('.wv-grid tbody .sel-box');
    await boxes.nth(1).check();
    await boxes.nth(2).check();
    await page.locator('.sel-puck .sel-act.danger').click();
    await waitRows(page, before.length - 2);
    return { before, gone: before.slice(1, 3) };
  }

  for (const theme of ['light', 'dark']) {
    test(`the bar's trash toast carries Undo, and Undo brings back every row it took (${theme})`, async () => {
      const page = await grid(theme);
      try {
        const { before, gone } = await trashTwo(page);
        assert.ok(gone.every((id) => !live(id)), 'both rows went to the trash');
        const toast = page.locator('.wv-toast', { hasText: 'Moved to trash' }).last();
        await toast.waitFor();
        const undo = toast.locator('.wv-toast-action');
        assert.equal(await undo.count(), 1, 'the toast carries an action');
        assert.equal((await undo.textContent()).trim(), 'Undo');
        assert.ok(await undo.isVisible(), `the Undo button is visible in ${theme}`);

        /* The cursor lands on the row after the ones that left: the
           reader keeps a place in the grid rather than on <body>. */
        await page.waitForFunction(() => document.activeElement !== document.body, null, { timeout: 2000 }).catch(() => {});
        const focus = await page.evaluate(() => {
          const at = document.activeElement;
          return { body: at === document.body, eid: at?.closest?.('tr.entity-row')?.dataset.eid ?? null };
        });
        assert.equal(focus.body, false, 'focus did not fall to <body>');
        assert.equal(focus.eid, before[3], 'focus sits on the row after the trashed ones');

        await undo.click();
        await waitRows(page, before.length);
        assert.ok(gone.every(live), 'both rows are out of the trash');
        assert.deepEqual((await rowIds(page)).sort(), [...before].sort(), 'the grid redrew with the rows back');
      } finally { await page.close(); }
    });
  }

  /* The undo stack is the workspace's, not the page's. A write that lands
     between the trash and the click (another tab, an agent) sits on top of
     the trash's entries, and stepping back two would undo that write and
     only one of the rows. */
  test('Undo after somebody else\'s write brings the rows back and leaves that write alone', async () => {
    const page = await grid('light');
    try {
      const { before, gone } = await trashTwo(page);
      const toast = page.locator('.wv-toast', { hasText: 'Moved to trash' }).last();
      await toast.waitFor();
      weave.updateEntity(before[0], { name: 'Written meanwhile' });
      await toast.locator('.wv-toast-action').click();
      await waitRows(page, before.length);
      assert.ok(gone.every(live), 'both rows are out of the trash');
      assert.equal(weave.entityName(weave.state.entities[before[0]]), 'Written meanwhile', 'the later write stands');
    } finally { await page.close(); }
  });

  test('⌘Z on a resting cell steps the whole trash gesture back', async () => {
    const page = await grid('light');
    try {
      const { before, gone } = await trashTwo(page);
      assert.ok(gone.every((id) => !live(id)));
      // The trash left the cursor on a resting cell; ⌘Z is pressed there.
      await page.locator(`.wv-grid tr[data-eid="${before[3]}"] > td[data-field]`).first().focus();
      await page.keyboard.press('Meta+z');
      await waitRows(page, before.length);
      assert.ok(gone.every(live), 'one ⌘Z brought back both rows the gesture took');
    } finally { await page.close(); }
  });

  test('⌘Z inside an open cell editor is the text box\'s own undo and never calls /api/undo', async () => {
    const page = await grid('light');
    try {
      const calls = [];
      page.on('request', (r) => { if (/\/api\/undo$/.test(new URL(r.url()).pathname)) calls.push(r.method()); });
      const rows = await rowIds(page);
      await page.locator(`.wv-grid tr[data-eid="${rows[0]}"] td.name-cell`).click();
      const input = page.locator(`.wv-grid tr[data-eid="${rows[0]}"] td.name-cell :is(input, textarea)`);
      await input.waitFor();
      await page.keyboard.type('xyz');
      await page.keyboard.press('Meta+z');
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(300);
      assert.deepEqual(calls, [], 'no undo request left the page');
      assert.equal(await page.locator('.wv-grid tbody tr.entity-row').count(), rows.length, 'no row moved');
    } finally { await page.close(); }
  });
}
