import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let call, activities, northwind;
const s = await launch('lookup-relation-chip', (weave) => {
  weave.createSpace({ name: 'CRM' });
  weave.createTable({ space: 'CRM', name: 'Companies' });
  weave.createTable({ space: 'CRM', name: 'Contacts' });
  activities = weave.createTable({ space: 'CRM', name: 'Activities' });
  weave.addRelation('Contacts', { name: 'Company', targetDb: 'Companies', cardinality: 'many-to-one' });
  weave.addRelation('Activities', { name: 'Contact', targetDb: 'Contacts', cardinality: 'many-to-one' });
  weave.addRelation('Activities', { name: 'Attendees', targetDb: 'Contacts', cardinality: 'many-to-many', inverseName: 'Meetings' });
  weave.addField('Activities', { name: 'Company', type: 'lookup', config: { relationField: 'Contact', targetField: 'Company' } });
  weave.addField('Activities', { name: 'Attendee Companies', type: 'lookup', config: { relationField: 'Attendees', targetField: 'Company' } });
  northwind = weave.createEntity('Companies', { Name: 'Northwind Traders' });
  weave.createEntity('Companies', { Name: 'Contoso' });
  weave.createEntity('Contacts', { Name: 'Ada Lovelace', Company: 'Northwind Traders' });
  weave.createEntity('Contacts', { Name: 'Grace Hopper', Company: 'Contoso' });
  call = weave.createEntity('Activities', { Name: 'Discovery call', Contact: 'Ada Lovelace', Attendees: ['Ada Lovelace', 'Grace Hopper'] });
  weave.updateTable(activities.id, { hiddenFields: [] });
});

if (s) {
  const { base, browser } = s;
  const chipsIn = (page, sel) => page.$$eval(`${sel} .k-rel`, (ns) => ns.map((n) => n.textContent.replace(/\s+/g, ' ').trim()));

  for (const colorScheme of ['light', 'dark']) {
    test(`the grid draws a lookup of a relation as the far rows' chips, in ${colorScheme}`, async () => {
      const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, colorScheme });
      await page.goto(`${base}/#/table/${activities.id}`, { waitUntil: 'load' });
      await page.waitForSelector('.wv-grid td[data-field="Company"] .k-rel');
      const one = await chipsIn(page, '.wv-grid td[data-field="Company"]');
      assert.equal(one.length, 1);
      assert.match(one[0], /Northwind Traders/);
      const many = await chipsIn(page, '.wv-grid td[data-field="Attendee Companies"]');
      assert.equal(many.length, 2, JSON.stringify(many));
      assert.match(many.join(' | '), /Northwind Traders.*Contoso/);
      const href = await page.$eval('.wv-grid td[data-field="Company"] .k-rel a', (a) => a.getAttribute('href'));
      assert.equal(href, `#/entity/${northwind.id}`, 'the chip opens the company');
      const text = await page.$eval('.wv-grid tbody', (b) => b.textContent);
      assert.ok(!text.includes(northwind.id), 'no cell prints the far row\'s uuid');
      const face = (field) => page.$eval(`.wv-grid td[data-field="${field}"] .k-rel`, (n) => {
        const cs = getComputedStyle(n);
        return { bg: cs.backgroundColor, color: cs.color, border: cs.borderTopColor, radius: cs.borderTopLeftRadius, font: cs.fontSize };
      });
      assert.deepEqual(await face('Company'), await face('Contact'));
      await page.close();
    });
  }

  test('the entity page draws the lookup\'s chip', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/entity/${call.id}`, { waitUntil: 'load' });
    const row = page.locator('.fieldrow', { has: page.locator('.fieldrow-label', { hasText: /^Company/ }) });
    await row.locator('.k-rel').first().waitFor();
    const names = await row.locator('.k-rel').allTextContents();
    assert.equal(names.length, 1, JSON.stringify(names));
    assert.match(names[0], /Northwind Traders/);
    const body = await page.$eval('#app', (b) => b.textContent);
    assert.ok(!body.includes(northwind.id), 'the page never prints the uuid');
    await page.close();
  });
}
