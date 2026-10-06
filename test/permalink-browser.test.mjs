/* A permalink in a real browser (Feature #264). The server answers
   /e/<id> with the shell and a preview head instead of a 302; what needs a
   browser is the landing: the app opens the entity, and Back leaves the
   workspace in one step, exactly as the redirect did.
   Playwright is NOT a dependency of weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let deal, space, deals;
const s = await launch('permalink', (weave) => {
  space = weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deals' });
  deal = weave.createEntity(deals, { name: 'Acme Working Capital' });
});
if (s) {
  const { base, browser } = s;

  test('a permalink lands on the entity, and Back leaves the workspace in one step', async () => {
    const page = await browser.newPage();
    await page.goto('about:blank');
    await page.goto(`${base}/e/${deal.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main .name-edit');
    assert.equal(await page.inputValue('#main .name-edit'), 'Acme Working Capital');
    assert.equal(await page.evaluate(() => location.pathname + location.hash), `/#/entity/${deal.id}`, 'the address is the hash route the app knows');
    assert.equal(await page.evaluate(() => history.length), 2, 'the permalink took no history entry of its own');
    await page.goBack();
    assert.equal(page.url(), 'about:blank');
    await page.close();
  });

  test('a space and a table permalink land on their pages', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/t/${deals.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    assert.equal(await page.evaluate(() => location.hash), `#/table/${deals.id}`);
    await page.goto(`${base}/s/${space.id}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('#main input.view-title')?.value === 'Sales');
    assert.equal(await page.evaluate(() => location.hash), `#/space/${space.id}`);
    await page.close();
  });

  /* The ⧉ on a space page and a table header mints the server-seen form,
     the one that unfurls in a chat. */
  test('the space and table ⧉ controls copy /s/<id> and /t/<id>', async () => {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.__copied = [];
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied.push(t); } } });
    });
    await page.goto(`${base}/#/space/${space.id}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelector('#main input.view-title')?.value === 'Sales');
    await page.click('#main .view-header .crumb-copy');
    await page.waitForFunction(() => window.__copied.length === 1);
    await page.evaluate((id) => { location.hash = `#/table/${id}`; }, deals.id);
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.click('#main .view-header .crumb-copy');
    await page.waitForFunction(() => window.__copied.length === 2);
    assert.deepEqual(await page.evaluate(() => window.__copied), [`${base}/s/${space.id}`, `${base}/t/${deals.id}`]);
    await page.close();
  });
}

