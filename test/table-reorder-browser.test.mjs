/* Column drag-to-reorder in the grid — the half only a real browser can
   judge. The simulated DragEvent tests prove the handlers are wired; they
   cannot prove the columns land where the reader dropped them, because the
   in-place DOM move does its own cell-index arithmetic against rows that
   carry two non-field cells (sel-cell, pid-cell) before the first field.

   Three claims a real drag verifies:
     1. the # column is anchored: it sits at the same index in every row
        before and after any drag, its header takes no drag, and a field
        dropped on it goes nowhere.
     2. a dragged field snaps to the expected spot — in the pre-reload DOM
        (the in-place move), in the reloaded DOM, and in fieldOrder.
     3. every body row moves with the header: no row's cells disagree with
        the header's column order after the move.

   Playwright is NOT a dependency of weave (house rule: zero runtime deps).
   It is imported dynamically and the suite skips when it is absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const FIELDS = ['Vendor', 'Batch', 'Price', 'Stage'];
// A new table arrives with Name and Description; the grid shows them too.
const BASE = ['Name', 'Description', ...FIELDS];

const s = await launch('table column reorder', (weave) => {
  weave.createSpace({ name: 'Showcase' });
});
if (s) {
  const { base, browser, weave } = s;
  /* fieldOrder holds field ids; read it back as names for the assertions. */
  const orderOf = (db) => {
    const t = weave.getTable(db);
    return t.fieldOrder.map((id) => t.fields[id]?.name)
      .filter((name) => BASE.includes(name));
  };

  /* A drag rewrites fieldOrder, so every test gets a table of its own. */
  let n = 0;
  const ownTable = () => {
    const db = weave.createTable({ space: 'Showcase', name: `Drag ${++n}` });
    for (const name of FIELDS) weave.addField(db, { name, type: 'text' });
    for (const name of ['Alpha', 'Bravo', 'Charlie']) {
      weave.createEntity(db, { name, values: { Vendor: 'v', Batch: 'b', Price: 'p', Stage: 's' } });
    }
    return db;
  };

  const openGrid = async (db) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${base}/#/table/${db.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    return page;
  };

  const headFor = (page, name) => page.locator('.wv-grid thead .col-head',
    { has: page.locator(`.col-label:text-is("${name}")`) }).first();

  /* One snapshot of the whole grid: the header's column order, the # column's
     index in the header and in every body row, and each body row's own cell
     order. Read off the live DOM, so an in-place move that shifted the wrong
     cells cannot hide behind a correct fieldOrder. */
  const gridShape = (page) => page.evaluate(() => {
    const table = document.querySelector('.wv-grid');
    const heads = [...table.querySelectorAll('thead th')];
    const headOrder = heads.filter((h) => h.classList.contains('col-head'))
      .map((h) => h.querySelector('.col-label').textContent.trim().replace(/ [↑↓]$/, ''));
    const pidHeadIdx = heads.findIndex((h) => h.classList.contains('pid-head'));
    const rows = [...table.querySelectorAll('tbody tr.entity-row')].map((tr) => {
      const cells = [...tr.children];
      return {
        pidIdx: cells.findIndex((c) => c.classList.contains('pid-cell')),
        pid: cells.find((c) => c.classList.contains('pid-cell'))?.textContent.trim() ?? '',
        fields: cells.filter((c) => c.dataset.field).map((c) => c.dataset.field),
      };
    });
    return { headOrder, pidHeadIdx, rows };
  });

  /* A real pointer drag, not a dispatched DragEvent: Playwright drives
     Chromium's own HTML5 drag pipeline, so dragstart/dragover/drop fire the
     way a hand fires them. */
  const dragHeader = async (page, from, onto) => {
    await headFor(page, from).dragTo(
      onto === '#' ? page.locator('.wv-grid thead .pid-head') : headFor(page, onto));
    // reorderField PATCHes the schema behind the in-place move.
    await page.waitForTimeout(150);
  };

  const assertShape = (shape, expected, label) => {
    assert.deepEqual(shape.headOrder, expected, `${label}: header order`);
    assert.equal(shape.pidHeadIdx, 1, `${label}: # header anchored at index 1`);
    for (const row of shape.rows) {
      assert.equal(row.pidIdx, 1, `${label}: # cell anchored at index 1 in row ${row.pid}`);
      assert.match(row.pid, /^#\d+/, `${label}: # cell still carries the id in row ${row.pid}`);
      assert.deepEqual(row.fields, expected, `${label}: cell order in row ${row.pid}`);
    }
  };

  test('dragging a column left snaps it before the target, in every row', async () => {
    const db = ownTable();
    const page = await openGrid(db);
    try {
      await dragHeader(page, 'Price', 'Name');
      assertShape(await gridShape(page), ['Price', 'Name', 'Description', 'Vendor', 'Batch', 'Stage'], 'in-place');
      assert.deepEqual(orderOf(db),
        ['Price', 'Name', 'Description', 'Vendor', 'Batch', 'Stage'], 'persisted fieldOrder');
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      assertShape(await gridShape(page), ['Price', 'Name', 'Description', 'Vendor', 'Batch', 'Stage'], 'after reload');
    } finally { await page.close(); }
  });

  test('dragging a column right snaps it after the target, in every row', async () => {
    const db = ownTable();
    const page = await openGrid(db);
    try {
      await dragHeader(page, 'Vendor', 'Price');
      assertShape(await gridShape(page), ['Name', 'Description', 'Batch', 'Price', 'Vendor', 'Stage'], 'in-place');
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      assertShape(await gridShape(page), ['Name', 'Description', 'Batch', 'Price', 'Vendor', 'Stage'], 'after reload');
    } finally { await page.close(); }
  });

  test('two drags in a row stay honest — the second starts from where the first landed', async () => {
    const db = ownTable();
    const page = await openGrid(db);
    try {
      await dragHeader(page, 'Stage', 'Name');
      await dragHeader(page, 'Batch', 'Stage');
      assertShape(await gridShape(page), ['Batch', 'Stage', 'Name', 'Description', 'Vendor', 'Price'], 'in-place');
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      assertShape(await gridShape(page), ['Batch', 'Stage', 'Name', 'Description', 'Vendor', 'Price'], 'after reload');
    } finally { await page.close(); }
  });

  test('the # column takes no drag: not draggable, and a drop on it goes nowhere', async () => {
    const db = ownTable();
    const page = await openGrid(db);
    try {
      const pidDraggable = await page.$eval('.wv-grid thead .pid-head', (h) => h.draggable);
      assert.equal(pidDraggable, false, 'the # header is not a drag handle');
      await dragHeader(page, 'Batch', '#');
      assertShape(await gridShape(page), BASE, 'unchanged');
      assert.deepEqual(orderOf(db),
        BASE, 'fieldOrder untouched');
    } finally { await page.close(); }
  });
}
