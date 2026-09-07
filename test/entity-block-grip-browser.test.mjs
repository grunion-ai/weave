/* The entity page's block chrome, driven through a real browser.

   Issue #210 — "visual dots artifact when hiding fields": clicking the
   fold caret left the block's ⠿ anchor lit after the pointer had gone,
   because the caret kept focus and the anchor showed on :focus-within. The
   anchor is now the same Lucide grip every row wears, and it lights for a
   hover or a keyboard focus (:focus-visible) — never for a mouse click.

   Issue #208 — "appears as is hidden and should not show": the Appears-as
   strip follows the eye — a hidden Chip or Card is not drawn there either.

   Playwright is NOT a dependency of weave; it is imported dynamically and
   the suite skips when absent, so `node --test` stays green on a bare checkout. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let orders, order;

const s = await launch('entity block grip', (weave) => {
  weave.createSpace({ name: 'Ops' });
  orders = weave.createTable({ space: 'Ops', name: 'Order' });
  weave.addField(orders, { name: 'Vendor', type: 'text' });
  weave.addField(orders, { name: 'Brief', type: 'document' });
  order = weave.createEntity(orders, { name: 'Sensor boards', values: { Vendor: 'Nordic' } });
});

if (s) {
  const { base, browser, weave } = s;
  const HEAD = '[data-block="@values"] .block-head';
  const open = async (id) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.name-edit');
    return page;
  };

  test('the block anchor is the row grip, and a caret click does not leave it lit (Issue #210)', async () => {
    const page = await open(order.id);
    await page.waitForSelector('.entity-values .fieldrow');
    const grip = await page.$eval(`${HEAD} .opt-grip`, (n) => ({ text: n.textContent.trim(), icon: !!n.querySelector('.wv-icon') }));
    assert.equal(grip.text, '', 'no text glyph — the ⠿ character sat beside Lucide grips and read as stray dots');
    assert.ok(grip.icon, 'the anchor draws the same grip icon a row wears');
    await page.click(`${HEAD} .doc-caret`);
    await page.waitForFunction(() => document.querySelector('.entity-values').classList.contains('hidden'));
    await page.mouse.move(2, 2);
    await page.waitForTimeout(250);
    const focused = await page.evaluate(() => document.activeElement?.className ?? '');
    assert.match(focused, /doc-caret/, 'the caret keeps focus after the click (that is what used to light the grip)');
    assert.equal(await page.$eval(`${HEAD} .opt-grip`, (n) => getComputedStyle(n).opacity), '0', 'the grip is not lit once the pointer has gone');
    // A keyboard reader still sees the handle: Tab onto the caret lights it.
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(150);
    const kb = await page.evaluate(() => ({
      active: document.activeElement?.className ?? '',
      lit: getComputedStyle(document.querySelector('[data-block="@values"] .block-head .opt-grip')).opacity,
    }));
    if (/doc-caret/.test(kb.active)) assert.equal(kb.lit, '1', 'a keyboard focus lights the grip');
    await page.close();
  });

  test('a document section\'s ⋮ and anchors rest after its caret is clicked, too (Issue #210)', async () => {
    const page = await open(order.id);
    await page.waitForSelector('.doc-section .doc-caret');
    await page.click('.doc-section .doc-caret');
    await page.mouse.move(2, 2);
    await page.waitForTimeout(250);
    assert.equal(await page.$eval('.doc-section .doc-dl', (n) => getComputedStyle(n).opacity), '0', 'the downloads ⋮ is not lit by the click');
    await page.close();
  });

  test('the Appears-as strip follows the eye: hidden views are not drawn (Issue #208)', async () => {
    const page = await open(order.id);
    assert.equal(await page.$('.wv-appears'), null, 'Chip and Card are minted hidden, so the strip is not there');
    weave.updateTable(orders, { hiddenFields: (weave.getTable(orders).hiddenFields ?? []).filter((n) => n !== 'Chip') });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-appears');
    const slots = await page.$$eval('.wv-appears-slot', (ns) => ns.map((n) => n.className));
    assert.deepEqual(slots, ['wv-appears-slot wv-appears-chip'], 'only the unhidden view is drawn');
    // Docked beside the table, the same rule: the pane is the same view.
    await page.goto(`${base}/#/table/${orders.id}`, { waitUntil: 'networkidle' });
    await page.click(`tr[data-eid="${order.id}"] .open-link`);
    await page.waitForSelector('#dock:not([hidden]) .wv-appears');
    assert.deepEqual(await page.$$eval('#dock .wv-appears-slot', (ns) => ns.map((n) => n.className)), ['wv-appears-slot wv-appears-chip']);
    await page.close();
  });
}
