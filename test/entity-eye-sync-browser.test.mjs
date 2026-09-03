/* One hidden set, two visible surfaces (one entity surface; Kyle,
   2026-09-02: "visibility in entity doc is different than in table").
   In the split, a field hidden from either eye must vanish from BOTH the
   grid and the docked entity, immediately — not after a reopen.
   Playwright is NOT a dependency; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const chromium = await import('playwright')
  .then((pw) => pw.chromium)
  .catch(() => null);

if (!chromium) {
  test('entity eye sync (browser)', { skip: 'playwright not installed' }, () => {});
} else {
  let server, base, browser, weave, deals, a;
  test.before(async () => {
    weave = new Weave();
    weave.createSpace({ name: 'Sales' });
    deals = weave.createTable({ space: 'Sales', name: 'Deals' });
    weave.addField(deals, { name: 'Amount', type: 'number' });
    a = weave.createEntity(deals, { name: 'Acme', values: { Amount: 12 } });
    ({ server } = await startServer(weave, { port: 0 }));
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
  });
  test.after(async () => {
    await browser?.close();
    server?.close();
  });

  const gridHasAmount = (page) => page.evaluate(() =>
    [...document.querySelectorAll('#main .wv-grid thead th')].some((th) => th.textContent.includes('Amount')));
  const paneHasAmount = (page) => page.evaluate(() =>
    [...document.querySelectorAll('#dock .entity-fields .fieldrow label')].some((l) => l.textContent.trim() === 'Amount'));
  const toggleAmount = async (page, scope) => {
    await page.click(`${scope} .eye-btn`);
    await page.waitForSelector('.chip-pop .eye-row');
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('.chip-pop .eye-row')]
        .find((r) => r.querySelector('.eye-label')?.textContent === 'Amount');
      row.click();
    });
    // Both surfaces redraw asynchronously (PATCH, schema reload, two
    // renders). Dismiss the reopened popover with a click on neutral
    // chrome, never Escape — with no popover left, Esc would rightly pop
    // the dock itself and the assertions would read an empty pane.
    await page.waitForTimeout(1200);
    await page.mouse.click(4, 4);
  };

  test("hiding a field from the table's eye also clears it from the docked pane", async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.click(`tr[data-eid="${a.id}"] .open-link`);
    await page.waitForSelector('#dock:not([hidden]) .entity-fields .fieldrow');
    assert.equal(await paneHasAmount(page), true, 'Amount starts visible in the pane');
    await toggleAmount(page, '#main');
    assert.equal(await gridHasAmount(page), false, 'the grid hides Amount');
    assert.equal(await paneHasAmount(page), false, 'and the pane follows without a reopen');
    await page.close();
  });

  test("hiding a field from the pane's eye also clears the grid column", async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.click(`tr[data-eid="${a.id}"] .open-link`);
    // Amount is hidden from the previous test, so the pane may hold no
    // fieldrows at all — wait on the name instead.
    await page.waitForSelector('#dock:not([hidden]) .name-edit');
    // The field starts hidden from the previous test's flip; show it again,
    // from the pane, and expect the grid to grow the column back.
    await toggleAmount(page, '#dock');
    assert.equal(await paneHasAmount(page), true, 'the pane shows Amount again');
    assert.equal(await gridHasAmount(page), true, 'and the grid follows without a redraw by hand');
    await page.close();
  });
}
