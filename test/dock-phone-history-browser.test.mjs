import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage } from './lib/browser.mjs';

let deals, contacts, a, jane;
const s = await launch('dock phone history', (weave) => {
  weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deals' });
  contacts = weave.createTable({ space: 'Sales', name: 'Contacts' });
  weave.addRelation(deals, { name: 'Contact', targetDb: contacts.id, cardinality: 'many-to-one', inverseName: 'Deals' });
  jane = weave.createEntity(contacts, { name: 'Jane Rivera' });
  a = weave.createEntity(deals, { name: 'Acme Working Capital', Contact: jane.id });
  weave.createEntity(deals, { name: 'Bluefin Renewal' });
});
if (s) {
  const { base, browser } = s;
  const docked = (page) => page.waitForSelector('#dock:not([hidden]) .name-edit');
  const undocked = (page) => page.waitForFunction(() => document.querySelector('#dock')?.hidden !== false);
  const hash = (page) => page.evaluate(() => location.hash);
  const depth = (page) => page.evaluate(() => history.length);

  async function phoneTable(colorScheme = 'light') {
    const page = await phonePage(await phoneBrowser(), { colorScheme });
    await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
    await page.evaluate((id) => { location.hash = `#/table/${id}`; }, deals.id);
    await page.waitForSelector(`tr[data-eid="${a.id}"] .open-link`);
    return page;
  }

  for (const colorScheme of ['light', 'dark']) {
    test(`on a phone, opening a row is a step Back undoes and Forward redoes, in ${colorScheme}`, async () => {
      const page = await phoneTable(colorScheme);
      const before = await depth(page);
      await page.click(`tr[data-eid="${a.id}"]`);
      await docked(page);
      assert.equal(await hash(page), `#/table/${deals.id}?e=${a.id}`);
      assert.equal(await depth(page), before + 1, 'the full-screen row is one history entry');
      await page.goBack();
      await undocked(page);
      assert.equal(await hash(page), `#/table/${deals.id}`, 'Back lands on the table, not the page before it');
      await page.waitForSelector(`tr[data-eid="${a.id}"]`);
      await page.goForward();
      await docked(page);
      assert.equal(await page.inputValue('#dock .name-edit'), 'Acme Working Capital', 'Forward brings the row back');
      await page.close();
    });
  }

  test('on a phone, a relation hop inside the row is its own step', async () => {
    const page = await phoneTable();
    await page.click(`tr[data-eid="${a.id}"]`);
    await docked(page);
    const before = await depth(page);
    await page.click(`#dock a[href="#/entity/${jane.id}"]`);
    await page.waitForFunction(() => document.querySelector('#dock .name-edit')?.value === 'Jane Rivera');
    assert.equal(await depth(page), before + 1);
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('#dock .name-edit')?.value === 'Acme Working Capital');
    assert.equal(await hash(page), `#/table/${deals.id}?e=${a.id}`, 'Back steps to the row the hop came from');
    await page.close();
  });

  test('on a phone, closing the row with its button takes the step back off the history', async () => {
    const page = await phoneTable();
    const before = await depth(page);
    await page.click(`tr[data-eid="${a.id}"]`);
    await docked(page);
    await page.click('#dock button[aria-label="Close"]');
    await undocked(page);
    assert.equal(await hash(page), `#/table/${deals.id}`);
    assert.equal(await page.evaluate(() => history.state?.wvDock ?? null), null, 'the table entry is current, not a copy of it');
    assert.equal(await depth(page), before + 1, 'the closed row stays only as a Forward step');
    await page.close();
  });

  test('on a desktop, the docked row still pushes no history', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`tr[data-eid="${a.id}"] .open-link`);
    const before = await depth(page);
    await page.click(`tr[data-eid="${a.id}"]`);
    await docked(page);
    assert.equal(await depth(page), before, 'the dock beside the table is presentation (Issues #198, #226, #276)');
    await page.close();
  });
}
