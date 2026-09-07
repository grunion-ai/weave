/* The field block, folded, driven through a real browser.

   Issue #89 — "with too many fields we need to be able to collapse the non
   document fields so we still see the same information but compactly
   organized at the top": a folded block keeps its values as one wrapping
   line of label · value chips, drawn by the same editors the rows use.

   Issue #129 — "fields checked to be visible but do not show": a field the
   eye turns on is drawn whether the block is folded (a chip) or open (a
   row); a table whose block was empty grows one.

   Playwright is NOT a dependency of weave; it is imported dynamically and
   the suite skips when absent, so `node --test` stays green on a bare checkout. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let orders, bare, order, bareRow;

const s = await launch('entity fields fold', (weave) => {
  weave.createSpace({ name: 'Ops' });
  orders = weave.createTable({ space: 'Ops', name: 'Order' });
  weave.addField(orders, { name: 'Vendor', type: 'text', config: { description: 'Who we bought from — the legal name on the invoice' } });
  weave.addField(orders, { name: 'Qty', type: 'number' });
  weave.addField(orders, { name: 'Stage', type: 'select', config: { options: ['Draft', 'Sent'] } });
  weave.addField(orders, { name: 'Ref', type: 'text' });
  weave.addField(orders, { name: 'Brief', type: 'document' });
  weave.updateTable(orders, { hiddenFields: [...(weave.getTable(orders).hiddenFields ?? []), 'Ref'] });
  order = weave.createEntity(orders, { name: 'Sensor boards', values: { Vendor: 'Nordic', Qty: 12, Stage: 'Sent', Ref: 'PO-7' } });
  // A table whose only value field is hidden: no field block at all.
  bare = weave.createTable({ space: 'Ops', name: 'Note' });
  weave.addField(bare, { name: 'Topic', type: 'text' });
  weave.updateTable(bare, { hiddenFields: [...(weave.getTable(bare).hiddenFields ?? []), 'Topic'] });
  bareRow = weave.createEntity(bare, { name: 'Standup', values: { Topic: 'Weds' } });
});

if (s) {
  const { base, browser } = s;
  const HEAD = '[data-block="@values"] .block-head';
  const open = async (id, opts = {}) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, ...opts });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.name-edit');
    return page;
  };
  const folded = (page) => page.evaluate(() => document.querySelector('.entity-values')?.classList.contains('hidden') ?? null);
  const summaryFields = (page) => page.evaluate(() => {
    const sum = document.querySelector('.entity-values-summary');
    if (!sum || sum.classList.contains('hidden')) return null;
    return [...sum.querySelectorAll('.wv-sum')].map((n) => n.dataset.field);
  });
  const flip = async (page, label) => {
    const before = await page.evaluate((l) => [...document.querySelectorAll('.chip-pop .eye-row')]
      .find((r) => r.querySelector('.eye-label')?.textContent === l)?.getAttribute('aria-checked'), label);
    await page.evaluate((l) => [...document.querySelectorAll('.chip-pop .eye-row')]
      .find((r) => r.querySelector('.eye-label')?.textContent === l).click(), label);
    await page.waitForFunction(([l, was]) => {
      const row = [...document.querySelectorAll('.chip-pop .eye-row')].find((r) => r.querySelector('.eye-label')?.textContent === l);
      return row && row.getAttribute('aria-checked') !== was;
    }, [label, before], { timeout: 5000 });
  };

  test('a folded block keeps its values as one line of chips (Issue #89)', async () => {
    const page = await open(order.id);
    await page.waitForSelector('.entity-values .fieldrow');
    assert.equal(await summaryFields(page), null, 'open: no summary is drawn');
    await page.click(`${HEAD} .doc-caret`);
    await page.waitForFunction(() => !document.querySelector('.entity-values-summary')?.classList.contains('hidden'));
    assert.equal(await folded(page), true);
    assert.deepEqual(await summaryFields(page), ['Vendor', 'Qty', 'Stage'], 'every shown value field, in field order — the hidden one is not there');
    const chip = await page.$eval('.wv-sum[data-field="Vendor"]', (n) => ({
      label: n.querySelector('.wv-sum-label')?.textContent, value: n.querySelector('input')?.value ?? n.textContent,
      title: n.getAttribute('title'),
    }));
    assert.equal(chip.label, 'Vendor');
    assert.equal(chip.value, 'Nordic', 'the chip carries the value, drawn by the row editor');
    assert.equal(chip.title, 'Who we bought from — the legal name on the invoice', 'the field description rides the chip as its tooltip (Issue #209)');
    const stage = await page.$eval('.wv-sum[data-field="Stage"] .k', (n) => n.textContent.trim());
    assert.equal(stage, 'Sent', 'a select is its chip, not a plain string');
    // The chips sit on one wrapping line above the document, well under the rows' height.
    const box = await page.$eval('.entity-values-summary', (n) => n.getBoundingClientRect().height);
    assert.ok(box < 80, `three chips fold to one line (${box}px)`);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.entity-values-summary:not(.hidden) .wv-sum');
    assert.equal(await folded(page), true, 'a reload opens the page folded, chips and all');
    await page.click(`${HEAD} .doc-caret`);
    await page.waitForFunction(() => !document.querySelector('.entity-values').classList.contains('hidden'));
    assert.equal(await summaryFields(page), null, 'unfolded, the chips go and the rows return');
    await page.close();
  });

  test('a folded chip edits in place, like a grid cell', async () => {
    const page = await open(order.id);
    await page.waitForSelector('.entity-values .fieldrow');
    await page.click(`${HEAD} .doc-caret`);
    await page.waitForSelector('.entity-values-summary:not(.hidden) .wv-sum[data-field="Vendor"] input');
    await page.fill('.wv-sum[data-field="Vendor"] input', 'Nordic Semi');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.entity-values-summary:not(.hidden) .wv-sum[data-field="Vendor"] input')?.value === 'Nordic Semi', null, { timeout: 5000 });
    const saved = await page.evaluate(async (id) => (await fetch(`api/entities/${id}`).then((r) => r.json())).fields.Vendor, order.id);
    assert.equal(saved, 'Nordic Semi', 'the edit reached the engine');
    await page.close();
  });

  test('a field the eye turns on is drawn, folded or open (Issue #129)', async () => {
    const page = await open(order.id);
    await page.waitForSelector('.entity-values .fieldrow');
    if (!(await folded(page))) {
      await page.click(`${HEAD} .doc-caret`);
      await page.waitForFunction(() => document.querySelector('.entity-values').classList.contains('hidden'));
    }
    await page.click('#main .eye-btn');
    await page.waitForSelector('.chip-pop .eye-row');
    await flip(page, 'Ref');
    await page.waitForSelector('.entity-values-summary:not(.hidden) .wv-sum[data-field="Ref"]', { timeout: 5000 });
    assert.equal(await folded(page), true, 'the block stays folded — the reader did not ask for the rows');
    await flip(page, 'Created At');
    await page.waitForSelector('.entity-values-summary:not(.hidden) .wv-sum[data-field="Created At"]', { timeout: 5000 });
    await page.mouse.click(4, 4);
    await page.click(`${HEAD} .doc-caret`);
    await page.waitForFunction(() => !document.querySelector('.entity-values').classList.contains('hidden'));
    assert.ok(await page.isVisible('.entity-values .fieldrow[data-field="Ref"]'), 'open, the field is a row');
    assert.ok(await page.$('.entity-values .fieldrow-system[data-field="Created At"]'), 'and the System toggle is a read-only row');
    await page.close();
  });

  test('a table with no drawn fields grows its block when one is turned on (Issue #129)', async () => {
    const page = await open(bareRow.id);
    assert.equal(await page.$('[data-block="@values"]'), null, 'nothing to draw, no block');
    await page.click('#main .eye-btn');
    await page.waitForSelector('.chip-pop .eye-row');
    await flip(page, 'Topic');
    await page.waitForSelector('.entity-values .fieldrow[data-field="Topic"]', { timeout: 5000 });
    assert.equal(await page.$eval('.fieldrow[data-field="Topic"] input', (n) => n.value), 'Weds');
    await page.close();
  });
}
