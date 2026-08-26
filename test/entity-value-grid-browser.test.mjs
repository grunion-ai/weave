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
  // fieldOrder is a list of field ids; the page and the grid both read it
  // through names, so the test compares what a reader would see.
  const savedOrder = () => {
    const t = table();
    return t.fieldOrder.map((id) => t.fields[id].name);
  };

  const openEntity = async (id, width = 1280) => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.entity-values .fieldrow');
    return page;
  };
  const order = (page) => page.$$eval('.entity-values [data-field]', (ns) => ns.map((n) => n.dataset.field));

  test('value fields flow into two columns; documents keep the full width', async () => {
    const page = await openEntity(fresh());
    const cols = await page.$eval('.entity-values', (n) => getComputedStyle(n).gridTemplateColumns);
    assert.equal(cols.trim().split(/\s+/).length, 2, `two tracks, got "${cols}"`);

    const strays = await page.$$eval('.entity-fields > .fieldrow', (n) => n.length);
    assert.equal(strays, 0, 'every value row belongs to the grid');

    const docInGrid = await page.$$eval('.entity-values .doc-section', (n) => n.length);
    assert.equal(docInGrid, 0, 'a document is not a grid cell');
    assert.ok(await page.$('.entity-fields > .doc-section'), 'the document sits under the grid, full width');

    const [gridBox, docBox] = await page.evaluate(() => [
      document.querySelector('.entity-values').getBoundingClientRect().bottom,
      document.querySelector('.doc-section').getBoundingClientRect().top,
    ]);
    assert.ok(docBox >= gridBox - 1, 'the document starts below the value grid');
    await page.close();
  });

  test('reading order is the fieldOrder, left to right then down', async () => {
    const page = await openEntity(fresh());
    assert.deepEqual(await order(page), VALUES);
    const tops = await page.$$eval('.entity-values [data-field]', (ns) =>
      ns.map((n) => Math.round(n.getBoundingClientRect().top)));
    assert.equal(tops[0], tops[1], 'the first two fields share a row');
    assert.ok(tops[2] > tops[0], 'the third field starts the next row');
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
    const page = await openEntity(fresh());
    await page.evaluate(() => {
      const dt = new DataTransfer();
      const from = document.querySelector('[data-field="Weight"]');
      const onto = document.querySelector('[data-field="Vendor"]');
      from.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
      onto.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      onto.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.entity-values [data-field]')][0].dataset.field === 'Weight',
      null, { timeout: 4000 });
    assert.deepEqual(await order(page), ['Weight', 'Vendor', 'Batch', 'Price', 'Stage', 'Notes'],
      'the moved row lands where it was dropped');
    const saved = savedOrder();
    assert.ok(saved.indexOf('Weight') < saved.indexOf('Vendor'),
      'the schema followed the drag — the grid view sees the same order');
    await page.close();
  });

  test('a short row keeps the baseline of the tall row beside it', async () => {
    /* A date pair is taller than a line of text. With the cells top-aligned,
       the short label floated above its neighbour and every second row read
       as crooked — the grid has to stretch its cells so both rows centre. */
    const dated = weave.createTable({ space: 'Showcase', name: 'Dated' });
    weave.addField(dated, { name: 'Vendor', type: 'text' });
    weave.addField(dated, { name: 'Due', type: 'date' });
    weave.addField(dated, { name: 'Batch', type: 'text' });
    weave.addField(dated, { name: 'Start', type: 'date' });
    const id = weave.createEntity(dated, { name: 'Lot 4', values: { Vendor: 'Nordic', Due: '2026-09-15' } }).id;
    const page = await openEntity(id);
    const drift = await page.$$eval('.entity-values .fieldrow label', (ls) => {
      const tops = ls.map((l) => l.getBoundingClientRect().top);
      const out = [];
      for (let i = 0; i + 1 < tops.length; i += 2) out.push(Math.abs(tops[i] - tops[i + 1]));
      return out;
    });
    for (const d of drift) assert.ok(d <= 1, `labels in a row must share a baseline, off by ${d}px`);
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
