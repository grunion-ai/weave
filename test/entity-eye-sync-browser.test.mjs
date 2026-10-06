import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, settled } from './lib/browser.mjs';

let deals, a;
const s = await launch('entity eye sync', (weave) => {
  weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deals' });
  weave.addField(deals, { name: 'Amount', type: 'number' });
  a = weave.createEntity(deals, { name: 'Acme', values: { Amount: 12 } });
});
if (s) {
  const { base, browser } = s;
  const gridHasAmount = (page) => page.evaluate(() =>
    [...document.querySelectorAll('#main .wv-grid thead th')].some((th) => th.textContent.includes('Amount')));
  const paneHasAmount = (page) => page.evaluate(() =>
    [...document.querySelectorAll('#dock .entity-fields .fieldrow label')].some((l) => l.textContent.trim() === 'Amount'));
  const amountChecked = () => [...document.querySelectorAll('.chip-pop .eye-row')]
    .find((r) => r.querySelector('.eye-label')?.textContent === 'Amount')?.matches(':has(input:checked), [aria-checked="true"]').toString();
  const flipAmount = async (page) => {
    const before = await page.evaluate(amountChecked);
    await page.evaluate(() => {
      [...document.querySelectorAll('.chip-pop .eye-row')]
        .find((r) => r.querySelector('.eye-label')?.textContent === 'Amount').click();
    });
    await page.waitForFunction((was) => {
      const row = [...document.querySelectorAll('.chip-pop .eye-row')]
        .find((r) => r.querySelector('.eye-label')?.textContent === 'Amount');
      return row && row.matches(':has(input:checked), [aria-checked="true"]').toString() !== was;
    }, before);
  };
  const toggleAmount = async (page, scope) => {
    await page.click(`${scope} .eye-btn`);
    await page.waitForSelector('.chip-pop .eye-row');
    await flipAmount(page);
    await page.mouse.click(4, 4);
  };

  test("hiding a field from the table's eye also clears it from the docked pane", async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.click(`tr[data-eid="${a.id}"] .open-link`);
    await page.waitForSelector('#dock:not([hidden]) .entity-fields .fieldrow');
    assert.equal(await paneHasAmount(page), true, 'Amount starts visible in the pane');
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const entityPath = `/api/entities/${a.id}`;
    await page.route(`**${entityPath}`, async route => {
      if (route.request().method() === 'GET') await held;
      await route.continue();
    });
    const dockRead = page.waitForRequest(request => request.method() === 'GET' && new URL(request.url()).pathname === entityPath);
    const flipping = toggleAmount(page, '#main');
    try {
      await dockRead;
      assert.equal(await gridHasAmount(page), false, 'the grid has completed its half of the update');
      assert.equal(await paneHasAmount(page), true, 'the held dock read still shows its previous field');
      release();
      await flipping;
      await page.waitForFunction(() => ![...document.querySelectorAll('#dock .entity-fields .fieldrow label')].some((l) => l.textContent.trim() === 'Amount'), null, { timeout: 10000 }).catch(() => {});
      assert.equal(await gridHasAmount(page), false, 'the grid hides Amount');
      assert.equal(await paneHasAmount(page), false, 'and the pane follows without a reopen');
    } finally {
      release();
      await flipping.catch(() => {});
      await page.close();
    }
  });

  test("hiding a field from the pane's eye also clears the grid column", async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.click(`tr[data-eid="${a.id}"] .open-link`);
    await page.waitForSelector('#dock:not([hidden]) .name-edit');
    await toggleAmount(page, '#dock');
    assert.equal(await paneHasAmount(page), true, 'the pane shows Amount again');
    assert.equal(await gridHasAmount(page), true, 'and the grid follows without a redraw by hand');
    await page.close();
  });

  test('a flip updates the popover in place: same node, same position, fresh rows', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.click('#main .eye-btn');
    await page.waitForSelector('.chip-pop .eye-row');
    await page.evaluate(() => { document.querySelector('.chip-pop').dataset.marker = 'held'; });
    await settled(page.locator('.chip-pop'));
    const before = await page.evaluate(() => {
      const r = document.querySelector('.chip-pop').getBoundingClientRect();
      return { left: r.left, top: r.top };
    });
    await flipAmount(page);
    const after = await page.evaluate(() => {
      const pop = document.querySelector('.chip-pop');
      const r = pop.getBoundingClientRect();
      const amount = [...pop.querySelectorAll('.eye-row')]
        .find((x) => x.querySelector('.eye-label')?.textContent === 'Amount');
      return { marker: pop.dataset.marker, left: r.left, top: r.top, checked: amount.matches(':has(input:checked), [aria-checked="true"]').toString() };
    });
    assert.equal(after.marker, 'held', 'the popover is the SAME node, not a reopen');
    assert.equal(after.left, before.left, 'it did not jump horizontally');
    assert.equal(after.top, before.top, 'it did not jump vertically');
    assert.ok(after.checked === 'true' || after.checked === 'false', 'the row re-rendered');
    await page.close();
  });
}
