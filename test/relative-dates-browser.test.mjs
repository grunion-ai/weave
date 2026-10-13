import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let deals, acme;
const s = await launch('relative dates', (weave) => {
  weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deal' });
  acme = weave.createEntity(deals, { name: 'Acme' });
  const gone = weave.createEntity(deals, { name: 'Old deal' });
  weave.deleteEntity(gone.id);
});

if (s) {
  const { base, browser } = s;
  const year = String(new Date().getFullYear());

  test('the trash prints when a row went as a relative time, the full timestamp on hover', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${base}/#/trash`, { waitUntil: 'networkidle' });
      const t = page.locator('.trash-when time').first();
      await t.waitFor();
      const m = await t.evaluate((n) => ({ text: n.textContent, title: n.title, datetime: n.getAttribute('datetime') }));
      assert.equal(m.text, 'just now');
      assert.ok(m.title.includes(year), `the title carries the full timestamp (${m.title})`);
      assert.ok(Date.parse(m.datetime), 'the machine-readable instant rides in datetime');
    } finally { await page.close(); }
  });

  test('a record\'s Activity table prints relative times (Feature #315)', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${base}/#/activity/${acme.id}`, { waitUntil: 'networkidle' });
      const t = page.locator('.activity-row .activity-when').first();
      await t.waitFor();
      assert.equal(await t.textContent(), 'just now');
      assert.doesNotMatch(await t.textContent(), /\d+:\d+:\d+/, 'no seconds in the table');
    } finally { await page.close(); }
  });
}
