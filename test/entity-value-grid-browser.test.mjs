import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let parts;

const VALUES = ['Vendor', 'Batch', 'Price', 'Weight', 'Stage', 'Notes'];
const trackCount = (page) => page.$eval('.entity-values',
  (n) => Number(getComputedStyle(n).columnCount) || 1);
const columnsOf = (page) => page.$$eval('.entity-values [data-field]', (ns) => {
  const lefts = [...new Set(ns.map((n) => Math.round(n.getBoundingClientRect().left)))].sort((a, b) => a - b);
  const cols = lefts.map(() => []);
  for (const n of ns) cols[lefts.indexOf(Math.round(n.getBoundingClientRect().left))].push(n.dataset.field);
  return cols;
});

const s = await launch('entity value grid', (weave) => {
  weave.createSpace({ name: 'Showcase' });
  parts = weave.createTable({ space: 'Showcase', name: 'Part' });
  for (const name of VALUES) weave.addField(parts, { name, type: 'text' });
  weave.addField(parts, { name: 'Brief', type: 'document' });
});
if (s) {
  const { base, browser, weave } = s;
  const fresh = () => {
    const values = Object.fromEntries(VALUES.map((n, i) => [n, `v${i}`]));
    return weave.createEntity(parts, { name: 'Sensor board', values }).id;
  };
  const table = () => weave.getTable(parts);
  let n = 0;
  const ownTable = () => {
    const db = weave.createTable({ space: 'Showcase', name: `Drag ${++n}` });
    for (const name of VALUES) weave.addField(db, { name, type: 'text' });
    const values = Object.fromEntries(VALUES.map((v, i) => [v, `v${i}`]));
    return { db, id: weave.createEntity(db, { name: 'Sensor board', values }).id };
  };
  const orderOf = (db) => {
    const t = weave.getTable(db);
    return t.fieldOrder.map((fid) => t.fields[fid].name).filter((x) => VALUES.includes(x));
  };

  const openEntity = async (id, width = 1280) => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.entity-values .fieldrow');
    return page;
  };
  const order = (page) => page.$$eval('.entity-values [data-field]', (ns) => ns.map((n) => n.dataset.field));
  const drag = (page, from, onto, side = 'above') => page.evaluate(([f, t, s]) => {
    const dt = new DataTransfer();
    const a = document.querySelector(`[data-field="${f}"]`);
    const b = document.querySelector(`[data-field="${t}"]`);
    const r = b.getBoundingClientRect();
    const clientY = s === 'below' ? r.bottom - 2 : r.top + 2;
    a.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    const clientX = r.left + 30;
    b.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientX, clientY }));
    b.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX, clientY }));
    a.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
  }, [from, onto, side]);

  test('value fields flow into columns; documents keep the full width', async () => {
    const page = await openEntity(fresh());
    assert.equal(await trackCount(page), 2, 'a 1280px window carries two columns');

    const strays = await page.$$eval('.entity-fields > .fieldrow', (n) => n.length);
    assert.equal(strays, 0, 'every value row belongs to the grid');

    const docInGrid = await page.$$eval('.entity-values .doc-section', (n) => n.length);
    assert.equal(docInGrid, 0, 'a document is not a grid cell');
    assert.ok(await page.$('.entity-body > .doc-section[data-block]'),
      'the document is a block of its own, full width');

    const [gridBox, docBox] = await page.evaluate(() => [
      document.querySelector('.entity-values').getBoundingClientRect().bottom,
      document.querySelector('.doc-section').getBoundingClientRect().top,
    ]);
    assert.ok(docBox >= gridBox - 1, 'the document starts below the value grid');
    await page.close();
  });

  test('the column count follows the width it actually has', async () => {
    const id = fresh();
    for (const [width, want] of [[700, 1], [1280, 2], [1800, 3]]) {
      const page = await openEntity(id, width);
      assert.equal(await trackCount(page), want, `${width}px window wants ${want} column(s)`);
      await page.close();
    }
  });

  test('no value is clipped by the column it sits in', async () => {
    const wide = weave.createTable({ space: 'Showcase', name: 'Wide' });
    weave.addField(wide, { name: 'Vendor', type: 'text' });
    weave.addField(wide, { name: 'Window', type: 'daterange' });
    weave.addField(wide, { name: 'Secret', type: 'key' });
    weave.addField(wide, { name: 'Batch', type: 'text' });
    weave.addField(wide, { name: 'Stage', type: 'select', config: { options: ['Building', 'Shipped'] } });
    weave.addField(wide, { name: 'Notes', type: 'text' });
    const id = weave.createEntity(wide, {
      name: 'Lot 7',
      values: { Vendor: 'Nordic Assembly', Window: { start: '2026-08-01', end: '2026-09-15' }, Stage: 'Building' },
    }).id;
    for (const width of [700, 1280, 1600, 1800]) {
      const page = await openEntity(id, width);
      const tight = await page.$$eval('.entity-values .fieldrow', (ns) => ns
        .map((n) => [n.dataset.field, n.children[2].scrollWidth - n.children[2].clientWidth])
        .filter(([, over]) => over > 1));
      assert.deepEqual(tight, [], `values overflow their column at ${width}px`);
      await page.close();
    }
  });

  test('reading order is the fieldOrder, down each column then across', async () => {
    const page = await openEntity(fresh());
    assert.deepEqual(await order(page), VALUES);
    const cols = await columnsOf(page);
    assert.equal(cols.length, 2, 'a 1280px window carries two columns');
    assert.deepEqual(cols.flat(), VALUES, 'columns read top to bottom, left to right');
    assert.deepEqual(cols[0], VALUES.slice(0, cols[0].length),
      'the first column is a prefix of the fieldOrder — the order flows down, not across');
    await page.close();
  });

  test('a value still edits in place inside the grid', async () => {
    const id = fresh();
    const page = await openEntity(id);
    const input = await page.$('.entity-values [data-field="Vendor"] input');
    assert.ok(input, 'the value is an inline editor, not a read-only cell');
    await input.fill('Nordic Assembly');
    await input.dispatchEvent('change');
    await page.waitForFunction(
      (i) => fetch(`/api/entities/${i}`).then((r) => r.json()).then((e) => e.fields.Vendor === 'Nordic Assembly'),
      id, { timeout: 4000 },
    );
    const saved = await fetch(`${base}/api/entities/${id}`).then((r) => r.json());
    assert.equal(saved.fields.Vendor, 'Nordic Assembly', 'the edit reached the store');
    await page.close();
  });

  test('a row still drags to reorder, through the same schema write', async () => {
    const { db, id } = ownTable();
    const page = await openEntity(id);
    await drag(page, 'Weight', 'Vendor');
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.entity-values [data-field]')][0].dataset.field === 'Weight',
      null, { timeout: 4000 });
    assert.deepEqual(await order(page), ['Weight', 'Vendor', 'Batch', 'Price', 'Stage', 'Notes'],
      'the moved row lands where it was dropped');
    const saved = orderOf(db);
    assert.ok(saved.indexOf('Weight') < saved.indexOf('Vendor'),
      'the schema followed the drag — the grid view sees the same order');
    await page.close();
  });

  test('a second drag lands where it was dropped, not where the page opened', async () => {
    const { db, id } = ownTable();
    const page = await openEntity(id, 1800);
    await drag(page, 'Weight', 'Vendor');
    await page.waitForFunction(() => document.querySelector('.entity-values [data-field]').dataset.field === 'Weight');
    assert.deepEqual(await order(page), ['Weight', 'Vendor', 'Batch', 'Price', 'Stage', 'Notes']);

    await drag(page, 'Vendor', 'Weight');
    await page.waitForFunction(() => document.querySelector('.entity-values [data-field]').dataset.field === 'Vendor',
      null, { timeout: 4000 });
    assert.deepEqual(await order(page), ['Vendor', 'Weight', 'Batch', 'Price', 'Stage', 'Notes'],
      'dropping onto the row above puts the field above it');
    assert.deepEqual(orderOf(db), ['Vendor', 'Weight', 'Batch', 'Price', 'Stage', 'Notes'],
      'the schema agrees with what the page shows');
    await page.close();
  });

  test('a field dropped in another column lands beside its target', async () => {
    const page = await openEntity(ownTable().id, 1800);
    assert.equal(await trackCount(page), 3);
    await drag(page, 'Vendor', 'Stage', 'below');
    await page.waitForFunction(() => document.querySelector('.entity-values [data-field]').dataset.field === 'Batch',
      null, { timeout: 4000 });
    assert.deepEqual(await order(page), ['Batch', 'Price', 'Weight', 'Stage', 'Vendor', 'Notes'],
      'dragging forward lands the field just after the row it was dropped on');
    await page.close();
  });

  test('holding a row opens a slot where it will land, and the rows make room', async () => {
    const page = await openEntity(ownTable().id, 1800);
    const cue = await page.evaluate(() => {
      const dt = new DataTransfer();
      const from = document.querySelector('[data-field="Vendor"]');
      const onto = document.querySelector('[data-field="Stage"]');
      const list = document.querySelector('.entity-values');
      const fill = getComputedStyle(onto).backgroundColor;
      from.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
      const r = onto.getBoundingClientRect();
      const at = (clientY) => {
        onto.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 30, clientY }));
        const slot = list.querySelector('.drop-slot');
        return {
          slots: list.querySelectorAll('.drop-slot').length,
          label: slot?.textContent.trim() ?? null,
          height: slot ? Math.round(slot.getBoundingClientRect().height) : 0,
          slotBeforeStage: !!slot && !!(slot.compareDocumentPosition(onto) & Node.DOCUMENT_POSITION_FOLLOWING),
          slotReadsBeforeStage: !!slot && (slot.getBoundingClientRect().bottom <= onto.getBoundingClientRect().top + 1
            || slot.getBoundingClientRect().right <= onto.getBoundingClientRect().left + 1),
          fill: getComputedStyle(onto).backgroundColor,
          lines: [getComputedStyle(onto).borderTopColor, getComputedStyle(onto).borderBottomColor],
        };
      };
      const idle = getComputedStyle(onto).borderTopColor;
      const above = at(r.top + 2);
      const below = at(r.bottom - 2);
      from.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
      return { idle, fill, above, below, left: list.querySelectorAll('.drop-slot').length, rowTop: Math.round(r.top) };
    });
    assert.equal(cue.above.slots, 1, 'one slot, never two');
    assert.equal(cue.above.label, 'Vendor', 'the slot says which field will land in it');
    assert.ok(cue.above.height >= 24, 'the slot is a row-sized hole, not a line');
    assert.ok(cue.above.slotBeforeStage, 'above the midpoint the slot opens above the row');
    assert.ok(cue.above.slotReadsBeforeStage, 'and comes before it on the page — the rows made room');
    assert.ok(!cue.below.slotBeforeStage, 'below the midpoint it opens beneath');
    assert.equal(cue.below.slots, 1, 'moving the pointer moves the slot, it does not add one');
    assert.equal(cue.above.fill, cue.fill, 'the row under the pointer is not tinted');
    assert.deepEqual(cue.above.lines, [cue.idle, cue.idle], 'and wears no line — the slot is the whole cue');
    assert.equal(cue.left, 0, 'dragend takes the slot away');
    await page.close();
  });

  test('a drop lands the field where the slot was', async () => {
    const { db, id } = ownTable();
    const page = await openEntity(id, 1800);
    await page.evaluate(() => {
      const dt = new DataTransfer();
      const from = document.querySelector('[data-field="Notes"]');
      const onto = document.querySelector('[data-field="Batch"]');
      const r = onto.getBoundingClientRect();
      from.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
      onto.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.top + 2 }));
      const slot = document.querySelector('.entity-values .drop-slot');
      slot.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.top + 2 }));
      from.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector('.entity-values [data-field]').dataset.field === 'Vendor'
      && !document.querySelector('.entity-values .drop-slot'), null, { timeout: 4000 });
    assert.deepEqual(await order(page), ['Vendor', 'Notes', 'Batch', 'Price', 'Weight', 'Stage'],
      'Notes went into the slot above Batch');
    assert.deepEqual(orderOf(db), ['Vendor', 'Notes', 'Batch', 'Price', 'Weight', 'Stage'], 'and the schema followed');
    await page.close();
  });

  test('a move inside one column leaves the other column alone', async () => {
    const { id } = ownTable();
    const page = await openEntity(id);
    const before = await columnsOf(page);
    assert.equal(before.length, 2);
    const [top, next] = before[0];
    await drag(page, next, top, 'above');
    await page.waitForFunction((f) =>
      document.querySelector('.entity-values [data-field]').dataset.field === f, next, { timeout: 4000 });
    const after = await columnsOf(page);
    assert.deepEqual(after[1], before[1], 'the second column never moved');
    assert.deepEqual(after[0].slice(0, 2), [next, top], 'the two rows traded places in their own column');
    await page.close();
  });

  test('the eye hides a field from the grid and from the table alike', async () => {
    const page = await openEntity(fresh());
    await page.click('.eye-btn');
    await page.waitForSelector('.eye-row');
    await page.click('.eye-row:has-text("Price")');
    await page.waitForFunction(() => !document.querySelector('[data-field="Price"]'), null, { timeout: 4000 });
    assert.ok(!(await order(page)).includes('Price'), 'the hidden field leaves the grid');
    assert.ok((weave.describeSchema().flatMap((sp) => sp.tables).find((t) => t.id === table().id).hiddenFields ?? []).includes('Price'),
      'hiding is the table\'s own set, so the grid view hides it too');
    await page.close();
  });
}
