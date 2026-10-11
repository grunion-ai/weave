import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let deals, acme, space;
const s = await launch('doc title', (weave) => {
  space = weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deals' });
  acme = weave.createEntity(deals, { name: 'Acme Working Capital' });
});

if (s) {
  const { base, browser } = s;
  const wsName = (page) => page.waitForFunction(() => document.querySelector('#ws-name')?.textContent)
    .then((h) => h.jsonValue());
  const titleIs = (page, want) => page.waitForFunction((w) => document.title === w, want, { timeout: 5000 })
    .catch(async () => assert.equal(await page.title(), want));

  test('a table tab reads "<table> · <workspace>" and its heading is an <h1>', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    const ws = await wsName(page);
    assert.ok(ws, 'the workspace name loaded');
    await titleIs(page, `Deals · ${ws}`);
    assert.equal(await page.locator('#main h1 .view-title').count(), 1, 'the table title sits inside one <h1>');
    const look = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('#main .view-title'));
      const h1 = getComputedStyle(document.querySelector('#main h1'));
      return { size: cs.fontSize, weight: cs.fontWeight, h1Margin: h1.marginBottom };
    });
    assert.deepEqual(look, { size: '20px', weight: '700', h1Margin: '0px' }, 'the <h1> sits on the type scale (Issue #383)');
    await page.close();
  });

  test('docking a row titles the tab with the row; closing restores the table', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    const ws = await wsName(page);
    await page.click(`tr[data-eid="${acme.id}"] .open-link`);
    await page.waitForSelector('#dock:not([hidden]) .name-edit');
    await titleIs(page, `Deals #1 · Acme Working Capital · ${ws}`);
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Escape');
    await page.waitForSelector('#dock', { state: 'hidden' });
    await titleIs(page, `Deals · ${ws}`);
    await page.close();
  });

  test('the entity page, a space and the workspace home each title the tab', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${acme.id}`, { waitUntil: 'networkidle' });
    const ws = await wsName(page);
    await titleIs(page, `Deals #1 · Acme Working Capital · ${ws}`);
    await page.evaluate((id) => { location.hash = `#/space/${id}`; }, space.id);
    await titleIs(page, `Sales · ${ws}`);
    await page.evaluate(() => { location.hash = '#/'; });
    await titleIs(page, ws);
    await page.close();
  });
}
