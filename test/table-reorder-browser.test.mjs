import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const FIELDS = ['Vendor', 'Batch', 'Price', 'Stage'];
const BASE = ['Name', 'Description', ...FIELDS];

const s = await launch('table column reorder', (weave) => {
  weave.createSpace({ name: 'Showcase' });
});
if (s) {
  const { base, browser, weave } = s;
  const orderOf = (db) => weave.tableView(db).views[0].fields.filter((name) => BASE.includes(name));

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

  const dragHeader = async (page, from, onto) => {
    await headFor(page, from).dragTo(
      onto === '#' ? page.locator('.wv-grid thead .pid-head') : headFor(page, onto));
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
        ['Price', 'Name', 'Description', 'Vendor', 'Batch', 'Stage'], 'persisted into the view');
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

  test('the # column takes no drag, and nothing lands before it: a drop on # freezes the field just after it', async () => {
    const db = ownTable();
    const page = await openGrid(db);
    try {
      const pidDraggable = await page.$eval('.wv-grid thead .pid-head', (h) => h.draggable);
      assert.equal(pidDraggable, false, 'the # header is not a drag handle');
      const pid = await page.locator('.wv-grid thead .pid-head').boundingBox();
      await page.mouse.move(pid.x + pid.width / 2, pid.y + pid.height / 2);
      await page.mouse.down();
      await page.mouse.move(pid.x + 300, pid.y + pid.height / 2, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(150);
      assertShape(await gridShape(page), BASE, 'a drag on # moves nothing');
      await dragHeader(page, 'Batch', '#');
      const expected = ['Batch', 'Name', 'Description', 'Vendor', 'Price', 'Stage'];
      assertShape(await gridShape(page), expected, '# stays first');
      await page.waitForTimeout(150);
      assert.deepEqual(orderOf(db), expected, 'the view saved the move');
      assert.equal(weave.tableView(db).views[0].frozen, 1, 'and the freeze');
    } finally { await page.close(); }
  });
}
