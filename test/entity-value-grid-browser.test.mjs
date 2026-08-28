/* The entity page lays its value fields out in two columns (Issue #89).

   Twenty-eight fields in one column put the document a full screen down, so
   the value rows flow into a two-column grid at the top of the entity while
   documents and attachments keep the full width below them.

   Density is the easy half. The half worth testing is that nothing the
   single column could do is lost on the way: a value still edits in place, a
   row still drags to reorder and writes through the same reorderField the
   grid header uses, the eye still hides a field for the table and the page at
   once, and the reading order still follows fieldOrder.

   Playwright is NOT a dependency of weave; it is imported dynamically and the
   suite skips when absent, so `node --test` stays green on a bare checkout. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const chromium = await import('playwright')
  .then((pw) => pw.chromium)
  .catch(() => null);

if (!chromium) {
  test('entity value grid (browser)', { skip: 'playwright not installed' }, () => {});
} else {
  let server, base, browser, weave, parts;

  const VALUES = ['Vendor', 'Batch', 'Price', 'Weight', 'Stage', 'Notes'];
  const trackCount = (page) => page.$eval('.entity-values',
    (n) => Number(getComputedStyle(n).columnCount) || 1);
  /* Which column each field sits in, read off the page: rows sharing a left
     edge share a column. */
  const columnsOf = (page) => page.$$eval('.entity-values [data-field]', (ns) => {
    const lefts = [...new Set(ns.map((n) => Math.round(n.getBoundingClientRect().left)))].sort((a, b) => a - b);
    const cols = lefts.map(() => []);
    for (const n of ns) cols[lefts.indexOf(Math.round(n.getBoundingClientRect().left))].push(n.dataset.field);
    return cols;
  });

  test.before(async () => {
    weave = new Weave();
    weave.createSpace({ name: 'Showcase' });
    parts = weave.createTable({ space: 'Showcase', name: 'Part' });
    for (const name of VALUES) weave.addField(parts, { name, type: 'text' });
    weave.addField(parts, { name: 'Brief', type: 'document' });
    ({ server } = await startServer(weave, { port: 0 }));
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
  });

  test.after(async () => {
    await browser?.close();
    server?.close();
  });

  const fresh = () => {
    const values = Object.fromEntries(VALUES.map((n, i) => [n, `v${i}`]));
    return weave.createEntity(parts, { name: 'Sensor board', values }).id;
  };
  const table = () => weave.getTable(parts);
  /* A drag rewrites fieldOrder, so every dragging test gets a table of its
     own: shared, they would each start from the previous test's leftovers. */
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
  /* The pointer's height on the target row decides the side: above the
     midpoint inserts before, below it inserts after. */
  const drag = (page, from, onto, side = 'above') => page.evaluate(([f, t, s]) => {
    const dt = new DataTransfer();
    const a = document.querySelector(`[data-field="${f}"]`);
    const b = document.querySelector(`[data-field="${t}"]`);
    const r = b.getBoundingClientRect();
    const clientY = s === 'below' ? r.bottom - 2 : r.top + 2;
    a.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    b.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientY }));
    b.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientY }));
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
    /* Container width, not viewport: the entity page gives room away to the
       activity rail and to a peek panel, so a media query would promise a
       third column the row does not have. */
    const id = fresh();
    for (const [width, want] of [[700, 1], [1280, 2], [1800, 3]]) {
      const page = await openEntity(id, width);
      assert.equal(await trackCount(page), want, `${width}px window wants ${want} column(s)`);
      await page.close();
    }
  });

  test('no value is clipped by the column it sits in', async () => {
    /* The reason the ladder stops where it does. A date range is two inputs
       and a dash — it has a floor no ellipsis can talk it out of, so it takes
       two tracks, and every other editor has to fit the track it is given. */
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
    /* Column-major, not row-major: a field's neighbours in the order are the
       fields above and below it, so a reorder ripples only at the column
       boundary instead of reshuffling every later field across columns. */
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
    /* The drop read its direction from the field list captured when the page
       was drawn, so once a drag had moved something the next one was judged
       against an order that no longer existed. Dragging a field back over the
       one it had just passed computed "after" from the stale list and put it
       where it already was: the row did not move, which reads as a dead drag
       rather than a wrong one. Direction has to come from the live DOM. */
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
    /* Three columns, so the drag crosses one: the field has to land next to
       the row it was dropped on, wherever that row happens to sit. */
    const page = await openEntity(ownTable().id, 1800);
    assert.equal(await trackCount(page), 3);
    await drag(page, 'Vendor', 'Stage', 'below');
    await page.waitForFunction(() => document.querySelector('.entity-values [data-field]').dataset.field === 'Batch',
      null, { timeout: 4000 });
    assert.deepEqual(await order(page), ['Batch', 'Price', 'Weight', 'Stage', 'Vendor', 'Notes'],
      'dragging forward lands the field just after the row it was dropped on');
    await page.close();
  });

  test('the drop cue is a horizontal line on the side the field will land', async () => {
    /* A tinted cell said "this row"; a swap highlight said "we trade". The
       reader needs "this gap": one line above or below the row under the
       pointer, picked by where the pointer sits against the row's midpoint. */
    const page = await openEntity(ownTable().id, 1800);
    const cue = await page.evaluate(() => {
      const dt = new DataTransfer();
      const from = document.querySelector('[data-field="Vendor"]');
      const onto = document.querySelector('[data-field="Stage"]');
      const fill = getComputedStyle(onto).backgroundColor;
      const r = onto.getBoundingClientRect();
      const at = (clientY) => {
        onto.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientY }));
        const cs = getComputedStyle(onto);
        return {
          before: onto.classList.contains('drop-before'), after: onto.classList.contains('drop-after'),
          top: cs.borderTopColor, bottom: cs.borderBottomColor, fill: cs.backgroundColor,
        };
      };
      from.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
      const idle = getComputedStyle(onto).borderTopColor;
      const above = at(r.top + 2);
      const below = at(r.bottom - 2);
      from.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
      const swept = onto.classList.contains('drop-before') || onto.classList.contains('drop-after');
      return { idle, fill, above, below, swept };
    });
    assert.ok(cue.above.before && !cue.above.after, 'above the midpoint the cue sits on top');
    assert.ok(cue.below.after && !cue.below.before, 'below the midpoint it moves to the bottom');
    assert.notEqual(cue.above.top, cue.idle, 'the top line is drawn');
    assert.notEqual(cue.below.bottom, cue.idle, 'the bottom line is drawn');
    assert.equal(cue.above.fill, cue.fill, 'the cue does not fill the cell');
    assert.ok(!cue.swept, 'dragend clears every cue');
    await page.close();
  });

  test('a move inside one column leaves the other column alone', async () => {
    /* The point of column-major flow: a field's column is stable under
       reorders that stay in the column, because only the boundary between
       columns can move — nothing reshuffles across the page. */
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
    assert.ok((table().hiddenFields ?? []).includes('Price'),
      'hiding is the table\'s own set, so the grid view hides it too');
    await page.close();
  });
}
