import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const LONG = Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1} of a long description that pushes everything below it far down the page.`).join('\n\n');

let report;
let quiet;
let slide;

const s = await launch('files sit directly under fields on the entity page', (weave) => {
  weave.createSpace({ name: 'Net' });
  const tasks = weave.createTable({ space: 'Net', name: 'Task' });
  weave.addField(tasks, { name: 'Owner', type: 'text' });
  weave.addField(tasks, { name: 'Spec', type: 'document' });
  report = weave.createEntity(tasks, { name: 'Quarterly report', values: { Owner: 'Kyle' } });
  weave.setDoc(report.id, LONG, 'Description');
  weave.setDoc(report.id, 'A short spec.', 'Spec');
  weave.attachFile(report.id, { name: 'report.html', mime: 'text/html', bytes: Buffer.from('<h1>Report</h1>') });
  quiet = weave.createEntity(tasks, { name: 'No attachments', values: { Owner: 'Kyle' } });
  weave.setDoc(quiet.id, LONG, 'Description');
  const slides = weave.createTable({ space: 'Net', name: 'Slide' });
  weave.addField(slides, { name: 'Model', type: 'document' });
  slide = weave.createEntity(slides, { name: 'Title slide' });
  weave.setDoc(slide.id, LONG, 'Description');
  weave.attachFile(slide.id, { name: 'preview.html', mime: 'text/html', bytes: Buffer.from('<h1>Preview</h1>') });
});

if (s) {
  const { base, browser } = s;
  const open = async (eid, width, ready) => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${base}/#/entity/${eid}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(ready);
    return page;
  };
  const tops = (page, selectors) => page.evaluate((sels) => Object.fromEntries(sels.map((q) => {
    const n = document.querySelector(q);
    return [q, n ? n.getBoundingClientRect().top + scrollY : null];
  })), selectors);

  for (const [layout, width] of [['desktop', 1440], ['phone', 390]]) {
    test(`a row with a file and a long Description shows Files above the Description heading (${layout})`, async () => {
      const page = await open(report.id, width, '.entity-files-card');
      const y = await tops(page, ['.entity-fields', '.entity-files-card', '[data-doc-field="Description"] .doc-section-head', '[data-doc-field="Spec"] .doc-section-head']);
      assert.ok(y['.entity-fields'] < y['.entity-files-card'], 'Files rose above the Fields block');
      assert.ok(y['.entity-files-card'] < y['[data-doc-field="Description"] .doc-section-head'], 'Files sits below the Description heading');
      assert.ok(y['.entity-files-card'] < y['[data-doc-field="Spec"] .doc-section-head'], 'Files sits below the Spec heading');
      const order = await page.$$eval('.entity-body > [data-block]', (ns) => ns.map((n) => n.dataset.block));
      assert.deepEqual(order.slice(0, 2), ['@values', '@files'], 'Files is not the block right after Fields');
      await page.close();
    });

    test(`a row without files shows no Files section (${layout})`, async () => {
      const page = await open(quiet.id, width, '[data-doc-field="Description"]');
      assert.equal(await page.locator('.entity-files-card').count(), 0, 'a row without attachments grew a Files section');
      const order = await page.$$eval('.entity-body > [data-block]', (ns) => ns.map((n) => n.dataset.block));
      assert.deepEqual(order, ['@values', 'Description', 'Spec'], 'a row without attachments changed its layout');
      await page.close();
    });

    test(`on a slide row Files sits above the slide preview and the slide preview above Description (${layout})`, async () => {
      const page = await open(slide.id, width, '.deck-section');
      const y = await tops(page, ['.entity-fields', '.entity-files-card', '.deck-section', '[data-doc-field="Description"] .doc-section-head']);
      assert.ok(y['.entity-files-card'] < y['.deck-section'], 'Files sits below the slide preview');
      assert.ok(y['.deck-section'] < y['[data-doc-field="Description"] .doc-section-head'], 'the slide preview fell below Description');
      if (y['.entity-fields'] != null) assert.ok(y['.entity-fields'] < y['.entity-files-card'], 'Files rose above the Fields block');
      await page.close();
    });
  }
}
