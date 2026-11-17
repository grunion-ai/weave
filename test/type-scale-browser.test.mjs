import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let deals, acme;
const s = await launch('type scale', (weave) => {
  weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deals' });
  acme = weave.createEntity(deals, { name: 'Acme Working Capital' });
  weave.createEntity(deals, { name: 'Beta Logistics' });
});
if (s) {
  const { base, browser } = s;
  const smallText = (page) => page.evaluate(() => [...document.querySelectorAll('body *')].filter((n) => {
    if (![...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) return false;
    const r = n.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && parseFloat(getComputedStyle(n).fontSize) < 11;
  }).map((n) => `${n.tagName.toLowerCase()}.${[...n.classList].join('.')} ${getComputedStyle(n).fontSize}`));
  for (const colorScheme of ['light', 'dark']) {
    test(`the app loads no font faces and names no Inter, in ${colorScheme} (Issue #383)`, async () => {
      const page = await browser.newPage({ colorScheme });
      await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      const font = await page.evaluate(async () => {
        await document.fonts.ready;
        return { faces: document.fonts.size, body: getComputedStyle(document.body).fontFamily, title: getComputedStyle(document.querySelector('#main .view-title')).fontFamily };
      });
      assert.equal(font.faces, 0, 'nothing vendored, so nothing to load');
      assert.doesNotMatch(font.body, /Inter/, `body resolves to the system stack: ${font.body}`);
      assert.doesNotMatch(font.title, /Inter/, `the page title too: ${font.title}`);
      assert.deepEqual(await smallText(page), [], 'no grid text under 11px');
      await page.goto(`${base}/#/entity/${acme.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.entity-head .name-edit');
      assert.deepEqual(await smallText(page), [], 'no entity page text under 11px');
      await page.close();
    });
  }
}
