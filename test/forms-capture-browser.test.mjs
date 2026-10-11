import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { createForm } from '../src/forms.js';

const app = await launch('Public form capture', (w) => {
  w.createSpace({ name: 'Intake' });
  const table = w.createTable({ space: 'Intake', name: 'Request' });
  w.addField(table.id, { name: 'Link', type: 'url' });
  w.addField(table.id, { name: 'Reporter', type: 'text' });
  const form = createForm(w, {
    name: 'Save a link', description: 'Save a page to the review inbox.', table: table.id,
    fields: [{ field: 'Name', key: 'title', label: 'Title', required: true }, { field: 'Link', key: 'url', label: 'Page URL', required: true }],
    hidden: { Reporter: '$actor' },
  });
  return { table, form };
});

if (app) for (const theme of ['light', 'dark']) {
  test(`prefilled phone form survives a lost response in ${theme} theme`, async () => {
    const { browser, weave, table, form, base } = app;
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: theme });
    try {
      const before = weave.listEntities(table.id).length;
      const query = new URLSearchParams({ title: `Saved in ${theme}`, url: 'https://example.com/article?a=1&b=2', unknown: 'old-value' });
      await page.goto(`${base}/f/${form.id}?${query}`);
      await page.waitForFunction((t) => document.documentElement.dataset.bsTheme === t, theme);
      assert.equal(await page.getByLabel('Title', { exact: true }).inputValue(), `Saved in ${theme}`);
      assert.equal(await page.getByLabel('Page URL', { exact: true }).inputValue(), 'https://example.com/article?a=1&b=2');
      assert.match(await page.locator('.alert-warning').innerText(), /unknown/);
      assert.equal(weave.listEntities(table.id).length, before);
      const requests = [];
      await page.route('**/api/forms/*/submit', async (route) => {
        requests.push(route.request().headers()['idempotency-key']);
        if (requests.length === 1) { await route.fetch(); await route.abort('failed'); }
        else await route.continue();
      });
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.locator('#wv-form-error:not(.d-none)').waitFor();
      assert.equal(weave.listEntities(table.id).length, before + 1);
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await page.getByRole('button', { name: 'Sent', exact: true }).waitFor();
      assert.equal(requests.length, 2);
      assert.ok(requests[0]);
      assert.equal(requests[0], requests[1]);
      assert.equal(weave.listEntities(table.id).length, before + 1);
      assert.match(await page.locator('#wv-form-receipt').innerText(), /Filed as Intake\/Request #/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `/tmp/weave-public-form-${theme}.png`, fullPage: true });
    } finally { await page.close(); }
  });
}
