import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let deals, accounts, acme, big, small, sprints;
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
  sprints = weave.createTable({ space: 'Sales', name: 'Sprint' });
  weave.addField(sprints, { name: 'Points', type: 'number', config: { display: 'bar' } });
  weave.addField(sprints, { name: 'Unset', type: 'number', config: { display: 'bar' } });
  weave.createEntity(sprints, { name: 'One', values: { Points: 72 } });
  weave.createEntity(sprints, { name: 'Two', values: { Points: 100 } });
  weave.createEntity(sprints, { name: 'Three', values: { Points: 15 } });
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
  async function openFieldDialog(page, field) {
    const th = page.locator('.wv-grid thead th.col-head', { hasText: field }).first();
    await th.hover();
    await th.locator('.field-menu').click();
    await page.locator('.chip-pop .wv-menu-row', { hasText: 'Edit field' }).click();
    await page.waitForSelector('.tray-form');
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
        const C = 2 * Math.PI * 7;
        assert.equal((await fill(page, cell(big.id, 'Score'))).dash.split(' ')[0], String(Math.round(C * 100) / 100));
        assert.equal((await fill(page, cell(small.id, 'Score'))).dash.split(' ')[0], String(Math.round(C * 0.25 * 100) / 100));
        const hot = Number((await fill(page, cell(big.id, 'Heat'))).opacity);
        const cool = Number((await fill(page, cell(small.id, 'Heat'))).opacity);
        assert.ok(hot > cool, `the hotter row is more tinted (${hot} > ${cool})`);
        assert.equal(await page.locator(`${cell(big.id, 'Plain')} svg`).count(), 0, 'a plain number draws no graphic');
        assert.equal((await fill(page, cell(small.id, 'Double'))).width, '25');
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
        await openFieldDialog(page, 'Plain');
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

    test(`the Sample draws the column's own figures against the column's max (${colorScheme})`, async () => {
      const page = await grid(sprints.id, colorScheme);
      try {
        await openFieldDialog(page, 'Points');
        await page.waitForSelector('.tray-form .cg-preview .cg-wrap.cg-bar');
        assert.deepEqual(await page.$$eval('.tray-form .cg-preview .cg-wrap', (ns) => ns.map((n) => n.getAttribute('aria-label'))),
          ['15', '72', '100'], "the field's own values, smallest first");
        assert.deepEqual(await page.$$eval('.tray-form .cg-preview .cg-fill', (ns) => ns.map((n) => n.getAttribute('width'))),
          ['15', '72', '100'], '100% is the column max of 100');
        assert.equal(await page.locator('.tray-form .cg-preview-note').count(), 0, 'real values are not examples');
        const scale = page.locator('.tray-form .dlg-sec', { has: page.locator('.dlg-lbl', { hasText: /^Scale$/ }) });
        await scale.locator('.seg-opt', { hasText: 'fixed' }).click();
        await page.locator('.tray-form input[aria-label="Fixed scale"]').fill('200');
        await page.waitForFunction(() => document.querySelector('.tray-form .cg-preview .cg-fill')?.getAttribute('width') === '7.5');
        assert.deepEqual(await page.$$eval('.tray-form .cg-preview .cg-wrap', (ns) => ns.map((n) => n.getAttribute('aria-label'))), ['15', '72', '100']);
        if (shots) await page.locator('.tray-form').screenshot({ path: `${shots}/number-display-sample-${colorScheme}.png` });
      } finally { await page.close(); }
    });

    test(`an empty column samples examples and says so (${colorScheme})`, async () => {
      const page = await grid(sprints.id, colorScheme);
      try {
        await openFieldDialog(page, 'Unset');
        await page.waitForSelector('.tray-form .cg-preview .cg-wrap.cg-bar');
        assert.deepEqual(await page.$$eval('.tray-form .cg-preview .cg-wrap', (ns) => ns.map((n) => n.getAttribute('aria-label'))),
          ['25', '60', '100'], 'a quarter, three fifths and the whole of the scale');
        assert.match(await page.textContent('.tray-form .cg-preview-note'), /[Ee]xample/, 'labelled as an example, not read as a value');
      } finally { await page.close(); }
    });
  }
}
