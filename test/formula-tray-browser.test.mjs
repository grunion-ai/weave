import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let accts;
const s = await launch('formula tray layout', (weave) => {
  weave.createSpace({ name: 'Sales' });
  accts = weave.createTable({ space: 'Sales', name: 'Account' });
  const deals = weave.createTable({ space: 'Sales', name: 'Deal' });
  for (let i = 1; i <= 24; i++) weave.addField(accts, { name: `Metric ${i}`, type: 'number' });
  weave.addField(deals, { name: 'Amount', type: 'number' });
  weave.addField(deals, { name: 'Close', type: 'date' });
  weave.addRelation(deals, { name: 'Account', targetDb: accts, cardinality: 'many-to-one', inverseName: 'Deals' });
  weave.addField(accts, { name: 'Amounts', type: 'lookup', config: { relationField: 'Deals', targetField: 'Amount' } });
  weave.addField(accts, { name: 'Closes', type: 'lookup', config: { relationField: 'Deals', targetField: 'Close' } });
  weave.addField(accts, { name: 'Trend', type: 'formula', config: { expression: 'sortby([Amounts], [Closes])', display: 'sparkline', style: 'line' } });
  weave.addField(accts, { name: 'Double', type: 'formula', config: { expression: '[Metric 1] * 2', display: 'bar' } });
  const acme = weave.createEntity(accts, { name: 'Acme', values: { 'Metric 1': 4 } });
  for (const [amt, close] of [[41, '2026-01-01'], [29, '2026-02-01']]) weave.createEntity(deals, { name: `d${amt}`, values: { Amount: amt, Close: close, Account: acme.id } });
});

if (s) {
  const { base, browser } = s;
  const shots = process.env.WEAVE_SHOT_DIR;
  async function grid(colorScheme = 'light') {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, colorScheme });
    await page.goto(`${base}/#/table/${accts.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    return page;
  }
  async function openFieldDialog(page, field) {
    const th = page.locator('.wv-grid thead th.col-head', { hasText: field }).first();
    await th.scrollIntoViewIfNeeded();
    await th.hover();
    await th.locator('.field-menu').click();
    await page.locator('.chip-pop .wv-menu-row', { hasText: 'Edit field' }).click();
    await page.waitForSelector('.tray-form');
  }
  const section = (page, label) => page.locator(`.tray-form .dlg-sec:has(> .dlg-lbl:text-is("${label}"))`);
  const unscrolledInView = (page, label) => page.evaluate((lbl) => {
    const body = document.querySelector('.tray-body');
    const sec = [...document.querySelectorAll('.tray-form .dlg-sec')].find((s) => s.querySelector(':scope > .dlg-lbl')?.textContent === lbl);
    if (!body || !sec) return { found: false };
    const b = body.getBoundingClientRect(), r = sec.getBoundingClientRect();
    return { found: true, scrollTop: body.scrollTop, top: Math.round(r.top), bottom: Math.round(r.bottom), limit: Math.round(Math.min(b.bottom, innerHeight)) };
  }, label);

  for (const colorScheme of ['light', 'dark']) {
    test(`a sparkline formula's Display, Style, Color and Sample sit under the result, on screen in a 1000px window (${colorScheme})`, async () => {
      const page = await grid(colorScheme);
      try {
        await openFieldDialog(page, 'Trend');
        await page.locator('.tray-form .cg-spark-preview .cg-sparkwrap').waitFor();
        for (const lbl of ['Display', 'Style', 'Color', 'Sample']) {
          const v = await unscrolledInView(page, lbl);
          assert.ok(v.found, `${lbl} is in the tray`);
          assert.equal(v.scrollTop, 0, 'the tray has not scrolled');
          assert.ok(v.bottom <= v.limit, `${lbl} ends at ${v.bottom}px, inside the ${v.limit}px the tray shows`);
        }
        const order = await page.evaluate(() => {
          const at = (sel) => document.querySelector(sel)?.getBoundingClientRect().top ?? -1;
          const display = [...document.querySelectorAll('.tray-form .dlg-sec')].find((s) => s.querySelector(':scope > .dlg-lbl')?.textContent === 'Display');
          return [at('.tray-form .fx-status'), display.getBoundingClientRect().top, at('.tray-form .fx-ref')];
        });
        assert.ok(order[0] < order[1] && order[1] < order[2], `status → Display → reference (${order})`);
        const ref = page.locator('.tray-form details.fx-ref');
        assert.equal(await ref.evaluate((d) => d.open), false, 'closed once a formula exists');
        assert.equal(await page.locator('.tray-form .fx-chip.fn').first().isVisible(), false);
        await ref.locator('summary').click();
        assert.ok(await page.locator('.tray-form .fx-chip.fn').first().isVisible(), 'the summary opens them');
        assert.ok(await page.locator('.tray-form .fx-chip:not(.fn)', { hasText: 'Metric 24' }).count(), 'every field is still offered');
        if (shots) {
          await ref.locator('summary').click();
          await page.locator('#tray').screenshot({ path: `${shots}/formula-tray-${colorScheme}.png` });
        }
      } finally { await page.close(); }
    });
  }

  test("a numeric formula's Display is on screen too, and the Formula box says what unticking does", async () => {
    const page = await grid();
    try {
      await openFieldDialog(page, 'Double');
      await section(page, 'Display').waitFor();
      const v = await unscrolledInView(page, 'Display');
      assert.ok(v.bottom <= v.limit, `Display ends at ${v.bottom}px of ${v.limit}`);
      assert.match(await page.textContent('.tray-form .fx-toggle .fx-hint'), /untick to freeze each row’s result into plain text/);
    } finally { await page.close(); }
  });

  test('a new formula opens with the chips out, and the box says what ticking does', async () => {
    const page = await grid();
    try {
      await page.click('.wv-grid .add-field-btn');
      await page.waitForSelector('#tray');
      assert.match(await page.textContent('#tray .fx-toggle .fx-hint'), /compute this field from the row’s other fields/);
      await page.locator('#tray .fx-toggle input').check();
      await page.waitForSelector('#tray .fx-expr');
      assert.equal(await page.locator('#tray details.fx-ref').evaluate((d) => d.open), true, 'nothing written yet: the reference is open');
      assert.ok(await page.locator('#tray .fx-chip.fn').first().isVisible());
    } finally { await page.close(); }
  });
}
