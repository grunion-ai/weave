import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { HTML, ROUTED, read } from './lib/source.mjs';

const FILES = ['/relmap-layout.js', '/relation-map.js'];
let space, deals, big;
const s = await launch('relation map lazy', (weave) => {
  space = weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deal' });
  const people = weave.createTable({ space: 'Sales', name: 'Person' });
  weave.addRelation(deals.id, { name: 'Owner', targetDb: people.id, cardinality: 'many-to-one' });
  big = weave.createEntity(deals, { name: 'Big' });
});

test('the relation map lives in relation-map.js, and app.js keeps only its loaders (Issue #1041)', () => {
  const app = read('public/app.js');
  const view = read('public/relation-map.js');
  for (const fn of ['relationMapView', 'mapCard', 'showMap', 'mapAutomations']) {
    assert.match(view, new RegExp(`function ${fn}\\(`), `${fn} is in relation-map.js`);
    assert.doesNotMatch(app, new RegExp(`function ${fn}\\(`), `app.js no longer carries ${fn}`);
  }
  const live = HTML.replace(/<template[\s\S]*?<\/template>/g, '');
  assert.doesNotMatch(live, /relmap-layout\.js|relation-map\.js/, 'no live tag loads the map on every route');
  assert.match(HTML, /<template id="lazy-assets">[^]*?<script src="\/relmap-layout\.js"><\/script><script src="\/relation-map\.js"><\/script>[^]*?<\/template>/, 'the template names both files, so the server stamps their versions');
  assert.ok(ROUTED.includes('public/relation-map.js'), 'source readers see the moved code');
});

if (s) {
  const { base, browser } = s;
  const watch = (page) => {
    const fetched = [];
    page.on('request', (r) => { const path = new URL(r.url()).pathname; if (FILES.includes(path)) fetched.push(path); });
    return fetched;
  };

  for (const [name, hash, ready] of [
    ['table', () => `#/table/${deals.id}`, '.wv-grid tbody tr.entity-row'],
    ['row', () => `#/entity/${big.id}`, '.wv-entity, main h1, main'],
  ]) {
    test(`a cold ${name} load fetches no relation map file (Issue #1041)`, async () => {
      const page = await browser.newPage();
      try {
        const fetched = watch(page);
        await page.goto(`${base}/${hash()}`, { waitUntil: 'networkidle' });
        await page.waitForSelector(ready);
        assert.deepEqual(fetched, []);
      } finally { await page.close(); }
    });
  }

  test('a cold home fetches the map files once, and a space overview and #/map reuse them (Issue #1041)', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    try {
      const fetched = watch(page);
      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      await page.locator('.home-map svg.relmap g.table-node', { hasText: 'Person' }).waitFor({ state: 'attached' });
      assert.deepEqual(fetched.toSorted(), FILES.toSorted());
      const srcs = await page.evaluate(() => [...document.querySelectorAll('script[src*="relmap-layout"], script[src*="relation-map"]')].map((n) => n.getAttribute('src')));
      assert.equal(srcs.length, 2);
      assert.ok(srcs.every((u) => /\?v=[0-9a-f]{12}$/.test(u)), `the map files load by their versioned names, cached for good: ${srcs.join(' ')}`);
      await page.evaluate((id) => { location.hash = `#/space/${id}`; }, space.id);
      await page.locator('summary', { hasText: 'Space overview' }).click();
      await page.locator('.home-map svg.relmap g.table-node', { hasText: 'Deal' }).waitFor({ state: 'attached' });
      await page.evaluate(() => { location.hash = '#/map'; });
      await page.getByRole('heading', { name: 'Relation map', exact: true }).waitFor();
      await page.locator('#main svg.relmap g.table-node', { hasText: 'Deal' }).waitFor({ state: 'attached' });
      assert.deepEqual(fetched.toSorted(), FILES.toSorted(), 'each file is fetched once');
    } finally { await page.close(); }
  });

  test('a home whose map fails to load says so and paints the rest of the page (Issue #1041)', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    try {
      await page.route(/\/relation-map\.js(\?|$)/, (r) => r.abort());
      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      await page.locator('#wv-toasts', { hasText: 'The relation map did not load' }).waitFor();
      assert.equal(await page.locator('.home-map').count(), 0);
      await page.evaluate(() => { location.hash = '#/map'; });
      await page.locator('#main .wv-route-error-msg', { hasText: 'The relation map did not load' }).waitFor();
      await page.evaluate((id) => { location.hash = `#/table/${id}`; }, deals.id);
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
    } finally { await page.close(); }
  });
}
