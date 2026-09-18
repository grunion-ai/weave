/* Issue #258, the client half: the schema was fetched two or three times per
   route. Boot loaded it, then the home page's relation map fetched it again
   (as did every space page and #/map) although the tab already held it and
   Issue #274's version stamp keeps that copy honest. A member workspace also
   fetched its own schema, then the root registry's, then /workspace, one
   after the other before routing could start. Now each route reads the
   schema the tab holds, and the boot fetches go out together. Playwright is
   NOT a dependency; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { launch } from './lib/browser.mjs';

let uno, sales;
const s = await launch('schema fetch count', (root) => {
  root.updateWorkspace({ name: 'root' });
  sales = root.createSpace({ name: 'Sales' });
  const deals = root.createTable({ space: 'Sales', name: 'Deals' });
  const accounts = root.createTable({ space: 'Sales', name: 'Accounts' });
  root.addRelation(deals, { name: 'Account', targetDb: accounts, cardinality: 'many-to-one', inverseName: 'Deals' });
  uno = new Weave();
  uno.updateWorkspace({ name: 'uno' });
  uno.createSpace({ name: 'Agent' });
  uno.createTable({ space: 'Agent', name: 'Sessions' });
}, { server: () => ({ workspaces: { uno } }) });

if (s) {
  const { base, browser } = s;
  const watch = (page) => {
    const hits = [];
    page.on('request', (r) => {
      const p = new URL(r.url()).pathname;
      if (/\/api\/(schema|automations)$/.test(p)) hits.push(p);
    });
    return hits;
  };
  const settle = async (page) => { await page.waitForLoadState('networkidle'); await page.waitForTimeout(300); };

  test('boot and the home page fetch the schema once, and the relation map still draws', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const hits = watch(page);
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.home-map');
    await settle(page);
    assert.deepEqual(hits.filter((h) => h.endsWith('/schema')), ['/api/schema'], 'the map reads the schema the tab holds');
    await page.close();
  });

  test('a space page and #/map do not refetch a schema that has not moved', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await settle(page);
    const hits = watch(page);
    await page.evaluate((id) => { location.hash = `#/space/${id}`; }, sales.id);
    await settle(page);
    await page.evaluate(() => { location.hash = '#/map'; });
    await page.waitForSelector('#main .wv-rmap, #main svg', { timeout: 5000 }).catch(() => {});
    await settle(page);
    assert.equal(hits.filter((h) => h.endsWith('/schema')).length, 0, `no schema refetch on navigation (saw ${JSON.stringify(hits)})`);
    await page.close();
  });

  test('a member workspace boots with its schema, the root registry and /workspace in flight together', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const prefix = `/w/${uno.state.meta.id}`;
    const seen = [];
    // Hold the member's own schema until the other two boot reads have been
    // asked for. Serial code never asks while it waits, and the hold times out.
    let release;
    const others = new Promise((r) => { release = r; });
    page.on('request', (r) => {
      const p = new URL(r.url()).pathname;
      seen.push(p);
      if (seen.includes('/api/schema') && seen.includes(`${prefix}/api/workspace`)) release(true);
    });
    await page.route(`**${prefix}/api/schema`, async (route) => {
      const both = await Promise.race([others, new Promise((r) => setTimeout(() => r(false), 3000))]);
      route.fallback().catch(() => {});
      page.__concurrent ??= both; // the first, boot's own fetch
    });
    await page.goto(`${base}${prefix}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#nav .nav-db');
    await settle(page);
    assert.equal(page.__concurrent, true, `root schema and /workspace must be requested while the member schema is pending (saw ${JSON.stringify(seen)})`);
    assert.equal(seen.filter((p) => p === `${prefix}/api/schema`).length, 1, 'the member schema once');
    assert.equal(seen.filter((p) => p === '/api/schema').length, 1, 'the root registry once');
    await page.close();
  });
}
