import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { createForm } from '../src/forms.js';

const app = await launch('Submission sharing beta', w => {
  w.createSpace({ name: 'Intake' });
  const table = w.createTable({ space: 'Intake', name: 'Request' });
  const form = createForm(w, { name: 'New request', table: table.id, fields: [{ field: 'Name', label: 'Title', required: true }], shareOnly: true });
  return { table, form };
});

if (app) for (const theme of ['light', 'dark']) test(`submission link works on phone in ${theme} with lost response and revoked stale page`, async () => {
  const { browser, weave, table, form, base } = app;
  const grant = weave.mintShare({ scope: { kind: 'table', id: table.id }, mode: 'submit', formId: form.id, expiry: 'never' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: theme });
  const stale = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: theme });
  try {
    await page.goto(base + grant.url);
    await page.waitForFunction(t => document.documentElement.dataset.bsTheme === t, theme);
    await stale.goto(base + grant.url);
    await stale.getByLabel('Title', { exact: true }).fill('Stale submission');
    await page.getByLabel('Title', { exact: true }).fill(`Phone ${theme}`);
    const before = weave.listEntities(table.id).length;
    const keys = [];
    await page.route('**/api/forms/*/submit', async route => {
      keys.push(route.request().headers()['idempotency-key']);
      if (keys.length === 1) { await route.fetch(); await route.abort('failed'); }
      else await route.continue();
    });
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.locator('#wv-form-error:not(.d-none)').waitFor();
    assert.equal(weave.listEntities(table.id).length, before + 1);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.getByRole('button', { name: 'Sent', exact: true }).waitFor();
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);
    assert.equal(weave.listEntities(table.id).length, before + 1);
    assert.equal(await page.locator('#wv-form-receipt').innerText(), 'Your response was received.');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    weave.regenerateShare(grant.id);
    await stale.getByRole('button', { name: 'Send', exact: true }).click();
    await stale.locator('#wv-form-error:not(.d-none)').waitFor();
    assert.equal(weave.listEntities(table.id).length, before + 1);
    assert.equal(await stale.getByRole('button', { name: 'Send', exact: true }).isEnabled(), true);
  } finally { await page.close(); await stale.close(); }
});
