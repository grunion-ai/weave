import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let deals, contacts, acme, bluefin, jane;
const s = await launch('crumb nav', (weave) => {
  weave.createSpace({ name: 'Sales', icon: 'lucide:briefcase' });
  deals = weave.createTable({ space: 'Sales', name: 'Deals', icon: 'lucide:rocket' });
  contacts = weave.createTable({ space: 'Sales', name: 'Contacts', icon: 'lucide:bug' });
  weave.addRelation(deals, { name: 'Contact', targetDb: contacts.id, cardinality: 'many-to-one', inverseName: 'Deals' });
  jane = weave.createEntity(contacts, { name: 'Jane Rivera' });
  acme = weave.createEntity(deals, { name: 'Acme Working Capital', Contact: jane.id });
  bluefin = weave.createEntity(deals, { name: 'Bluefin Renewal', Contact: jane.id });
});

if (s) {
  const { base, browser } = s;
  const rows = (page, scope) => page.$$eval(`${scope} .view-header .crumb-path .crumb-k-row .crumb-nm`, (ns) => ns.map((n) => n.textContent));
  const named = (page, scope, name) => page.waitForFunction(([sc, n]) => document.querySelector(`${sc} .name-edit`)?.value === n, [scope, name]);
  const hop = async (page, to, name) => {
    await page.click(`#dock .entity-grid a[href="#/entity/${to.id}"]`);
    await named(page, '#dock', name);
  };
  async function docked() {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.click(`tr[data-eid="${acme.id}"] .open-link`);
    await named(page, '#dock', 'Acme Working Capital');
    return page;
  }

  test('expanding a docked row keeps the path the dock took, and collapsing keeps it again', async () => {
    const page = await docked();
    await hop(page, jane, 'Jane Rivera');
    assert.deepEqual(await rows(page, '#dock'), ['Acme Working Capital', 'Jane Rivera']);
    await page.click('#dock .pose-btn');
    await named(page, '#main', 'Jane Rivera');
    const full = await page.$$eval('#main .view-header .crumb-path .crumb-item', (cs) => cs.map((c) => [[...c.classList].find((k) => k.startsWith('crumb-k-')), c.querySelector('.crumb-nm').textContent]));
    assert.deepEqual(full.map(([k]) => k), ['crumb-k-ws', 'crumb-k-space', 'crumb-k-table', 'crumb-k-row', 'crumb-k-row']);
    assert.deepEqual(full.slice(1).map(([, n]) => n), ['Sales', 'Deals', 'Acme Working Capital', 'Jane Rivera'],
      'the full page: workspace › space › table where the path started, then both hops');
    await page.click('#main .view-header .pose-btn');
    await named(page, '#dock', 'Jane Rivera');
    assert.deepEqual(await rows(page, '#dock'), ['Acme Working Capital', 'Jane Rivera'], 'collapse keeps the path too');
    await page.close();
  });

  test('Back then Forward returns to the same row; a new hop after Back drops the forward leg', async () => {
    const page = await docked();
    await hop(page, jane, 'Jane Rivera');
    await hop(page, bluefin, 'Bluefin Renewal');
    assert.ok(await page.locator('#dock .dock-forward').isDisabled(), 'nothing ahead yet');
    await page.click('#dock .dock-back');
    await named(page, '#dock', 'Jane Rivera');
    assert.ok(await page.locator('#dock .dock-forward').isEnabled(), 'Forward can undo the step back');
    await page.click('#dock .dock-forward');
    await named(page, '#dock', 'Bluefin Renewal');
    assert.deepEqual(await rows(page, '#dock'), ['Acme Working Capital', 'Jane Rivera', 'Bluefin Renewal']);
    await page.click('#dock .dock-back');
    await named(page, '#dock', 'Jane Rivera');
    await hop(page, acme, 'Acme Working Capital');
    assert.ok(await page.locator('#dock .dock-forward').isDisabled(), 'the hop after Back discarded Forward');
    await page.close();
  });

  test('a revisit cuts the crumb back while Back still replays the click order', async () => {
    const page = await docked();
    await hop(page, jane, 'Jane Rivera');
    await hop(page, bluefin, 'Bluefin Renewal');
    await hop(page, jane, 'Jane Rivera');
    assert.deepEqual(await rows(page, '#dock'), ['Acme Working Capital', 'Jane Rivera'], 'crumbs show place: Jane was on the trail, so it cuts back');
    await page.click('#dock .dock-back');
    await named(page, '#dock', 'Bluefin Renewal');
    assert.deepEqual(await rows(page, '#dock'), ['Acme Working Capital', 'Jane Rivera', 'Bluefin Renewal'], 'arrows show time: Back is the row you came from');
    await page.click('#dock .dock-forward');
    await named(page, '#dock', 'Jane Rivera');
    await page.close();
  });

  test('the full page wears Back and Forward too, and they walk the same history', async () => {
    const page = await docked();
    await hop(page, jane, 'Jane Rivera');
    await page.click('#dock .pose-btn');
    await named(page, '#main', 'Jane Rivera');
    const back = page.locator('#main .view-header .crumb-row .dock-back');
    const fwd = page.locator('#main .view-header .crumb-row .dock-forward');
    const path = await page.locator('#main .view-header .crumb-path').boundingBox();
    assert.ok((await back.boundingBox()).x < path.x && (await fwd.boundingBox()).x < path.x, 'Back and Forward sit left of the crumb path');
    await back.click();
    await named(page, '#main', 'Acme Working Capital');
    assert.equal(await page.evaluate(() => location.hash), `#/entity/${acme.id}`);
    await fwd.click();
    await page.locator('#main .view-header .crumb-row .dock-forward').waitFor();
    await named(page, '#main', 'Jane Rivera');
    assert.deepEqual(await rows(page, '#main'), ['Acme Working Capital', 'Jane Rivera']);
    await page.close();
  });

  test('Esc steps back while there is a step to take, then closes', async () => {
    const page = await docked();
    await hop(page, jane, 'Jane Rivera');
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Escape');
    await named(page, '#dock', 'Acme Working Capital');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#dock', { state: 'hidden' });
    await page.close();
  });
}
