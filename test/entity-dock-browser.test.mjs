/* The entity dock, driven through a real browser (one entity surface,
   change 2). The core's rules are covered in entity-surface-core.test.mjs;
   what needs a browser is the wiring: the #id link docks the entity beside
   the table instead of navigating, the docked row keeps its light, Esc
   closes, and a second open swaps the pane in place.
   Playwright is NOT a dependency of weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const APP = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('app.js parses with the dock wired in', () => {
  assert.doesNotThrow(() => new Function(APP), 'public/app.js does not parse');
});

test('the dock panel and its core ship in the page shell', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('id="dock"'), 'index.html carries the #dock panel');
  assert.ok(html.includes('entity-surface-core.js'), 'index.html loads the surface core');
});

const chromium = await import('playwright')
  .then((pw) => pw.chromium)
  .catch(() => null);

if (!chromium) {
  test('entity dock (browser)', { skip: 'playwright not installed' }, () => {});
} else {
  let server, base, browser, weave, deals, a, b;
  test.before(async () => {
    weave = new Weave();
    weave.createSpace({ name: 'Sales' });
    deals = weave.createTable({ space: 'Sales', name: 'Deals' });
    a = weave.createEntity(deals, { name: 'Acme Working Capital' });
    b = weave.createEntity(deals, { name: 'Bluefin Renewal' });
    ({ server } = await startServer(weave, { port: 0 }));
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
  });
  test.after(async () => {
    await browser?.close();
    server?.close();
  });

  async function freshTablePage() {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    return page;
  }

  test('the #id link docks the entity beside the table; the hash stays put', async () => {
    const page = await freshTablePage();
    await page.click(`tr[data-eid="${a.id}"] .open-link`);
    await page.waitForSelector('#dock:not([hidden]) .name-edit');
    assert.equal(await page.inputValue('#dock .name-edit'), 'Acme Working Capital');
    assert.ok((await page.evaluate(() => location.hash)).startsWith('#/table/'), 'docking is not a navigation');
    await page.close();
  });

  test('the docked row keeps its light; opening another row swaps the pane', async () => {
    const page = await freshTablePage();
    await page.click(`tr[data-eid="${a.id}"] .open-link`);
    await page.waitForSelector(`tr[data-eid="${a.id}"].row-docked`);
    await page.click(`tr[data-eid="${b.id}"] .open-link`);
    await page.waitForSelector(`tr[data-eid="${b.id}"].row-docked`);
    assert.equal(await page.inputValue('#dock .name-edit'), 'Bluefin Renewal');
    assert.equal(await page.locator('tr.row-docked').count(), 1, 'exactly one row carries the light');
    await page.close();
  });

  test('Escape closes the dock and the light goes out', async () => {
    const page = await freshTablePage();
    await page.click(`tr[data-eid="${a.id}"] .open-link`);
    await page.waitForSelector('#dock:not([hidden])');
    // Park focus on inert chrome — a click into the grid would raise a cell
    // editor and Escape would rightly go to it instead of the dock.
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Escape');
    await page.waitForSelector('#dock', { state: 'hidden' });
    assert.equal(await page.locator('tr.row-docked').count(), 0);
    await page.close();
  });

  test('the dock close button closes it too', async () => {
    const page = await freshTablePage();
    await page.click(`tr[data-eid="${a.id}"] .open-link`);
    await page.waitForSelector('#dock:not([hidden])');
    await page.click('#dock .dock-head button[title^="Close"]');
    await page.waitForSelector('#dock', { state: 'hidden' });
    await page.close();
  });
}
