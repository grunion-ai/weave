import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { read } from './lib/source.mjs';

const FILE = '/settings-view.js';
const INVITE = '/invite-dialog.js';
const MOVED = [FILE, INVITE];
let deals, big;
const s = await launch('settings view lazy', (weave) => {
  weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deal' });
  big = weave.createEntity(deals, { name: 'Big' });
  weave.deleteEntity(weave.createEntity(deals, { name: 'Gone deal' }).id);
});

test('the Trash and Settings pages live in settings-view.js, and app.js keeps only their loaders (Issue #1041)', () => {
  const app = read('public/app.js');
  const view = read(`public${FILE}`);
  for (const fn of ['showTrash', 'showSettings', 'deleteWorkspaceDialog', 'typedHold', 'confirmToggle', 'hrefAfterDelete']) {
    assert.match(view, new RegExp(`function ${fn}\\(`), `${fn} is in settings-view.js`);
    assert.doesNotMatch(app, new RegExp(`function ${fn}\\(`), `app.js no longer carries ${fn}`);
  }
  const invite = read(`public${INVITE}`);
  for (const fn of ['inviteDialog', 'seatNote']) {
    assert.match(invite, new RegExp(`function ${fn}\\(`), `${fn} is in invite-dialog.js`);
    assert.doesNotMatch(app, new RegExp(`function ${fn}\\(`), `app.js no longer carries ${fn}`);
  }
});

if (s) {
  const { base, browser } = s;
  const watch = (page) => {
    const fetched = [];
    page.on('request', (r) => { const path = new URL(r.url()).pathname; if (MOVED.includes(path)) fetched.push(path); });
    return fetched;
  };

  for (const [name, hash, ready] of [
    ['home', '', '#ws-new svg'],
    ['table', () => `#/table/${deals.id}`, '.wv-grid tbody tr.entity-row'],
    ['row', () => `#/entity/${big.id}`, '.wv-entity, main h1, main'],
  ]) {
    test(`a cold ${name} load fetches neither ${MOVED.join(' nor ')} (Issue #1041)`, async () => {
      const page = await browser.newPage();
      try {
        const fetched = watch(page);
        await page.goto(`${base}/${typeof hash === 'function' ? hash() : hash}`, { waitUntil: 'networkidle' });
        await page.waitForSelector(ready);
        assert.deepEqual(fetched, []);
      } finally { await page.close(); }
    });
  }

  test('a cold Settings or Trash load fetches the file once and paints the page (Issue #1041)', async () => {
    const page = await browser.newPage();
    try {
      const fetched = watch(page);
      await page.goto(`${base}/#/settings`, { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
      assert.deepEqual(fetched, [FILE]);
      await page.evaluate(() => { location.hash = '#/trash'; });
      await page.locator('#main tr', { hasText: 'Gone deal' }).waitFor();
      await page.evaluate((id) => { location.hash = `#/trash/${id}`; }, deals.id);
      await page.locator('#main tr', { hasText: 'Gone deal' }).waitFor();
      assert.deepEqual(fetched, [FILE], 'moving between Settings and Trash reuses the loaded file');
    } finally { await page.close(); }
  });

  test('a Settings page that fails to load says so and leaves the app running (Issue #1041)', async () => {
    const page = await browser.newPage();
    try {
      await page.route(`**${FILE}`, (r) => r.abort());
      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#ws-new svg');
      await page.evaluate(() => { location.hash = '#/settings'; });
      await page.locator('#wv-toasts', { hasText: 'Settings did not load' }).waitFor();
      await page.evaluate((id) => { location.hash = `#/table/${id}`; }, deals.id);
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
    } finally { await page.close(); }
  });
}
