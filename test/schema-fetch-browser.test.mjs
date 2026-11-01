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

  const bootWhileSchemaPending = async (page, prefix, wanted) => {
    const seen = [];
    let release;
    const others = new Promise((r) => { release = r; });
    page.on('request', (r) => {
      const p = new URL(r.url()).pathname;
      seen.push(p);
      if (wanted.every((w) => seen.includes(w))) release(true);
    });
    await page.route(`**${prefix}/api/schema`, async (route) => {
      const together = await Promise.race([others, new Promise((r) => setTimeout(() => r(false), 3000))]);
      route.fallback().catch(() => {});
      page.__concurrent ??= together;
    });
    await page.goto(`${base}${prefix}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#nav .nav-db');
    await settle(page);
    return seen;
  };
  const stripMarker = (page) => page.route((url) => url.pathname.endsWith('/') && !url.pathname.includes('/api/'), async (route) => {
    const res = await route.fetch();
    route.fulfill({ response: res, body: (await res.text()).replace(/<meta name="weave-workspace"[^>]*>/, '') });
  });

  test('a workspace boots with one local schema and concurrent metadata reads', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const prefix = `/w/${uno.state.meta.id}`;
    const seen = await bootWhileSchemaPending(page, prefix, [`${prefix}/api/workspace`, `${prefix}/api/health`]);
    assert.equal(page.__concurrent, true, `/workspace and /health are requested while the local schema is pending (saw ${JSON.stringify(seen)})`);
    assert.equal(seen.filter((p) => p === `${prefix}/api/schema`).length, 1, 'the member schema once');
    assert.equal(seen.filter((p) => p === '/api/schema').length, 0, 'no unrelated schema request');
    await page.close();
  });

  test('the root boots with its schema, /workspace, /health and the home reads in flight together and builds the schema once', async () => {
    for (const prefix of ['', '/w/root']) {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      const seen = await bootWhileSchemaPending(page, prefix, [`${prefix}/api/workspace`, `${prefix}/api/health`, `${prefix}/api/workspaces`, `${prefix}/api/invites`]);
      assert.equal(page.__concurrent, true, `${prefix || '/'}: /workspace, /health and the home reads must be requested while the schema is pending (saw ${JSON.stringify(seen)})`);
      assert.deepEqual(seen.filter((p) => p.endsWith('/api/schema')), [`${prefix}/api/schema`], `${prefix || '/'}: the root reads its schema once, with no registry read`);
      await page.close();
    }
  });

  test('a shell without the workspace marker still uses only the local schema', async () => {
    for (const prefix of [`/w/${uno.state.meta.id}`, '/w/root']) {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      await stripMarker(page);
      const seen = await bootWhileSchemaPending(page, prefix, [`${prefix}/api/workspace`]);
      assert.equal(page.__concurrent, true, `${prefix}: an unmarked shell sends workspace metadata with the schema (saw ${JSON.stringify(seen)})`);
      assert.equal(seen.filter((p) => p === '/api/schema').length, 0, `${prefix}: no unrelated registry request`);
      await page.close();
    }
  });
}
