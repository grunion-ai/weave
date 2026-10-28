import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, hold } from './lib/browser.mjs';
let table, entry;
const s = await launch('Share beta panel', w => {
  w.createSpace({ name: 'Work' });
  table = w.createTable({ space: 'Work', name: 'Requests' });
  entry = w.createEntity(table.id, { Name: 'First request' });
});
if (s) {
  for (const theme of ['light', 'dark']) test(`Share panel: scoped creation, expiration, copy, preview, regeneration and hold to delete (${theme}, Feature #346)`, async () => {
    const page = await s.browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: theme });
    const requests = [];
    let links = [];
    await page.route('**/api/shares**', async route => {
      const request = route.request();
      const body = request.postDataJSON();
      requests.push({ method: request.method(), url: request.url(), body });
      if (request.method() === 'POST' && request.url().endsWith('/shares')) links.push({ ...body, id: 'share-one', url: '/s/first-token', title: 'Requests', status: 'live' });
      if (request.method() === 'POST' && request.url().endsWith('/regenerate')) links[0].url = '/s/next-token';
      if (request.method() === 'PATCH') Object.assign(links[0], body);
      if (request.method() === 'DELETE') links = [];
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(request.method() === 'GET' ? links : links[0] ?? {}) });
    });
    try {
      await page.goto(`${s.base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
      const shareButton = page.locator('.table-share-btn');
      assert.equal(await shareButton.locator('svg').count(), 1, 'the Share button draws its icon (Issue #1233)');
      assert.equal((await shareButton.innerText()).trim(), '', 'the Share button carries no text, least of all undefined (Issue #1233)');
      await page.click('.table-share-btn');
      await page.waitForSelector('#share-pane:not([hidden]) .share-add');
      assert.equal(await page.locator('#share-pane details, #share-pane [role="tab"]').count(), 0);
      assert.match(await page.locator('#share-pane').innerText(), /Entire table: Requests/);
      await page.click('.share-add');
      assert.equal(await page.getByLabel('Expiration', { exact: true }).locator('option').count(), 7);
      await page.getByLabel('Expiration', { exact: true }).selectOption('90d');
      await page.getByRole('button', { name: 'Create link', exact: true }).click();
      await page.waitForSelector('.share-link');
      assert.deepEqual(requests.find(r => r.method === 'POST').body.scope, { kind: 'table', id: table.id });
      assert.equal(requests.find(r => r.method === 'POST').body.expiry, '90d');
      assert.equal(await page.getByRole('button', { name: 'Copy link', exact: true }).innerText(), '');
      await page.getByRole('button', { name: 'Edit link', exact: true }).click();
      await page.getByLabel('Expiration', { exact: true }).selectOption('never');
      await page.getByRole('button', { name: 'Save changes' }).click();
      await page.waitForSelector('.share-add:not([hidden])');
      assert.equal(requests.find(r => r.method === 'PATCH').body.expiry, 'never');
      assert.equal(await page.locator('.share-link-name').getAttribute('href'), `${s.base}/s/first-token`);
      await page.getByRole('button', { name: 'Edit link', exact: true }).click();
      page.once('dialog', async dialog => { assert.match(dialog.message(), /old URL stops working/); await dialog.accept(); });
      await page.getByRole('button', { name: 'Regenerate link', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.share-link-name')?.href.endsWith('/s/next-token'));
      const del = page.getByRole('button', { name: 'Delete link', exact: true });
      assert.equal(await del.getAttribute('title'), 'Hold to delete link');
      await del.click();
      assert.equal(requests.filter(r => r.method === 'DELETE').length, 0, 'a click alone deletes nothing');
      await hold(del);
      await page.waitForSelector('.share-link', { state: 'detached' });
      assert.equal(requests.filter(r => r.method === 'DELETE').length, 1, 'the hold deletes the link');
      await page.click('.share-add');
      await page.getByRole('button', { name: 'Create link', exact: true }).click();
      await page.waitForSelector('.share-link');
      await page.getByRole('button', { name: 'Close share panel' }).click();
      await page.locator(`tr.entity-row[data-eid="${entry.id}"] input[type="checkbox"]`).check();
      await page.click('.table-share-btn');
      assert.match(await page.locator('#share-pane').innerText(), /1 selected entries/);
      await page.click('.share-add');
      await page.getByRole('button', { name: 'Create link', exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll('.share-link').length === 2);
      assert.deepEqual(requests.filter(r => r.method === 'POST' && r.url.endsWith('/shares')).at(-1).body.scope, { kind: 'entities', ids: [entry.id] });
      assert.equal(await page.locator('#share-pane').evaluate(n => n.scrollWidth <= n.clientWidth), true);
      await page.getByRole('button', { name: 'Close share panel' }).click();
      await page.click('.table-view-btn');
      assert.equal(await page.locator('#view-pane').isVisible(), true);
      assert.equal(await page.locator('#share-pane').isVisible(), false);
    } finally { await page.close(); }
  });
}
