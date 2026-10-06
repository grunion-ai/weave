import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let deals, contacts, acme, jane;
const s = await launch('crumb icons', (weave) => {
  weave.createSpace({ name: 'Sales', icon: 'lucide:briefcase' });
  deals = weave.createTable({ space: 'Sales', name: 'Deals', icon: 'lucide:rocket' });
  contacts = weave.createTable({ space: 'Sales', name: 'Contacts' });
  weave.addRelation(deals, { name: 'Contact', targetDb: contacts.id, cardinality: 'many-to-one', inverseName: 'Deals' });
  jane = weave.createEntity(contacts, { name: 'Jane Rivera' });
  acme = weave.createEntity(deals, { name: 'Acme Working Capital', Contact: jane.id });
});

if (s) {
  const { base, browser } = s;
  const crumbs = (page, scope) => page.$$eval(`${scope} .view-header .crumb-path .crumb-item`, (items) => items.map((c) => ({
    kind: [...c.classList].find((k) => k.startsWith('crumb-k-'))?.slice(8),
    current: c.classList.contains('crumb-cur'),
    icon: !!c.querySelector('.crumb-ic svg, .crumb-ws-mark img, .crumb-ws-mark .crumb-ws-letter'),
    svg: !!c.querySelector('.crumb-ic svg'),
    pid: c.querySelector('.crumb-pid')?.textContent ?? null,
    name: c.querySelector('.crumb-nm')?.textContent ?? '',
  })));
  const everyIcon = (list, where) => {
    for (const c of list) {
      assert.ok(c.icon, `${where}: the ${c.kind} crumb "${c.name}" wears an icon`);
      if (c.kind !== 'ws') assert.ok(c.svg, `${where}: the ${c.kind} crumb "${c.name}" icon is an svg`);
    }
  };

  test('the table page: workspace, space and table crumbs each wear their icon', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    const c = await crumbs(page, '#main');
    assert.deepEqual(c.map((x) => x.kind), ['ws', 'space', 'table']);
    assert.deepEqual(c.map((x) => x.name).slice(1), ['Sales', 'Deals']);
    everyIcon(c, 'table page');
    assert.ok(c[2].current, 'the table is the current crumb');
    assert.equal(await page.locator('#main .view-header .crumb-path .crumb-copy').count(), 1, 'copy-link is a button on the current crumb');
    assert.equal(await page.locator('#main .view-header .crumb-path:has-text("⧉")').count(), 0, 'no inline ⧉ glyph');
    await page.close();
  });

  test('the dock: the row crumb is the table icon, #id and the full Name, no table crumb in front', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${base}/#/table/${deals.id}?e=${acme.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#dock:not([hidden]) .name-edit');
    const c = await crumbs(page, '#dock');
    assert.deepEqual(c.map((x) => [x.kind, x.pid, x.name, x.current]), [['row', `#${acme.publicId}`, 'Acme Working Capital', true]]);
    everyIcon(c, 'dock');
    const copy = page.locator('#dock .crumb-path .crumb-copy');
    assert.equal(await copy.getAttribute('title'), 'Copy permalink');
    assert.equal(await copy.locator('svg').count(), 1, 'the copy button is an icon');
    await page.click(`#dock a[href="#/entity/${jane.id}"]`);
    await page.waitForFunction(() => document.querySelector('#dock .name-edit')?.value === 'Jane Rivera');
    const hop = await crumbs(page, '#dock');
    assert.deepEqual(hop.map((x) => [x.kind, x.name, x.current]), [['row', 'Acme Working Capital', false], ['row', 'Jane Rivera', true]]);
    everyIcon(hop, 'dock after a hop');
    await page.close();
  });

  test('the full page: workspace › space › table, then the row, every crumb with its icon', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${base}/#/entity/${acme.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main .name-edit');
    const c = await crumbs(page, '#main');
    assert.deepEqual(c.map((x) => x.kind), ['ws', 'space', 'table', 'row']);
    assert.deepEqual(c.map((x) => x.name).slice(1), ['Sales', 'Deals', 'Acme Working Capital']);
    assert.equal(c[3].pid, `#${acme.publicId}`);
    assert.ok(c[3].current);
    everyIcon(c, 'full page');
    await page.close();
  });
}
