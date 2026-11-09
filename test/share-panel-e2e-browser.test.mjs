import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const app = await launch('Share panel end-to-end', w => {
  w.createSpace({ name: 'Intake' });
  const intake = w.createTable({ space: 'Intake', name: 'Request' });
  const catalog = w.createTable({ space: 'Intake', name: 'Catalog' });
  w.createEntity(catalog.id, { Name: 'Alpha' });
  w.createEntity(catalog.id, { Name: 'Beta' });
  const reversed = w.tableView(`${catalog.id}/Reversed`, { sort: [{ field: 'Name', dir: 'desc' }] });
  return { intake, catalog, reversed };
});

if (app) {
  test('Share panel creates a live anonymous submission link, previews without writes, and replaces its credential', async () => {
    const { browser, weave, intake, base } = app;
    const owner = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const recipientContext = await browser.newContext();
    const recipient = await recipientContext.newPage();
    let preview;
    try {
      await owner.goto(`${base}/#/table/${intake.id}`, { waitUntil: 'networkidle' });
      await owner.getByRole('button', { name: 'Share (Beta)', exact: true }).click();
      await owner.getByRole('button', { name: 'Add link', exact: true }).click();
      await owner.getByLabel('Link purpose', { exact: true }).selectOption('submit');
      await owner.getByLabel('Expiration', { exact: true }).selectOption('never');
      await owner.getByRole('button', { name: 'Create link', exact: true }).click();
      await owner.locator('.share-link-name').waitFor();
      const oldUrl = await owner.locator('.share-link-name').getAttribute('href');
      assert.match(oldUrl, new RegExp(`/w/${weave.state.meta.id}/s/`));
      const grant = weave.listShares().find(link => link.mode === 'submit');
      assert.equal(grant.expiresAt, null);
      assert.equal(weave.listEntities(intake.id).length, 0);
      await recipient.goto(oldUrl);
      await recipient.getByLabel('Name', { exact: true }).fill('Anonymous request');
      await recipient.getByRole('button', { name: 'Send', exact: true }).click();
      await recipient.getByRole('button', { name: 'Sent', exact: true }).waitFor();
      assert.equal(weave.listEntities(intake.id).length, 1);
      assert.equal(weave.entityName(weave.listEntities(intake.id)[0]), 'Anonymous request');
      const previewOpened = owner.context().waitForEvent('page');
      await owner.getByRole('button', { name: 'Preview link', exact: true }).click();
      preview = await previewOpened;
      await preview.waitForLoadState();
      await preview.getByLabel('Name', { exact: true }).fill('Preview must not be saved');
      await preview.getByRole('button', { name: 'Send', exact: true }).click();
      await preview.locator('#wv-form-error:not(.d-none)').waitFor();
      assert.match(await preview.locator('#wv-form-error').innerText(), /Preview does not submit/);
      assert.equal(weave.listEntities(intake.id).length, 1);
      await owner.getByRole('button', { name: 'Edit link', exact: true }).click();
      owner.once('dialog', async dialog => {
        assert.match(dialog.message(), /old URL stops working immediately/);
        await dialog.accept();
      });
      await owner.getByRole('button', { name: 'Regenerate link', exact: true }).click();
      await owner.waitForFunction(old => document.querySelector('.share-link-name')?.href !== old, oldUrl);
      const newUrl = await owner.locator('.share-link-name').getAttribute('href');
      assert.notEqual(newUrl, oldUrl);
      assert.equal((await recipient.goto(oldUrl)).status(), 404);
      await recipient.goto(newUrl);
      await recipient.getByLabel('Name', { exact: true }).fill('Replacement link request');
      await recipient.getByRole('button', { name: 'Send', exact: true }).click();
      await recipient.getByRole('button', { name: 'Sent', exact: true }).waitFor();
      assert.equal(weave.listEntities(intake.id).length, 2);
      assert.equal(weave.shareByToken(grant.token), null);
    } finally { await preview?.close(); await owner.close(); await recipientContext.close(); }
  });

  for (const theme of ['light', 'dark']) test(`entity, selection and table links use one panel and enforce their recipient scope (${theme})`, async () => {
    const { browser, weave, base } = app;
    const table = weave.createTable({ space: 'Intake', name: `Sharing ${theme}` });
    const rows = ['First', 'Second', 'Third'].map(Name => weave.createEntity(table.id, { Name }));
    const outside = weave.createEntity(app.intake.id, { Name: 'Outside table' });
    const owner = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: theme });
    const recipientContext = await browser.newContext();
    const recipient = await recipientContext.newPage();
    const checkbox = row => owner.locator(`tr.entity-row[data-eid="${row.id}"] input[type="checkbox"]`);
    const create = async label => {
      assert.equal(await owner.locator('#share-pane:not([hidden])').count(), 1);
      assert.equal(await owner.locator('#modal').count(), 0);
      await owner.getByRole('button', { name: 'Add link', exact: true }).click();
      await owner.getByLabel('Link name', { exact: true }).fill(label);
      await owner.getByRole('button', { name: 'Create link', exact: true }).click();
      const link = owner.locator('.share-link-name', { hasText: label });
      await link.waitFor();
      return link.getAttribute('href');
    };
    const check = async (url, allowed, denied) => {
      assert.equal((await recipient.goto(url)).status(), 200);
      for (const row of allowed) {
        const response = await recipientContext.request.get(`${url}/api/entities/${row.id}`);
        assert.equal(response.status(), 200, `${row.id} is in scope`);
        assert.equal((await response.json()).id, row.id);
      }
      for (const row of denied) {
        assert.equal((await recipientContext.request.get(`${url}/api/entities/${row.id}`)).status(), 403, `${row.id} is outside scope`);
        assert.equal((await recipient.goto(`${url}/e/${row.id}/entity.html`)).status(), 404, 'the recipient page cannot bypass the scope');
      }
      assert.equal((await recipientContext.request.patch(`${url}/api/entities/${allowed[0].id}`, { data: { Name: 'Not allowed' } })).status(), 403);
    };
    try {
      await owner.goto(`${base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
      await owner.evaluate(t => document.documentElement.setAttribute('data-bs-theme', t), theme);
      await checkbox(rows[0]).check();
      await checkbox(rows[1]).check();
      await owner.locator('#main .table-share-btn').click();
      assert.match(await owner.locator('#share-pane').innerText(), /2 selected entries/);
      await checkbox(rows[1]).uncheck();
      const selectedUrl = await create(`Selection ${theme}`);
      const selected = weave.listShares().find(g => g.label === `Selection ${theme}`);
      assert.deepEqual(selected.scope, { kind: 'entities', ids: rows.slice(0, 2).map(row => row.id) });
      await check(selectedUrl, rows.slice(0, 2), [rows[2], outside]);
      await recipient.goto(selectedUrl);
      assert.deepEqual((await recipient.locator('table tbody tr').allTextContents()).map(text => text.trim()), ['First', 'Second']);
      await owner.getByRole('button', { name: 'Close share panel', exact: true }).click();
      await checkbox(rows[0]).uncheck();
      await owner.locator('#main .table-share-btn').click();
      assert.match(await owner.locator('#share-pane').innerText(), /Entire table: Sharing/);
      const tableUrl = await create(`Table ${theme}`);
      assert.deepEqual(weave.listShares().find(g => g.label === `Table ${theme}`).scope, { kind: 'table', id: table.id });
      await check(tableUrl, rows, [outside]);
      await recipient.goto(tableUrl);
      assert.equal(await recipient.locator('table tbody tr').count(), 3);
      await check(selectedUrl, rows.slice(0, 2), [rows[2]]);
      await owner.goto(`${base}/#/table/${table.id}?e=${rows[0].id}`, { waitUntil: 'networkidle' });
      await owner.locator('#main .table-share-btn').click();
      await owner.locator('#share-pane .share-add').waitFor();
      await owner.locator('#dock .table-share-btn').click();
      assert.match(await owner.locator('#share-pane').innerText(), /This record: First/);
      assert.equal(await owner.locator('#main .table-share-btn').getAttribute('aria-expanded'), 'false');
      assert.equal(await owner.locator('#dock .table-share-btn').getAttribute('aria-expanded'), 'true');
      const entityUrl = await create(`Entity ${theme}`);
      assert.deepEqual(weave.listShares().find(g => g.label === `Entity ${theme}`).scope, { kind: 'entity', id: rows[0].id });
      await check(entityUrl, [rows[0]], [rows[1], outside]);
    } finally { await owner.close(); await recipientContext.close(); }
  });

  test('recipient Apply, saved-view switch and Reset work under the HTTP CSP without saving changes', async () => {
    const { browser, weave, catalog, reversed, base } = app;
    const grant = weave.mintShare({ scope: { kind: 'table', id: catalog.id }, mode: 'read', expiry: '7d' });
    const before = JSON.stringify(weave.getTable(catalog.id).tableViews);
    const page = await browser.newPage();
    try {
      const response = await page.goto(base + grant.url);
      assert.match(response.headers()['content-security-policy'], /sandbox/);
      const rows = () => page.locator('table tbody tr').allTextContents();
      assert.equal((await rows()).length, 2);
      await page.getByLabel('Search', { exact: true }).fill('Beta');
      await page.getByLabel('Sort', { exact: true }).selectOption('desc');
      await page.getByRole('button', { name: 'Apply', exact: true }).click();
      await page.waitForURL(url => url.searchParams.get('search') === 'Beta');
      assert.equal((await rows()).length, 1);
      assert.match((await rows())[0], /Beta/);
      await page.getByRole('button', { name: 'Reset', exact: true }).click();
      await page.waitForURL(url => !url.searchParams.has('search'));
      assert.equal((await rows()).length, 2);
      await page.getByLabel('Saved view', { exact: true }).selectOption(reversed.id);
      await page.waitForURL(url => url.searchParams.get('view') === reversed.id);
      assert.match((await rows())[0], /Beta/);
      await page.getByLabel('Sort', { exact: true }).selectOption('asc');
      await page.getByRole('button', { name: 'Apply', exact: true }).click();
      await page.waitForURL(url => url.searchParams.get('sort') === 'asc');
      assert.match((await rows())[0], /Alpha/);
      await page.getByRole('button', { name: 'Reset', exact: true }).click();
      await page.waitForURL(url => !url.searchParams.has('sort'));
      assert.match((await rows())[0], /Beta/);
      assert.equal(JSON.stringify(weave.getTable(catalog.id).tableViews), before);
    } finally { await page.close(); }
  });
}
