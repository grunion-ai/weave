/* A route that fails says so, instead of holding the skeleton — Issue #118.

   The reporter opened uno's Project table and watched the loading skeleton
   forever. The grid's POST /tables/<id>/query answered 500 (a rollup whose
   target field had been deleted; the engine crash behind it is Issue #206,
   fixed 2026-09-06), showDatabase's await rejected, and nothing caught the
   rejection. paintSkeleton had already replaced #main, so the page was left
   holding the skeleton of a table that was never going to arrive.

   The hole was every route's, not the grid's: showEntity alone caught, and
   only to fall back to the workspace home. The catch now sits at the single
   place every route passes through — the hashchange render and the first
   render at boot — so a failed load names the failure and offers the retry.

   Playwright is NOT a dependency; the suite skips when it is absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch } from './lib/browser.mjs';

const APP = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

test('both route entry points end in the one failure handler (Issue #118)', () => {
  const routeFn = APP.match(/\nfunction route\(\) \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(routeFn, /renderRouteSafely/, 'hashchange navigation catches its own failure');
  assert.match(APP, /withPageLoader\(\(\) => loadSchema\(\)\.then\(renderRoute\)\.catch\(paintRouteError\)\)/,
    'and so does the first render at boot');
  assert.match(APP, /function paintRouteError\(/, 'the failure has somewhere to paint');
});

let deals;
const s = await launch('route error', (weave) => {
  weave.createSpace({ name: 'Sales' });
  const t = weave.createTable({ space: 'Sales', name: 'Deals' });
  weave.createEntity(t, { name: 'Acme' });
  return { deals: t };
});

if (s) {
  ({ deals } = s);
  const { base, browser } = s;
  const TABLE_QUERY = `**/api/tables/${deals.id}/query`;

  // The exact failure the reporter hit: the grid's own query, 500, no body
  // the UI can turn into a table.
  const break500 = (page) => page.route(TABLE_QUERY, (r) => r.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Field \'Estimate\' not found in table \'Task\'', code: 'internal' }),
  }));

  test('a 500 from the grid query paints the failure, not an endless skeleton', async () => {
    const page = await browser.newPage();
    await break500(page);
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main .wv-route-error');
    assert.equal(await page.locator('#main .sk-card').count(), 0, 'the skeleton is gone');
    assert.match(await page.locator('#main .wv-route-error').innerText(), /Estimate/,
      'the page repeats what the server said went wrong');
    assert.equal(await page.locator('#main .wv-route-error button').innerText(), 'Try again');
    await page.close();
  });

  test('the same on a hash navigation, not just the first paint', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid');
    await break500(page);
    await page.evaluate((id) => { location.hash = `#/table/${id}`; }, deals.id);
    await page.waitForSelector('#main .wv-route-error');
    assert.equal(await page.locator('#main .sk-card').count(), 0);
    await page.close();
  });

  test('Try again re-runs the route, and the table arrives once the server is well', async () => {
    const page = await browser.newPage();
    await break500(page);
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main .wv-route-error');
    await page.unroute(TABLE_QUERY);
    await page.click('#main .wv-route-error button');
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    assert.equal(await page.locator('#main .wv-route-error').count(), 0, 'the failure is cleared');
    // The Name cell is an inline editor, so the row's name is a value, not text.
    assert.equal(await page.locator('.wv-grid tbody td.name-cell input').inputValue(), 'Acme');
    await page.close();
  });

  // Chrome is chrome: it has to read in both themes (house rule).
  for (const theme of ['light', 'dark']) {
    test(`the failure is legible in the ${theme} theme`, async () => {
      const page = await browser.newPage();
      await break500(page);
      await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
      await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
      await page.waitForSelector('#main .wv-route-error');
      const seen = await page.evaluate(() => {
        const box = document.querySelector('#main .wv-route-error');
        const cs = getComputedStyle(box);
        const msg = getComputedStyle(box.querySelector('.wv-route-error-msg'));
        return { bg: cs.backgroundColor, fg: msg.color, visible: box.getBoundingClientRect().height > 0 };
      });
      assert.ok(seen.visible, 'the card has height');
      assert.notEqual(seen.bg, 'rgba(0, 0, 0, 0)', 'the card paints a background from the theme');
      assert.notEqual(seen.bg, seen.fg, 'and the message is not the background colour');
      await page.close();
    });
  }
}
