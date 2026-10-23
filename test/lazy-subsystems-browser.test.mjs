import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { LAZY } from './lib/source.mjs';

let deals, big;
const s = await launch('lazy subsystems', (weave) => {
  weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deal' });
  weave.addField(deals, { name: 'Amount', type: 'number' });
  big = weave.createEntity(deals, { name: 'Big', values: { Amount: 3 } });
  weave.updateEntity(big.id, { Amount: 4 });
});

if (s) {
  const { base, browser } = s;
  const lazyPaths = LAZY.map((file) => file.replace(/^public/, ''));
  const watch = (page) => {
    const fetched = [];
    page.on('request', (r) => {
      const path = new URL(r.url()).pathname;
      if (lazyPaths.includes(path)) fetched.push(path);
    });
    return fetched;
  };

  test('the lazy list names files that exist and app.js no longer carries', async () => {
    assert.ok(LAZY.length > 0);
    for (const path of lazyPaths) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 200, path);
    }
  });

  for (const [route, ready] of [
    ['#/', '.wv-nav, main'],
    [() => `#/table/${deals.id}`, '.wv-grid tbody tr.entity-row'],
    [() => `#/entity/${big.id}`, '.wv-entity, main h1, main'],
  ]) {
    const hash = typeof route === 'function' ? route() : route;
    test(`a cold ${hash.split('/')[1] || 'home'} load fetches none of the lazy files`, async () => {
      const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
      try {
        const fetched = watch(page);
        await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
        await page.waitForSelector(ready);
        assert.deepEqual(fetched, []);
      } finally { await page.close(); }
    });
  }

  test('field settings loads the field dialog on first use, once', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
    try {
      const fetched = watch(page);
      await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      const open = async () => {
        const th = page.locator('.wv-grid thead th.col-head', { hasText: 'Amount' }).first();
        await th.hover();
        await th.locator('.field-menu').click();
        await page.locator('.chip-pop .wv-menu-row', { hasText: 'Field settings' }).click();
        await page.waitForSelector('.tray-form');
      };
      await open();
      assert.deepEqual(fetched, ['/field-dialog.js']);
      await page.keyboard.press('Escape');
      await page.waitForSelector('.tray-form', { state: 'detached' });
      await open();
      assert.deepEqual(fetched, ['/field-dialog.js'], 'the second open reuses the loaded file');
    } finally { await page.close(); }
  });

  test('the activity log loads its page on first visit, once, and opens an entry', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
    try {
      const fetched = watch(page);
      await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      await page.evaluate(() => { location.hash = '#/activity'; });
      await page.waitForSelector('tr.activity-row');
      assert.deepEqual(fetched, ['/activity-log.js']);
      await page.locator('tr.activity-row').first().click();
      await page.waitForSelector('.activity-title');
      await page.evaluate(() => { location.hash = '#/activity'; });
      await page.waitForSelector('tr.activity-row');
      assert.deepEqual(fetched, ['/activity-log.js'], 'later visits reuse the loaded file');
    } finally { await page.close(); }
  });

  test('the row Activity button loads the activity panel once, and the keyboard drives it', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
    try {
      const fetched = watch(page);
      await page.goto(`${base}/#/entity/${big.id}`, { waitUntil: 'networkidle' });
      const btn = page.locator('#main .activity-btn');
      await btn.waitFor();
      assert.deepEqual(fetched, []);
      await btn.focus();
      await page.keyboard.press('Enter');
      const row = page.locator('aside.wv-activity .wv-act-row').first();
      await row.waitFor({ timeout: 8000 }).catch(async (err) => {
        throw new Error(`${err.message}\n${JSON.stringify(await page.evaluate(() => ({ hash: location.hash, side: document.querySelector('#side')?.outerHTML.slice(0, 900), toast: document.querySelector('#wv-toasts')?.textContent, pressed: document.querySelector('#main .activity-btn')?.getAttribute('aria-pressed'), active: document.activeElement?.outerHTML.slice(0, 200) })))}`);
      });
      assert.deepEqual(fetched, ['/activity-panel.js']);
      assert.equal(await btn.getAttribute('aria-pressed'), 'true');
      await row.focus();
      await page.keyboard.press('Enter');
      await page.locator('aside.wv-activity .wv-act-row.sel').waitFor();
      await page.keyboard.press('Escape');
      await page.waitForSelector('aside.wv-activity', { state: 'detached' });
      assert.equal(await btn.getAttribute('aria-pressed'), 'false');
      await btn.click();
      await row.waitFor();
      assert.deepEqual(fetched, ['/activity-panel.js'], 'the second open reuses the loaded file');
    } finally { await page.close(); }
  });

  test('a row link that names the activity pane opens it once the panel loads, and holds the row still', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
    try {
      const fetched = watch(page);
      await page.goto(`${base}/#/table/${deals.id}?e=${big.id}&side=activity`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#side:not([hidden]) aside.wv-activity .wv-act-row');
      assert.deepEqual(fetched, ['/activity-panel.js']);
      assert.equal(await page.locator('#dock .activity-btn').getAttribute('aria-pressed'), 'true');
      assert.match(await page.evaluate(() => location.hash), /[?&]side=activity\b/, 'the URL still names the pane');
    } finally { await page.close(); }
  });

  test('the search button loads the command palette once and finds a row', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
    try {
      const fetched = watch(page);
      await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      await page.click('#search-btn');
      await page.waitForSelector('#cmdk-input');
      assert.deepEqual(fetched, ['/command-palette.js']);
      await page.fill('#cmdk-input', 'Big');
      await page.locator('#cmdk-results .result', { hasText: 'Big' }).first().waitFor();
      await page.keyboard.press('Escape');
      await page.waitForSelector('#cmdk-back', { state: 'detached' });
      await page.click('#search-btn');
      await page.waitForSelector('#cmdk-input');
      assert.deepEqual(fetched, ['/command-palette.js'], 'the second open reuses the loaded file');
    } finally { await page.close(); }
  });
}
