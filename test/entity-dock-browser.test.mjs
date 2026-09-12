/* The entity dock, driven through a real browser (one entity surface,
   change 2). The core's rules are covered in entity-surface-core.test.mjs;
   what needs a browser is the wiring: the #id link docks the entity beside
   the table instead of navigating, the docked row keeps its light, Esc
   closes, and a second open swaps the pane in place.
   Playwright is NOT a dependency of weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch } from './lib/browser.mjs';



test('the dock panel and its core ship in the page shell', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('id="dock"'), 'index.html carries the #dock panel');
  assert.ok(html.includes('entity-surface-core.js'), 'index.html loads the surface core');
});

let deals, contacts, a, b, jane;
const s = await launch('entity dock', (weave) => {
  weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deals' });
  contacts = weave.createTable({ space: 'Sales', name: 'Contacts' });
  weave.addRelation(deals, { name: 'Contact', targetDb: contacts.id, cardinality: 'many-to-one', inverseName: 'Deals' });
  jane = weave.createEntity(contacts, { name: 'Jane Rivera' });
  a = weave.createEntity(deals, { name: 'Acme Working Capital', Contact: jane.id });
  b = weave.createEntity(deals, { name: 'Bluefin Renewal' });
});
if (s) {
  const { base, browser } = s;
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

  /* The dock is presentation, never a history entry (Issue #198) — but a
     refresh, a new tab and a shared link must still find it. The docked
     entity rides the table hash as ?e=<id>, written with replaceState so
     Back never sees it (Issue #226). */
  test('docking writes ?e=<id> onto the table hash and a reload brings the dock back', async () => {
    const page = await freshTablePage();
    await page.click(`tr[data-eid="${a.id}"] .open-link`);
    await page.waitForSelector('#dock:not([hidden]) .name-edit');
    assert.equal(await page.evaluate(() => location.hash), `#/table/${deals.id}?e=${a.id}`);
    assert.equal(await page.evaluate(() => history.length), 2, 'the dock added no history entry');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#dock:not([hidden]) .name-edit');
    assert.equal(await page.inputValue('#dock .name-edit'), 'Acme Working Capital');
    assert.equal(await page.locator(`tr[data-eid="${a.id}"].row-docked`).count(), 1, 'the row keeps its light after the reload');
    await page.close();
  });

  test('closing the dock strips ?e= so a reload stays on the bare table', async () => {
    const page = await freshTablePage();
    await page.click(`tr[data-eid="${a.id}"] .open-link`);
    await page.waitForSelector('#dock:not([hidden])');
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Escape');
    await page.waitForSelector('#dock', { state: 'hidden' });
    assert.equal(await page.evaluate(() => location.hash), `#/table/${deals.id}`);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    assert.ok(await page.locator('#dock').isHidden(), 'no dock after the reload');
    await page.close();
  });

  test('a ?e= for a row that no longer exists renders the bare table', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${deals.id}?e=not-a-row`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    assert.ok(await page.locator('#dock').isHidden(), 'the dock stays closed');
    assert.equal(await page.evaluate(() => location.hash), `#/table/${deals.id}`, 'the dead ?e= is dropped');
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

  /* Issue #276 (Kyle, 2026-09-12): the dock follows the click, the page
     stays. A relation hop from a docked row into another table used to tear
     the table down, push #/table/<other> and restart the crumb there. */
  const dockedName = (page, n) => page.waitForFunction((name) => document.querySelector('#dock:not([hidden]) .name-edit')?.value === name, n);
  const crumbLabels = (page) => page.$$eval('#dock .crumb-path a', (as) => as.map((x) => x.textContent));
  async function hopToJane(page) {
    await page.click(`tr[data-eid="${a.id}"] .open-link`);
    await dockedName(page, 'Acme Working Capital');
    const before = await page.evaluate(() => history.length);
    await page.click(`#dock a[href="#/entity/${jane.id}"]`);
    await dockedName(page, 'Jane Rivera');
    return before;
  }

  test('a relation hop from the dock keeps the table under it and pushes no history', async () => {
    const page = await freshTablePage();
    const before = await hopToJane(page);
    assert.equal(await page.locator(`#main .wv-grid tr[data-eid="${a.id}"]`).count(), 1, 'the Deals grid is still the page');
    assert.equal(await page.evaluate(() => location.hash), `#/table/${deals.id}?e=${jane.id}`, 'the foreign row rides the CURRENT table hash');
    assert.equal(await page.evaluate(() => history.length), before, 'the hop added no history entry');
    await page.close();
  });

  test('the dock crumb reads as one path across the tables, and the back arrow walks it', async () => {
    const page = await freshTablePage();
    await hopToJane(page);
    assert.deepEqual(await crumbLabels(page), ['Deals', 'Acme Working Capital', 'Contacts'], 'Deals › Acme › Contacts › #jane');
    assert.equal(await page.locator(`tr[data-eid="${a.id}"].row-docked`).count(), 1, 'the root row keeps its light while a foreign row is on top');
    await page.click('#dock .dock-back');
    await dockedName(page, 'Acme Working Capital');
    assert.deepEqual(await crumbLabels(page), ['Deals']);
    assert.equal(await page.evaluate(() => location.hash), `#/table/${deals.id}?e=${a.id}`);
    assert.equal(await page.locator('#dock .dock-back').count(), 0, 'nothing behind the root: no back arrow');
    await page.close();
  });

  test('a reload re-docks the foreign row beside the same table', async () => {
    const page = await freshTablePage();
    await hopToJane(page);
    await page.reload({ waitUntil: 'networkidle' });
    await dockedName(page, 'Jane Rivera');
    assert.equal(await page.locator(`#main .wv-grid tr[data-eid="${a.id}"]`).count(), 1, 'still the Deals grid');
    assert.deepEqual(await crumbLabels(page), ['Contacts'], 'the row is rendered from its own table');
    assert.equal(await page.evaluate(() => location.hash), `#/table/${deals.id}?e=${jane.id}`);
    await page.close();
  });

  test('expanding a foreign docked row lands on its own #/entity page', async () => {
    const page = await freshTablePage();
    await hopToJane(page);
    await page.click('#dock .pose-btn');
    await page.waitForSelector('#main .name-edit');
    assert.equal(await page.evaluate(() => location.hash), `#/entity/${jane.id}`);
    assert.equal(await page.inputValue('#main .name-edit'), 'Jane Rivera');
    await page.close();
  });
}
