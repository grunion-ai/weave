/* Grid ranges, fill and paste against a real page (Feature #220).

   The arithmetic is pinned in test/grid-range.test.mjs and the keystrokes in
   test/grid-keymap.test.mjs. What this suite proves is the gestures: that a
   drag across cells draws a rectangle without opening the editor Ledger's
   rule gives a plain click, that the corner handle fills, that ⌘C and ⌘V
   carry TYPED values through the system clipboard, that a formula column
   refuses by name, and that one Undo on the toast steps a whole fill back.

   Every write here goes through `POST /api/bulk` — the same verb the puck
   uses (Feature #132) — so what is being tested is the gesture layer, never
   a second write path.

   Playwright is NOT a dependency of weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let rows, ids;
const s = await launch('grid ranges', (weave) => {
  weave.createSpace({ name: 'Ledger' });
  rows = weave.createTable({ space: 'Ledger', name: 'Rows' });
  weave.addField(rows, { name: 'Note', type: 'text' });
  weave.addField(rows, { name: 'Kind', type: 'select', config: { options: ['bug', 'chore', 'epic'] } });
  weave.addField(rows, { name: 'Tags', type: 'multiselect', config: { options: ['red', 'blue', 'green'] } });
  weave.addField(rows, { name: 'Score', type: 'number' });
  weave.addField(rows, { name: 'Double', type: 'formula', config: { expression: 'Score * 2' } });
  // Twenty rows, so the Verify list's "fill down 20" is the real thing.
  ids = Array.from({ length: 20 }, (_, i) =>
    weave.createEntity(rows, { name: `r${i}`, values: { Note: `n${i}`, Score: i } }).id);
  weave.updateEntity(ids[0], { Kind: 'bug', Tags: ['red', 'blue'] });
  return { rows, ids };
});

if (s) {
  const { base, browser, weave } = s;

  const grid = async () => {
    // Tall enough that all twenty rows are on screen: a fill drag is a real
    // pointer travelling to a real cell, and it cannot travel off the page.
    const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 1280, height: 1500 } });
    const page = await ctx.newPage();
    await page.goto(`${base}/#/table/${s.rows.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`tr[data-eid="${s.ids[0]}"] td[data-field="Kind"]`);
    await page.waitForTimeout(200);
    return { ctx, page };
  };
  const sel = (i, field) => `tr[data-eid="${s.ids[i]}"] td[data-field="${field}"]`;
  // The rectangle the page is painting, as row indices and field names.
  const painted = (page) => page.evaluate(() => [...document.querySelectorAll('.wv-grid td.wv-in-range')]
    .map((td) => `${td.parentElement.dataset.eid}:${td.dataset.field}`));
  const toastText = (page) => page.locator('#wv-toasts .wv-toast').first().innerText();
  // Reads the ENGINE, not the page: what actually landed in the workspace.
  const value = (i, field) => weave.readEntity(s.ids[i]).fields[field];
  const raw = (i, field) => weave.readEntity(s.ids[i]).raw[field];
  const reset = () => {
    for (let i = 0; i < 20; i++) weave.updateEntity(s.ids[i], { Kind: i === 0 ? 'bug' : null, Tags: i === 0 ? ['red', 'blue'] : [], Note: `n${i}`, Score: i });
  };

  /* ── the range ────────────────────────────────────────────────────── */

  test('⇧-arrows grow a range of cells from the resting cursor', async () => {
    const { ctx, page } = await grid();
    try {
      await page.focus(sel(0, 'Note'));
      await page.keyboard.press('Shift+ArrowDown');
      await page.keyboard.press('Shift+ArrowRight');
      assert.deepEqual(await painted(page), [
        `${s.ids[0]}:Note`, `${s.ids[0]}:Kind`,
        `${s.ids[1]}:Note`, `${s.ids[1]}:Kind`,
      ], 'a 2×2 rectangle, and the cursor is at its far corner');
      // A bare arrow is the cursor leaving the rectangle it cornered.
      await page.keyboard.press('ArrowDown');
      assert.deepEqual(await painted(page), []);
    } finally { await ctx.close(); }
  });

  test('Space still picks the ROW up, and ⇧↑↓ still extend that run (Feature #134)', async () => {
    const { ctx, page } = await grid();
    try {
      await page.focus(sel(1, 'Note'));
      await page.keyboard.press(' ');
      await page.keyboard.press('Shift+ArrowDown');
      const chosen = await page.evaluate(() => [...document.querySelectorAll('tr.row-selected')].map((r) => r.dataset.eid));
      assert.deepEqual(chosen, [s.ids[1], s.ids[2]], 'the row run, exactly as before');
      assert.deepEqual(await painted(page), [], 'and no cell range came up under it');
    } finally { await ctx.close(); }
  });

  test('a drag across cells draws a range and does NOT open the cell a click would', async () => {
    const { ctx, page } = await grid();
    try {
      const a = await page.locator(sel(1, 'Note')).boundingBox();
      const b = await page.locator(sel(3, 'Kind')).boundingBox();
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
      await page.mouse.up();
      const cells = await painted(page);
      assert.equal(cells.length, 6, 'three rows by two columns');
      assert.ok(cells.includes(`${s.ids[3]}:Kind`));
      const open = await page.evaluate(() => document.activeElement?.tagName);
      assert.equal(open, 'TD', 'the drag took the cursor out of the editor a plain click would have opened');
    } finally { await ctx.close(); }
  });

  test('Esc lets the range go, and lets the rows go first when both are up', async () => {
    const { ctx, page } = await grid();
    try {
      await page.focus(sel(0, 'Note'));
      await page.keyboard.press('Shift+ArrowDown');
      await page.keyboard.press('Escape');
      assert.deepEqual(await painted(page), []);
    } finally { await ctx.close(); }
  });

  /* ── the fill handle ──────────────────────────────────────────────── */

  test('a fill of a select column down 20 rows writes 20 identical option ids, and ONE Undo takes it back', async () => {
    reset();
    const { ctx, page } = await grid();
    try {
      await page.focus(sel(0, 'Kind'));
      const handle = await page.locator(`${sel(0, 'Kind')} .wv-fill-handle`).boundingBox();
      assert.ok(handle, 'the resting cell wears the handle — a fill needs no range first');
      const last = await page.locator(sel(19, 'Kind')).boundingBox();
      await page.mouse.move(handle.x + 3, handle.y + 3);
      await page.mouse.down();
      await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2, { steps: 20 });
      await page.mouse.up();
      await page.waitForSelector('#wv-toasts .wv-toast');
      assert.match(await toastText(page), /Filled 20 cells/);
      const wrote = Array.from({ length: 20 }, (_, i) => raw(i, 'Kind'));
      assert.deepEqual(wrote, Array(20).fill(raw(0, 'Kind')), 'twenty identical option ids');
      assert.equal(value(5, 'Kind'), 'bug');

      // One gesture, the whole fill: 19 rows changed, 19 undo steps.
      await page.locator('.wv-toast-action').first().click();
      await page.waitForFunction(() => !document.querySelector('.wv-toast-action'));
      await page.waitForTimeout(200);
      assert.equal(value(0, 'Kind'), 'bug', 'the source row is untouched');
      assert.equal(value(19, 'Kind'), null, 'and every row it filled is back');
      assert.equal(value(1, 'Kind'), null);
    } finally { await ctx.close(); reset(); }
  });

  test('the handle dragged across fills along the row instead of down it', async () => {
    reset();
    const { ctx, page } = await grid();
    try {
      await page.focus(sel(2, 'Note'));
      const handle = await page.locator(`${sel(2, 'Note')} .wv-fill-handle`).boundingBox();
      const to = await page.locator(sel(2, 'Kind')).boundingBox();
      await page.mouse.move(handle.x + 3, handle.y + 3);
      await page.mouse.down();
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
      await page.mouse.up();
      await page.waitForSelector('#wv-toasts .wv-toast');
      // 'n2' is not an option of Kind, so the engine refuses it BY NAME
      // rather than inventing one — the rule the types force.
      assert.match(await toastText(page), /not an option of 'Kind'/);
      assert.equal(value(2, 'Note'), 'n2', 'and nothing was half-written');
    } finally { await ctx.close(); reset(); }
  });

  /* ── the clipboard ────────────────────────────────────────────────── */

  test('⌘C on a multi-select cell, ⌘V on four others: all four hold the same SET', async () => {
    reset();
    const { ctx, page } = await grid();
    try {
      await page.focus(sel(0, 'Tags'));
      await page.keyboard.press('ControlOrMeta+c');
      await page.focus(sel(1, 'Tags'));
      for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowDown');
      await page.keyboard.press('ControlOrMeta+v');
      await page.waitForSelector('#wv-toasts .wv-toast');
      assert.match(await toastText(page), /Pasted 4 cells/);
      for (let i = 1; i <= 4; i++) {
        assert.deepEqual(value(i, 'Tags'), ['red', 'blue'], `row ${i} holds the whole set`);
        assert.deepEqual(raw(i, 'Tags'), raw(0, 'Tags'), 'by option identity, not by label');
      }
    } finally { await ctx.close(); reset(); }
  });

  test('a multi-select pastes as a replacement, never a merge', async () => {
    reset();
    weave.updateEntity(s.ids[6], { Tags: ['green'] });
    const { ctx, page } = await grid();
    try {
      await page.focus(sel(0, 'Tags'));
      await page.keyboard.press('ControlOrMeta+c');
      await page.focus(sel(6, 'Tags'));
      await page.keyboard.press('ControlOrMeta+v');
      await page.waitForSelector('#wv-toasts .wv-toast');
      assert.deepEqual(value(6, 'Tags'), ['red', 'blue'], 'green is gone, not kept');
    } finally { await ctx.close(); reset(); }
  });

  test('a formula column in the target is refused BY NAME in the toast', async () => {
    reset();
    const { ctx, page } = await grid();
    try {
      await page.focus(sel(0, 'Note'));
      await page.keyboard.press('ControlOrMeta+c');
      // Score then Double: one column takes a value, the other is a read.
      await page.focus(sel(1, 'Score'));
      await page.keyboard.press('Shift+ArrowRight');
      await page.keyboard.press('ControlOrMeta+v');
      await page.waitForSelector('#wv-toasts .wv-toast');
      const msg = await toastText(page);
      assert.match(msg, /Double/, 'the column that refused is named');
      assert.match(msg, /cannot take a value/);
      assert.equal(value(1, 'Double'), 2, 'and it still says what the formula says');
    } finally { await ctx.close(); reset(); }
  });

  test('a TSV paste from a spreadsheet fills row-major and drops only the unreadable cells', async () => {
    reset();
    const { ctx, page } = await grid();
    try {
      // Three rows × two columns: Note then Kind. Row 2's Score is prose.
      await page.evaluate(() => navigator.clipboard.writeText('a\tbug\nb\tchore\nc\tepic'));
      await page.focus(sel(1, 'Note'));
      await page.keyboard.press('Shift+ArrowDown');
      await page.keyboard.press('Shift+ArrowDown');
      await page.keyboard.press('Shift+ArrowRight');
      await page.keyboard.press('ControlOrMeta+v');
      await page.waitForSelector('#wv-toasts .wv-toast');
      assert.match(await toastText(page), /Pasted 6 cells/);
      assert.deepEqual([1, 2, 3].map((i) => [value(i, 'Note'), value(i, 'Kind')]),
        [['a', 'bug'], ['b', 'chore'], ['c', 'epic']], 'row-major, as the sheet had it');
    } finally { await ctx.close(); reset(); }
  });

  test('a number column reads the text it is given, and an unreadable cell is counted rather than written', async () => {
    reset();
    const { ctx, page } = await grid();
    try {
      await page.evaluate(() => navigator.clipboard.writeText('7\nnope\n9'));
      await page.focus(sel(1, 'Score'));
      await page.keyboard.press('Shift+ArrowDown');
      await page.keyboard.press('Shift+ArrowDown');
      await page.keyboard.press('ControlOrMeta+v');
      await page.waitForSelector('#wv-toasts .wv-toast');
      assert.match(await toastText(page), /1 unreadable/);
      assert.equal(value(1, 'Score'), 7);
      assert.equal(value(2, 'Score'), 2, 'the cell that would not read kept its value');
      assert.equal(value(3, 'Score'), 9);
    } finally { await ctx.close(); reset(); }
  });

  test('one copied cell tiles over the whole range it is pasted onto', async () => {
    reset();
    const { ctx, page } = await grid();
    try {
      await page.focus(sel(0, 'Kind'));
      await page.keyboard.press('ControlOrMeta+c');
      await page.focus(sel(10, 'Kind'));
      for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowDown');
      await page.keyboard.press('ControlOrMeta+v');
      await page.waitForSelector('#wv-toasts .wv-toast');
      for (let i = 10; i <= 14; i++) assert.equal(value(i, 'Kind'), 'bug');
      assert.equal(value(15, 'Kind'), null, 'and it stopped where the range did');
    } finally { await ctx.close(); reset(); }
  });

  test('a copy inside an OPEN cell is the caret’s, not the grid’s', async () => {
    reset();
    const { ctx, page } = await grid();
    try {
      await page.focus(sel(1, 'Note'));
      await page.keyboard.press('Enter');           // open the text cell
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.press('ControlOrMeta+c');
      await page.keyboard.press('Escape');
      const text = await page.evaluate(() => navigator.clipboard.readText());
      assert.equal(text, 'n1', 'the input copied its own text; the grid stayed out of it');
    } finally { await ctx.close(); reset(); }
  });
}
