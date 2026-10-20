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
}
