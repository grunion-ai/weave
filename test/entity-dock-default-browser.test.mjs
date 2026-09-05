/* The ONE entity view opens DOCKED, whatever opened it (Issue #198).

   The ruling of 2026-09-02 made the dock the one entity surface: an entity
   opens beside its table, the outward arrows expand it to the page, the
   inward arrows dock it again. The ledger's #id link honoured that; every
   other opener — a relation chip, a card, a ⌘K hit, a mention chip in a
   document, openEntity() itself — still navigated to #/entity/<id>, which
   the router draws as the expanded page. Kyle, 2026-09-05: "entities
   opening in full screen not dock panel by default, fix."

   One delegated listener now turns every plain click on a #/entity link
   into a dock beside that entity's table, travelling to the table first
   when the reader is elsewhere. Modifier clicks still hand the link to the
   browser (Issue #134), and the #/entity/<id> route itself stays the
   expanded page — that is what a new tab, a permalink and the outward
   arrows land on. Playwright is NOT a dependency; the suite skips when
   absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let deals, contacts, acme, bluefin, jane;
const s = await launch('entity dock default', (weave) => {
  weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deals' });
  contacts = weave.createTable({ space: 'Sales', name: 'Contacts' });
  weave.addRelation(deals, { name: 'Contact', targetDb: contacts.id, cardinality: 'many-to-one', inverseName: 'Deals' });
  jane = weave.createEntity(contacts, { name: 'Jane Rivera' });
  acme = weave.createEntity(deals, { name: 'Acme Working Capital', Contact: jane.id });
  bluefin = weave.createEntity(deals, { name: 'Bluefin Renewal' });
});

if (s) {
  const { base, browser } = s;
  const docked = async (page, name) => {
    // The dock may already be open on another entity: wait for THIS name.
    await page.waitForFunction((n) => document.querySelector('#dock:not([hidden]) .name-edit')?.value === n, name);
    assert.equal(await page.inputValue('#dock .name-edit'), name, 'the dock holds the entity');
    assert.ok(await page.locator('#main .wv-grid').isVisible(), 'the table stays beside it');
    const glyph = await page.locator('#dock .pose-btn svg path').first().getAttribute('d');
    assert.equal(glyph, 'M16 4h4v4', 'the outward arrows (expand) are on the dock');
  };

  for (const colorScheme of ['light', 'dark']) {
    test(`a relation chip docks its entity beside the far table, in ${colorScheme}`, async () => {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
      await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector(`tr[data-eid="${acme.id}"] td[data-ftype="relation"] a[href="#/entity/${jane.id}"]`);
      await page.click(`tr[data-eid="${acme.id}"] td[data-ftype="relation"] a[href="#/entity/${jane.id}"]`);
      await docked(page, 'Jane Rivera');
      assert.equal(await page.$eval('html', (h) => h.dataset.bsTheme), colorScheme);
      assert.equal(await page.evaluate(() => location.hash), `#/table/${contacts.id}`,
        'the reader travelled to the chip\'s table; the dock is not a navigation');
      await page.waitForSelector(`tr[data-eid="${jane.id}"].row-docked`);
      await page.close();
    });
  }

  test('a ⌘K hit docks instead of opening the page', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${contacts.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.click('#search-btn');
    await page.fill('#cmdk-input', 'Bluefin');
    await page.waitForSelector('#cmdk-results .result.active');
    await page.keyboard.press('Enter');
    await docked(page, 'Bluefin Renewal');
    assert.equal(await page.evaluate(() => location.hash), `#/table/${deals.id}`);
    await page.close();
  });

  test('expand goes to the page; ✕ returns to the table; the next row docks again', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`tr[data-eid="${acme.id}"] td[data-ftype="relation"] a`);
    await page.click(`tr[data-eid="${acme.id}"] td[data-ftype="relation"] a[href="#/entity/${jane.id}"]`);
    await docked(page, 'Jane Rivera');
    await page.click('#dock .pose-btn');
    await page.waitForSelector('#main .name-edit');
    assert.equal(await page.evaluate(() => location.hash), `#/entity/${jane.id}`, 'the expanded pose is the classic page');
    await page.click('#main button[title="Close"]');
    await page.waitForSelector('#main .wv-grid');
    assert.equal(await page.locator('#dock').isVisible(), false);
    await page.click(`tr[data-eid="${jane.id}"] .open-link`);
    await docked(page, 'Jane Rivera');
    await page.close();
  });

  test('a relation chip inside the dock docks the far entity in its own table', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`tr[data-eid="${acme.id}"] .open-link`);
    await page.click(`tr[data-eid="${acme.id}"] .open-link`);
    await docked(page, 'Acme Working Capital');
    await page.click(`#dock a[href="#/entity/${jane.id}"]`);
    await docked(page, 'Jane Rivera');
    assert.equal(await page.evaluate(() => location.hash), `#/table/${contacts.id}`);
    await page.close();
  });

  test('a modifier click on an entity link still belongs to the browser', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`tr[data-eid="${acme.id}"] td[data-ftype="relation"] a`);
    const [popup] = await Promise.all([
      page.context().waitForEvent('page'),
      page.click(`tr[data-eid="${acme.id}"] td[data-ftype="relation"] a[href="#/entity/${jane.id}"]`, { modifiers: ['ControlOrMeta'] }),
    ]);
    assert.ok(popup.url().endsWith(`#/entity/${jane.id}`), 'a new tab on the entity page');
    assert.equal(await page.locator('#dock').isVisible(), false, 'nothing docked here');
    await popup.close();
    await page.close();
  });
}
