/* The two poses of the one entity surface, driven through a real browser
   (change 3). Split is the dock panel; expanded is the classic entity page
   in #main — same URL, same geometry the page always had — and the pose
   controls bridge them: outward arrows on the dock expand, inward arrows on
   the page re-dock, and the page crumb's table link means "re-dock", not
   "leave". Playwright is NOT a dependency; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let deals, a;
const s = await launch('entity pose', (weave) => {
  weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deals' });
  a = weave.createEntity(deals, { name: 'Acme Working Capital' });
});
if (s) {
  const { base, browser } = s;
  test('the dock expands to the entity page: outward arrows, then the old URL', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.click(`tr[data-eid="${a.id}"] .open-link`);
    await page.waitForSelector('#dock:not([hidden]) .pose-btn svg');
    const outward = await page.locator('#dock .pose-btn svg path').first().getAttribute('d');
    assert.equal(outward, 'M16 4h4v4', 'the dock wears arrows-diagonal (outward = expand)');
    await page.click('#dock .pose-btn');
    await page.waitForSelector('#main .name-edit');
    assert.equal(await page.evaluate(() => location.hash), `#/entity/${a.id}`);
    assert.equal(await page.locator('#dock').isVisible(), false, 'the dock hands the entity to the page');
    await page.close();
  });

  test('a #/entity deep link is the classic page wearing the collapse controls', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${a.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main .name-edit');
    assert.equal(await page.inputValue('#main .name-edit'), 'Acme Working Capital');
    const inward = await page.locator('#main .pose-btn svg path').first().getAttribute('d');
    assert.equal(inward, 'M18 10h-4v-4', 'the page wears arrows-diagonal-minimize-2 (inward = collapse)');
    await page.close();
  });

  test('the collapse arrows re-dock the entity beside its table', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${a.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main .pose-btn');
    await page.click('#main .pose-btn');
    await page.waitForSelector('#dock:not([hidden]) .name-edit');
    assert.equal(await page.evaluate(() => location.hash), `#/table/${deals.id}`);
    assert.equal(await page.inputValue('#dock .name-edit'), 'Acme Working Capital');
    await page.waitForSelector(`tr[data-eid="${a.id}"].row-docked`);
    await page.close();
  });

  test("the page crumb's table link re-docks instead of leaving", async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${a.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main .crumb-path');
    await page.click(`#main .crumb-path a[href="#/table/${deals.id}"]`);
    await page.waitForSelector('#dock:not([hidden]) .name-edit');
    assert.equal(await page.evaluate(() => location.hash), `#/table/${deals.id}`);
    assert.equal(await page.inputValue('#dock .name-edit'), 'Acme Working Capital', 'the entity stays in hand');
    await page.close();
  });

  test('⌘⇧E flips the pose both ways', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${a.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main .pose-btn');
    await page.keyboard.press('Meta+Shift+KeyE');
    await page.waitForSelector('#dock:not([hidden]) .name-edit');
    await page.keyboard.press('Meta+Shift+KeyE');
    await page.waitForSelector('#main .name-edit');
    assert.equal(await page.evaluate(() => location.hash), `#/entity/${a.id}`);
    await page.close();
  });

  test('pose flips are presentation: the history stack never grows', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    const before = await page.evaluate(() => history.length);
    await page.click(`tr[data-eid="${a.id}"] .open-link`);       // dock
    await page.waitForSelector('#dock:not([hidden]) .pose-btn');
    await page.click('#dock .pose-btn');                          // expand
    await page.waitForSelector('#main .pose-btn');
    await page.click('#main .pose-btn');                          // collapse
    await page.waitForSelector('#dock:not([hidden]) .pose-btn');
    await page.click('#dock .pose-btn');                          // expand again
    await page.waitForSelector('#main button[title="Close"]');
    await page.click('#main button[title="Close"]');              // ✕ to table
    await page.waitForSelector('#main .wv-grid');
    const after = await page.evaluate(() => history.length);
    assert.equal(after, before,
      `four pose moves added ${after - before} history entries — Back would walk look-alike twins`);
    await page.close();
  });
}
