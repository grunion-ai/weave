/* Moving the field block, the documents and the related tables (Issue #89).

   The body used to be hard-sorted — values, then documents, then attachments,
   then related tables — and nothing a reader did could say otherwise. Kyle
   wants the whole field block to move above or below a document or a related
   table, and those to move too, so every block carries a reposition anchor
   and the order is a table setting.

   The two drags do not mix: a field moves inside the field block and writes
   fieldOrder, a block moves among blocks and writes bodyOrder.

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
  test('entity body blocks (browser)', { skip: 'playwright not installed' }, () => {});
} else {
  let server, base, browser, weave, people;

  test.before(async () => {
    weave = new Weave();
    weave.createSpace({ name: 'Showcase' });
    people = weave.createTable({ space: 'Showcase', name: 'Person' });
    ({ server } = await startServer(weave, { port: 0 }));
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
  });

  test.after(async () => {
    await browser?.close();
    server?.close();
  });

  let n = 0;
  const build = () => {
    const db = weave.createTable({ space: 'Showcase', name: `Part ${++n}` });
    weave.addField(db, { name: 'Vendor', type: 'text' });
    weave.addField(db, { name: 'Batch', type: 'text' });
    weave.addField(db, { name: 'Brief', type: 'document' });
    weave.addField(db, { name: 'Files', type: 'attachments' });
    weave.addRelation(db, { name: 'Peers', targetDb: people, cardinality: 'many-to-many', inverseName: `Owns ${n}` });
    const id = weave.createEntity(db, { name: 'Sensor board', values: { Vendor: 'Nordic' } }).id;
    return { db, id };
  };

  const open = async (id, width = 1400) => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.entity-values .fieldrow');
    await page.waitForSelector('[data-block="Peers"]');
    return page;
  };
  const blocks = (page) => page.$$eval('[data-block]', (ns) => ns.map((x) => x.dataset.block));
  const dragBlock = (page, from, onto) => page.evaluate(([f, t]) => {
    const dt = new DataTransfer();
    const a = document.querySelector(`[data-block="${f}"]`);
    const b = document.querySelector(`[data-block="${t}"]`);
    const handle = a.querySelector('[draggable="true"]') ?? a;
    /* Stands in for a hand: dragging forward ends in the target's bottom
       half, dragging back in its top half. The slot opens there. */
    const forward = !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const r = b.getBoundingClientRect();
    const at = { clientX: r.left + 30, clientY: forward ? r.bottom - 2 : r.top + 2 };
    handle.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    b.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, ...at }));
    b.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, ...at }));
    handle.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
  }, [from, onto]);

  test('every block on the page carries a reposition anchor', async () => {
    const { id } = build();
    const page = await open(id);
    assert.deepEqual(await blocks(page), ['@values', 'Description', 'Brief', 'Files', 'Peers'],
      'the field block comes first by default, then the documents');
    const anchored = await page.$$eval('[data-block]', (ns) =>
      ns.filter((x) => x.querySelector('.opt-grip[draggable="true"]')).map((x) => x.dataset.block));
    assert.deepEqual(anchored, ['@values', 'Description', 'Brief', 'Files', 'Peers'],
      'a document and a related table are as movable as the field block');
    await page.close();
  });

  test('the field block moves below a document and stays there', async () => {
    const { db, id } = build();
    const page = await open(id);
    await dragBlock(page, '@values', 'Brief');
    await page.waitForFunction(() => document.querySelector('[data-block]').dataset.block !== '@values',
      null, { timeout: 4000 });
    assert.deepEqual(await blocks(page), ['Description', 'Brief', '@values', 'Files', 'Peers'],
      'dragging forward lands the block just after the one it was dropped on');
    assert.deepEqual(weave.bodyBlocks(db), ['Description', 'Brief', '@values', 'Files', 'Peers'],
      'the table remembers, so the next reader sees the same page');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-block="Peers"]');
    assert.deepEqual(await blocks(page), ['Description', 'Brief', '@values', 'Files', 'Peers']);
    await page.close();
  });

  test('a related table moves above the field block', async () => {
    const { db, id } = build();
    const page = await open(id);
    await dragBlock(page, 'Peers', '@values');
    await page.waitForFunction(() => document.querySelector('[data-block]').dataset.block === 'Peers',
      null, { timeout: 4000 });
    assert.deepEqual(await blocks(page), ['Peers', '@values', 'Description', 'Brief', 'Files']);
    assert.deepEqual(weave.bodyBlocks(db), ['Peers', '@values', 'Description', 'Brief', 'Files']);
    await page.close();
  });

  test('holding a block opens the same slot the rows use, between the blocks', async () => {
    /* One cue for the whole page: a block being moved opens a slot among the
       blocks, the way a row opens one among the rows, so the two drags stop
       having two grammars (review, 2026-09-03). */
    const page = await open(build().id);
    const cue = await page.evaluate(() => {
      const dt = new DataTransfer();
      const from = document.querySelector('[data-block="@values"]');
      const onto = document.querySelector('[data-block="Brief"]');
      const body = document.querySelector('.entity-body');
      const fill = getComputedStyle(onto).backgroundColor;
      const r = onto.getBoundingClientRect();
      from.querySelector('.opt-grip').dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
      onto.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.bottom - 2 }));
      const slot = body.querySelector(':scope > .drop-slot');
      const out = {
        slots: body.querySelectorAll(':scope > .drop-slot').length,
        label: slot?.textContent.trim() ?? null,
        afterBrief: !!slot && !!(onto.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING),
        fill: getComputedStyle(onto).backgroundColor, shadow: getComputedStyle(onto).boxShadow,
      };
      from.querySelector('.opt-grip').dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
      out.left = body.querySelectorAll(':scope > .drop-slot').length;
      return { ...out, before: fill };
    });
    assert.equal(cue.slots, 1, 'one slot among the blocks');
    assert.equal(cue.label, 'Fields', 'named for the block that will land in it');
    assert.ok(cue.afterBrief, 'below the midpoint the slot opens beneath the block');
    assert.equal(cue.fill, cue.before, 'the block under the pointer is not tinted');
    assert.equal(cue.shadow, 'none', 'and wears no line — the slot is the whole cue');
    assert.equal(cue.left, 0, 'dragend takes it away');
    await page.close();
  });

  test('a field drag and a block drag do not reach into each other', async () => {
    const { db, id } = build();
    const page = await open(id);
    const before = await blocks(page);
    await page.evaluate(() => {
      const dt = new DataTransfer();
      const field = document.querySelector('[data-field="Vendor"]');
      const doc = document.querySelector('[data-block="Brief"]');
      field.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
      doc.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      doc.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      field.dispatchEvent(new DragEvent('dragend', { dataTransfer: dt, bubbles: true }));
    });
    await page.waitForTimeout(300);
    assert.deepEqual(await blocks(page), before, 'a field cannot become a block');
    assert.equal(weave.getTable(db).bodyOrder, undefined, 'and it writes nothing');
    const order = await page.$$eval('.entity-values [data-field]', (ns) => ns.map((x) => x.dataset.field));
    assert.deepEqual(order, ['Vendor', 'Batch'], 'the field stayed where it was');
    await page.close();
  });
}
