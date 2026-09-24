/* Feature #230 in the page: a number column with a display draws a bar, a
   ring or a heat tint in its grid cell, beside the value's own text, against
   the column's max or a fixed scale. The graphic cell is never marked
   clipped, a click still hands over the raw number, a numeric formula and a
   rollup draw the same way, a chip and a card carry the meter, and the field
   dialog's Display picker previews the choice live. Both themes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let deals, accounts, acme, big, small;
const s = await launch('number display costume', (weave) => {
  weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deal' });
  accounts = weave.createTable({ space: 'Sales', name: 'Account' });
  weave.addField(deals, { name: 'Progress', type: 'number', config: { format: 'percent', display: 'bar', scale: 1 } });
  weave.addField(deals, { name: 'Score', type: 'number', config: { display: 'ring' } });
  weave.addField(deals, { name: 'Heat', type: 'number', config: { display: 'heat', scale: 10 } });
  weave.addField(deals, { name: 'Plain', type: 'number' });
  weave.addField(deals, { name: 'Double', type: 'formula', config: { expression: '[Score] * 2', display: 'bar' } });
  weave.addRelation(deals, { name: 'Account', targetDb: accounts, cardinality: 'many-to-one', inverseName: 'Deals' });
  weave.addField(accounts, { name: 'Avg progress', type: 'rollup', config: { relationField: 'Deals', targetField: 'Progress', aggregate: 'avg' } });
  acme = weave.createEntity(accounts, { name: 'Acme' });
  big = weave.createEntity(deals, { name: 'Big', values: { Progress: 0.6, Score: 8, Heat: 9, Plain: 3, Account: acme.id } });
  small = weave.createEntity(deals, { name: 'Small', values: { Progress: 0.2, Score: 2, Heat: 1, Plain: 4, Account: acme.id } });
  // The chip of a deal shows its progress; the account grid shows it on the relation.
  weave.updateField(deals, 'Chip', { config: { fields: ['Progress'] } });
});

if (s) {
  const { base, browser, weave } = s;
  const shots = process.env.WEAVE_SHOT_DIR;
  const cell = (id, field) => `tr[data-eid="${id}"] td[data-field="${field}"]`;
  async function grid(tableId, colorScheme = 'light', width = 1400) {
    const page = await browser.newPage({ viewport: { width, height: 700 }, colorScheme });
    await page.goto(`${base}/#/table/${tableId}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    return page;
  }
  const fill = (page, sel) => page.$eval(`${sel} .cg-fill`, (n) => ({ width: n.getAttribute('width'), dash: n.getAttribute('stroke-dasharray'), opacity: n.getAttribute('fill-opacity') }));

  for (const colorScheme of ['light', 'dark']) {
    test(`bar, ring and heat draw in the grid against their scale, with the text beside them (${colorScheme})`, async () => {
      const page = await grid(deals.id, colorScheme);
      try {
        await page.waitForSelector(`${cell(big.id, 'Progress')} .cg-wrap.cg-bar svg`);
        assert.equal((await fill(page, cell(big.id, 'Progress'))).width, '60', 'a fixed scale of 1: 0.6 is 60%');
        assert.equal(await page.getAttribute(`${cell(big.id, 'Progress')} .cg-wrap`, 'aria-label'), '60%', 'a screen reader reads the value');
        assert.equal(await page.textContent(`${cell(big.id, 'Progress')} .cg-text`), '60%');
        // Score is on the column scale: 8 is the max, so Big is full and Small a quarter.
        const C = 2 * Math.PI * 7;
        assert.equal((await fill(page, cell(big.id, 'Score'))).dash.split(' ')[0], String(Math.round(C * 100) / 100));
        assert.equal((await fill(page, cell(small.id, 'Score'))).dash.split(' ')[0], String(Math.round(C * 0.25 * 100) / 100));
        const hot = Number((await fill(page, cell(big.id, 'Heat'))).opacity);
        const cool = Number((await fill(page, cell(small.id, 'Heat'))).opacity);
        assert.ok(hot > cool, `the hotter row is more tinted (${hot} > ${cool})`);
        assert.equal(await page.locator(`${cell(big.id, 'Plain')} svg`).count(), 0, 'a plain number draws no graphic');
        // The formula wears its bar on the column scale: 16 is the max.
        assert.equal((await fill(page, cell(small.id, 'Double'))).width, '25');
        // The heat text stays legible: the tint sits behind it.
        const color = await page.$eval(`${cell(big.id, 'Heat')} .cg-text`, (n) => getComputedStyle(n).color);
        assert.ok(color && color !== 'rgba(0, 0, 0, 0)', color);
        if (shots) await page.locator('.wv-grid').screenshot({ path: `${shots}/number-display-grid-${colorScheme}.png` });
      } finally { await page.close(); }
    });
  }

  test('a graphic cell in a narrow column is never marked clipped', async () => {
    weave.updateField(deals, 'Progress', { config: { width: 70 } });
    const page = await grid(deals.id);
    try {
      await page.waitForSelector(`${cell(big.id, 'Progress')} .cg-wrap`);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      assert.equal(await page.$eval(cell(big.id, 'Progress'), (td) => td.classList.contains('clipped')), false);
    } finally {
      await page.close();
      weave.updateField(deals, 'Progress', { config: { width: null } });
    }
  });

  test('a click on the graphic hands over the raw number, and the commit redraws', async () => {
    const page = await grid(deals.id);
    try {
      await page.click(`${cell(small.id, 'Score')} .cg-wrap`);
      const input = page.locator(`${cell(small.id, 'Score')} input.inline-edit`);
      await input.waitFor();
      assert.equal(await input.inputValue(), '2', 'the box holds the stored number');
      const landed = page.waitForResponse((r) => r.request().method() === 'PATCH');
      await input.fill('4');
      await input.press('Enter');
      await landed;
      assert.equal(weave.getEntity(small.id).values[weave.getField(deals, 'Score').id], 4);
      await page.waitForFunction((sel) => document.querySelector(sel)?.getAttribute('aria-label') === '4', `${cell(small.id, 'Score')} .cg-wrap`);
    } finally {
      await page.close();
      weave.updateEntity(small.id, { Score: 2 });
    }
  });

  test('a rollup wears the display of the column it summarises; the chip and the card carry the meter', async () => {
    const page = await grid(accounts.id);
    try {
      await page.waitForSelector(`${cell(acme.id, 'Avg progress')} .cg-wrap.cg-bar`);
      assert.equal((await fill(page, cell(acme.id, 'Avg progress'))).width, '40', 'the average of 60% and 20%');
      // The relation chips on the account: open a chip's fields.
      const chip = page.locator(`${cell(acme.id, 'Deals')} .mention-wrap`).first();
      await chip.locator('.mention-caret').click();
      await page.waitForSelector(`${cell(acme.id, 'Deals')} .mention-f .cg-wrap.cg-bar`);
      if (shots) await page.locator('.wv-grid').screenshot({ path: `${shots}/number-display-rollup-chip.png` });
    } finally { await page.close(); }
    const card = weave.renderView(big.id, 'card', { config: { fields: ['Progress', 'Score'] } });
    assert.deepEqual(card.fields.map((f) => f.meter?.display), ['bar', 'ring']);
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`the field dialog's Display picker previews the choice live and saves it (${colorScheme})`, async () => {
      const page = await grid(deals.id, colorScheme);
      try {
        const th = page.locator('.wv-grid thead th.col-head', { hasText: 'Plain' }).first();
        await th.hover();
        await th.locator('.field-menu').click();
        await page.locator('.chip-pop .wv-menu-row', { hasText: 'Edit field' }).click();
        const display = page.locator('.tray-form .dlg-sec', { has: page.locator('.dlg-lbl', { hasText: /^Display$/ }) });
        await display.waitFor();
        assert.equal(await page.locator('.tray-form .cg-preview').count(), 0, 'text has nothing to preview');
        await display.locator('.seg-opt', { hasText: 'ring' }).click();
        await page.waitForSelector('.tray-form .cg-preview .cg-wrap.cg-ring');
        assert.equal(await page.locator('.tray-form .cg-preview .cg-wrap').count(), 3, 'three sample rows');
        await display.locator('.seg-opt', { hasText: 'bar' }).click();
        await page.waitForSelector('.tray-form .cg-preview .cg-wrap.cg-bar');
        const scale = page.locator('.tray-form .dlg-sec', { has: page.locator('.dlg-lbl', { hasText: /^Scale$/ }) });
        await scale.locator('.seg-opt', { hasText: 'fixed' }).click();
        const box = page.locator('.tray-form input[aria-label="Fixed scale"]');
        await box.fill('5');
        if (shots) await page.locator('.tray-form').screenshot({ path: `${shots}/number-display-dialog-${colorScheme}.png` });
        await page.locator('.tray-form button[type="submit"]').click();
        await page.waitForFunction(() => !document.querySelector('.tray-form'));
        const f = weave.getField(deals, 'Plain');
        assert.equal(f.config.display, 'bar');
        assert.equal(f.config.scale, 5);
        await page.waitForSelector(`${cell(big.id, 'Plain')} .cg-wrap.cg-bar`);
        assert.equal((await fill(page, cell(big.id, 'Plain'))).width, '60', '3 of a fixed 5');
      } finally {
        await page.close();
        weave.updateField(deals, 'Plain', { config: { display: 'text', scale: null } });
      }
    });
  }
}
