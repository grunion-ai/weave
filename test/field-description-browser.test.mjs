/* A field's description, where a reader meets it (Issue #209): under the
   label on the entity page, as the column header's tooltip in the grid, on
   the folded chip, and in the field tray where it is written.

   Playwright is NOT a dependency of weave; it is imported dynamically and
   the suite skips when absent, so `node --test` stays green on a bare checkout. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let orders, order;
const NOTE = 'Who we bought from — the legal name on the invoice';

const s = await launch('field description', (weave) => {
  weave.createSpace({ name: 'Ops' });
  orders = weave.createTable({ space: 'Ops', name: 'Order' });
  weave.addField(orders, { name: 'Vendor', type: 'text', config: { description: NOTE } });
  weave.addField(orders, { name: 'Qty', type: 'number' });
  order = weave.createEntity(orders, { name: 'Sensor boards', values: { Vendor: 'Nordic', Qty: 12 } });
});

if (s) {
  const { base, browser, weave } = s;

  test('the description shows under its label on the page and as the column tooltip', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/entity/${order.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.entity-values .fieldrow');
    assert.equal(await page.$eval('.fieldrow[data-field="Vendor"] .fieldrow-desc', (n) => n.textContent), NOTE);
    assert.equal(await page.$('.fieldrow[data-field="Qty"] .fieldrow-desc'), null, 'a field without one wears no empty line');
    await page.goto(`${base}/#/table/${orders.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid th.col-head');
    const titles = await page.$$eval('.wv-grid th.col-head', (ths) => ths.map((t) => [t.textContent.trim().replace(/\s.*$/, ''), t.getAttribute('title')]));
    assert.equal(titles.find(([n]) => n === 'Vendor')?.[1], NOTE);
    assert.equal(titles.find(([n]) => n === 'Qty')?.[1], null, 'no tooltip where there is no description');
    await page.close();
  });

  test('the field tray writes it, and null-clears it, through the same PATCH the schema verbs use', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/table/${orders.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid th.col-head');
    await page.evaluate(() => [...document.querySelectorAll('.wv-grid th.col-head')].find((t) => t.textContent.includes('Qty')).click());
    await page.waitForSelector('textarea.field-desc');
    assert.equal(await page.$eval('textarea.field-desc', (n) => n.value), '', 'Qty has none yet');
    await page.fill('textarea.field-desc', 'How many units — whole numbers');
    await page.click('.tray-actions .btn-primary, .tray .btn-primary');
    await page.waitForFunction(() => [...document.querySelectorAll('.wv-grid th.col-head')].find((t) => t.textContent.includes('Qty'))?.getAttribute('title') === 'How many units — whole numbers', null, { timeout: 5000 });
    assert.equal(weave.describeSchema().find((sp) => !sp.system).tables[0].fields.find((f) => f.name === 'Qty').description, 'How many units — whole numbers', 'the engine has it');
    await page.evaluate(() => [...document.querySelectorAll('.wv-grid th.col-head')].find((t) => t.textContent.includes('Qty')).click());
    await page.waitForSelector('textarea.field-desc');
    assert.equal(await page.$eval('textarea.field-desc', (n) => n.value), 'How many units — whole numbers', 'reopening shows what was written');
    await page.fill('textarea.field-desc', '');
    await page.click('.tray-actions .btn-primary, .tray .btn-primary');
    await page.waitForFunction(() => [...document.querySelectorAll('.wv-grid th.col-head')].find((t) => t.textContent.includes('Qty'))?.getAttribute('title') === null, null, { timeout: 5000 });
    assert.equal(weave.describeSchema().find((sp) => !sp.system).tables[0].fields.find((f) => f.name === 'Qty').description, undefined, 'blank clears it');
    await page.close();
  });

  test('the view fields have no description box — theirs is the size', async () => {
    weave.updateTable(orders, { hiddenFields: (weave.getTable(orders).hiddenFields ?? []).filter((n) => n !== 'Chip') });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/entity/${order.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-appears-cfg');
    await page.click('.wv-appears-chip .wv-appears-cfg');
    await page.waitForSelector('.wv-view-preview');
    assert.equal(await page.$('textarea.field-desc'), null);
    await page.close();
  });
}
