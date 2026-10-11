import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, styleOf } from './lib/browser.mjs';

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
    const glyph = await page.$eval(`${HEAD} .opt-grip`, (n) => ({ text: n.textContent.trim(), icon: !!n.querySelector('.wv-icon') }));
    assert.equal(glyph.text, '', 'no text glyph — the ⠿ character sat beside Lucide grips and read as stray dots');
    assert.ok(glyph.icon, 'the anchor draws the same grip icon a row wears');
    await page.click(`${HEAD} .doc-caret`);
    await page.waitForFunction(() => document.querySelector('.entity-values').classList.contains('hidden'));
    await page.mouse.move(2, 2);
    const focused = await page.evaluate(() => document.activeElement?.className ?? '');
    assert.match(focused, /doc-caret/, 'the caret keeps focus after the click (that is what used to light the grip)');
    const grip = page.locator(`${HEAD} .opt-grip`);
    assert.equal(await styleOf(grip, 'opacity', '0'), '0', 'the grip is not lit once the pointer has gone');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    if (/doc-caret/.test(await page.evaluate(() => document.activeElement?.className ?? ''))) {
      assert.equal(await styleOf(grip, 'opacity', '1'), '1', 'a keyboard focus lights the grip');
    }
    await page.close();
  });

  test('a document section\'s ⋮ and anchors rest after its caret is clicked, too (Issue #210)', async () => {
    const page = await open(order.id);
    await page.waitForSelector('.doc-section .doc-caret');
    await page.click('.doc-section .doc-caret');
    await page.mouse.move(2, 2);
    await page.waitForTimeout(250);
    assert.equal(await page.$eval('.doc-section .doc-dl > .dots-btn', (n) => getComputedStyle(n).opacity), '0', 'the downloads ⋮ is not lit by the click');
    await page.close();
  });

  test('the Appears-as strip follows the eye: hidden views are not drawn (Issue #208)', async () => {
    const page = await open(order.id);
    assert.equal(await page.$('.wv-appears'), null, 'Chip and Card are minted hidden, so the strip is not there');
    weave.updateTable(orders, { hiddenFields: (weave.describeSchema().flatMap((sp) => sp.tables).find((t) => t.id === orders.id).hiddenFields ?? []).filter((n) => n !== 'Chip') });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-appears');
    const slots = await page.$$eval('.wv-appears-slot', (ns) => ns.map((n) => n.className));
    assert.deepEqual(slots, ['wv-appears-slot wv-appears-chip'], 'only the unhidden view is drawn');
    await page.goto(`${base}/#/table/${orders.id}`, { waitUntil: 'networkidle' });
    await page.click(`tr[data-eid="${order.id}"] .open-link`);
    await page.waitForSelector('#dock:not([hidden]) .wv-appears');
    assert.deepEqual(await page.$$eval('#dock .wv-appears-slot', (ns) => ns.map((n) => n.className)), ['wv-appears-slot wv-appears-chip']);
    await page.close();
  });
}
