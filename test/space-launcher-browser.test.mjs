import test from 'node:test';
import assert from 'node:assert/strict';
import { engineOf, launch, painted, phoneProfile } from './lib/browser.mjs';

const IPHONE = phoneProfile()?.page ?? null;
const LONG = 'Quarterly renewal forecast reconciliation for the northern territories and every partner';
const minutesAgo = (n) => new Date(Date.now() - n * 60000).toISOString();

const s = await launch('space launcher', (weave) => {
  const sales = weave.createSpace({ name: 'Sales', description: 'Pipeline, accounts and the people behind them.' });
  const deal = weave.createTable({ space: 'Sales', name: 'Deal' });
  const contact = weave.createTable({ space: 'Sales', name: 'Contact' });
  const account = weave.createTable({ space: 'Sales', name: 'Account' });
  const long = weave.createTable({ space: 'Sales', name: LONG });
  const extra = Array.from({ length: 5 }, (_, i) => weave.createTable({ space: 'Sales', name: `Extra ${i}` }));
  const northstar = weave.createEntity(deal, { name: 'Northstar renewal' });
  const maya = weave.createEntity(contact, { name: 'Maya Chen' });
  const harbor = weave.createEntity(account, { name: 'Harbor Labs' });
  const empty = weave.createSpace({ name: 'Bare' });
  const ids = { sales: sales.id, empty: empty.id, deal: deal.id, contact: contact.id, account: account.id, long: long.id, extra: extra.map((t) => t.id), northstar: northstar.id, maya: maya.id, harbor: harbor.id };
  return { ids };
});

const fullPayload = (ids) => ({
  space: { id: ids.sales, name: 'Sales', icon: 'lucide:users', description: 'Pipeline, accounts and the people behind them.' },
  tables: [
    { id: ids.deal, name: 'Deal', icon: 'lucide:users', rowCount: 48, views: [{ id: 'v1', name: 'Pipeline', layout: 'board' }, { id: 'v2', name: LONG, layout: 'grid' }, { id: 'v3', name: 'Key accounts', layout: 'list' }] },
    { id: ids.contact, name: 'Contact', icon: '', rowCount: 1, views: [] },
    { id: ids.account, name: 'Account', icon: '', rowCount: 0, views: [] },
    { id: ids.long, name: LONG, icon: '', rowCount: 1234567, views: [] },
    ...ids.extra.map((id, i) => ({ id, name: `Extra ${i}`, icon: '', rowCount: i, views: [] })),
  ],
  runs: [
    { workflowId: 'w1', name: 'Renewal follow-up', originSpace: 'Ops', at: minutesAgo(8), outcome: 'attention', failedStep: { step: 2, error: 'Email connection expired' }, changedCount: 1, changedTables: [{ table: 'Deal', count: 1 }], changedRows: [{ id: ids.northstar, publicId: 1, name: 'Northstar renewal', table: 'Deal' }] },
    { workflowId: 'w2', name: LONG, originSpace: 'Sales', at: minutesAgo(40), outcome: 'success', failedStep: null, changedCount: 120, changedTables: [{ table: 'Contact', count: 70 }, { table: 'Account', count: 50 }], changedRows: [{ id: ids.maya, publicId: 1, name: 'Maya Chen', table: 'Contact' }, { id: ids.harbor, publicId: 1, name: 'Harbor Labs', table: 'Account' }] },
    { workflowId: 'w3', name: 'Stopped early', originSpace: 'Delivery', at: minutesAgo(70), outcome: 'attention', failedStep: { step: null, error: null }, changedCount: 0, changedTables: [], changedRows: [] },
  ],
});

const fullRecents = (ids) => [
  { kind: 'table-view', id: 'v1', tableId: ids.deal, name: 'Pipeline', url: `#/table/${ids.deal}/view/v1`, at: Date.now() - 4 * 60000 },
  { kind: 'table-view', id: 'v2', tableId: ids.deal, name: LONG, url: `#/table/${ids.deal}/view/v2`, at: Date.now() - 22 * 60000 },
  { kind: 'table-view', id: 'v3', tableId: ids.deal, name: 'Key accounts', url: `#/table/${ids.deal}/view/v3` },
  { kind: 'table-view', id: 'gone', tableId: ids.deal, name: 'Deleted view', url: `#/table/${ids.deal}/view/gone` },
  { kind: 'entity', id: ids.northstar, name: 'Northstar renewal', db: 'Sales/Deal', publicId: 48, url: `/e/${ids.northstar}`, chip: { state: { name: 'Proposal', category: 'in-progress' } }, at: Date.now() - 6 * 60000 },
  { kind: 'entity', id: ids.maya, name: 'Maya Chen', db: 'Sales/Contact', publicId: 131, url: `/e/${ids.maya}` },
  { kind: 'entity', id: ids.harbor, name: 'Harbor Labs', db: 'Sales/Account', publicId: 12, url: `/e/${ids.harbor}` },
  { kind: 'entity', id: 'elsewhere', name: 'Other space row', db: 'Ops/Task', publicId: 7, url: '/e/elsewhere' },
];

if (s) {
  const { base, browser, ids } = s;
  const payload = fullPayload(ids);
  const recents = fullRecents(ids);
  const engines = [['chromium 390x844', browser, { viewport: { width: 390, height: 844 } }]];
  const webkit = await engineOf('webkit');
  if (webkit && IPHONE) engines.push(['webkit iPhone 15', webkit, IPHONE]);

  const open = async (b, profile, { theme = 'light', load = payload, seen = recents, space = ids.sales, real = false } = {}) => {
    const page = await b.newPage(profile);
    const failures = [];
    page.on('pageerror', (e) => failures.push(e.message));
    await page.addInitScript(([t, list]) => {
      localStorage.setItem('weave-theme', t);
      localStorage.setItem('weave-recent:/', JSON.stringify(list));
    }, [theme, seen]);
    if (!real) await page.route('**/api/spaces/*/home', (route) => (load ? route.fulfill({ json: load }) : route.fulfill({ status: 500, json: { error: 'home broke' } })));
    await page.goto(`${base}/#/space/${space}`, { waitUntil: 'networkidle' });
    page.failures = failures;
    return page;
  };

  for (const [engine, b, profile] of engines) {
    test(`${engine}: the launcher keeps the mockup order under the existing header`, async () => {
      const page = await open(b, profile);
      await painted(page, '.launcher[data-ready]');
      const order = await page.evaluate(() => {
        const main = document.querySelector('#main');
        return {
          header: !!main.querySelector(':scope > .view-header h1, :scope > .view-header .view-title'),
          kids: [...main.querySelector('.launcher-home').children].map((n) => n.dataset.part),
          heads: [...main.querySelectorAll('.launcher-heading h2')].map((n) => n.textContent),
          desktop: main.querySelectorAll('.space-tables, .home-map').length,
        };
      });
      assert.ok(order.header, 'the existing space header stays');
      assert.deepEqual(order.kids, ['search', 'tables', 'views', 'rows', 'runs', 'about']);
      assert.deepEqual(order.heads, ['Recent views', 'Recent', 'Automation activity']);
      assert.equal(order.desktop, 0, 'the desktop cards do not render on a phone');
      assert.deepEqual(page.failures, []);
      await page.close();
    });

    test(`${engine}: one tile per table with its count`, async () => {
      const page = await open(b, profile);
      await painted(page, '.launcher-tile');
      const tiles = await page.$$eval('.launcher-tile', (ns) => ns.map((n) => ({ name: n.querySelector('strong').textContent, count: n.querySelector('small').textContent, href: n.getAttribute('href') })));
      assert.equal(tiles.length, 9);
      assert.deepEqual(tiles[0], { name: 'Deal', count: '48', href: `#/table/${ids.deal}` });
      assert.equal(tiles[1].count, '1');
      assert.equal(tiles[2].count, '0');
      await page.click(`.launcher-tile[href="#/table/${ids.contact}"]`);
      await page.waitForFunction((id) => location.hash === `#/table/${id}`, ids.contact);
      await page.close();
    });

    test(`${engine}: two items per section and a control that reveals the rest`, async () => {
      const page = await open(b, profile);
      await painted(page, '.launcher-row');
      const shown = (part) => page.$$eval(`[data-part="${part}"] .launcher-row`, (ns) => ns.filter((n) => n.getClientRects().length).map((n) => n.querySelector('strong').textContent));
      for (const part of ['views', 'rows', 'runs']) {
        assert.equal((await shown(part)).length, 2, `${part} starts at two`);
        const more = page.locator(`[data-part="${part}"] .launcher-more`);
        assert.equal(await more.getAttribute('aria-expanded'), 'false');
        await more.click();
        assert.equal((await shown(part)).length, 3, `${part} reveals the third`);
        assert.equal(await more.getAttribute('aria-expanded'), 'true');
        await more.click();
        assert.equal((await shown(part)).length, 2, `${part} folds back`);
      }
      await page.close();
    });

    test(`${engine}: a partial run shows its failed step and opens its details and what it changed`, async () => {
      const page = await open(b, profile);
      await painted(page, '[data-part="runs"] .launcher-row');
      const first = page.locator('[data-part="runs"] .launcher-row').first();
      assert.match(await first.innerText(), /Ops → Sales · Deal 1/);
      assert.match(await first.locator('.launcher-outcome').innerText(), /Step 2 failed: Email connection expired/);
      await first.click();
      await painted(page, '.launcher-detail');
      assert.equal(await page.locator('.launcher-home').isVisible(), false);
      assert.equal(await page.locator('#main > .view-header').isVisible(), false);
      const body = await page.locator('.launcher-detail').innerText();
      for (const want of ['Renewal follow-up', 'Partial completion', 'Started in', 'Ops', 'Affected space', 'Sales', 'Failed', 'Step 2: Email connection expired', 'Changed', 'Deal 1', 'Northstar renewal', 'Deal #1']) assert.ok(body.includes(want), `detail names ${want}`);
      await page.click('.launcher-detail .launcher-row');
      await page.waitForFunction((id) => location.hash.includes(`e=${id}`), ids.northstar);
      await page.waitForSelector('#dock', { state: 'attached' });
      await page.close();
      const again = await open(b, profile);
      await painted(again, '[data-part="runs"] .launcher-row');
      await again.locator('[data-part="runs"] .launcher-row').first().click();
      await painted(again, '.launcher-detail');
      await again.click('.launcher-return');
      await painted(again, '.launcher-home');
      assert.equal(await again.locator('.launcher-detail').count(), 0);
      assert.equal(await again.locator('#main > .view-header').isVisible(), true);
      await again.locator('[data-part="runs"] .launcher-row').first().click();
      await painted(again, '.launcher-detail');
      await again.goBack();
      await painted(again, '.launcher-home');
      assert.equal(await again.locator('.launcher-detail').count(), 0, 'the Back gesture closes the detail');
      assert.deepEqual(again.failures, []);
      await again.close();
    });

    test(`${engine}: run details cover a capped list and a run that changed nothing`, async () => {
      const page = await open(b, profile);
      await painted(page, '[data-part="runs"] .launcher-more');
      await page.click('[data-part="runs"] .launcher-more');
      await page.locator('[data-part="runs"] .launcher-row').nth(1).click();
      await painted(page, '.launcher-detail');
      const capped = await page.locator('.launcher-detail').innerText();
      assert.match(capped, /Contact 70, Account 50/);
      assert.match(capped, /118 more changed/);
      await page.click('.launcher-return');
      await painted(page, '.launcher-home');
      await page.locator('[data-part="runs"] .launcher-row').nth(2).click();
      await painted(page, '.launcher-detail');
      const stopped = await page.locator('.launcher-detail').innerText();
      assert.match(stopped, /Nothing changed/);
      assert.doesNotMatch(stopped, /more changed/);
      await page.close();
    });

    test(`${engine}: the real home route drives the launcher, with no fixture`, async () => {
      const page = await open(b, profile, { real: true, seen: [] });
      await painted(page, '.launcher[data-ready]');
      const tiles = await page.$$eval('.launcher-tile', (ns) => ns.map((n) => [n.querySelector('strong').textContent, n.querySelector('small').textContent]));
      assert.ok(tiles.some(([name, count]) => name === 'Deal' && count === '1'), JSON.stringify(tiles));
      assert.deepEqual(await page.$$eval('.launcher [data-part]', (ns) => ns.map((n) => n.dataset.part)), ['search', 'tables', 'about']);
      await page.click(`.launcher-tile[href="#/table/${ids.contact}"]`);
      await page.waitForFunction((id) => location.hash === `#/table/${id}`, ids.contact);
      await page.close();
    });

    test(`${engine}: recents stay in this space, drop deleted views and link saved views`, async () => {
      const page = await open(b, profile);
      await painted(page, '[data-part="views"] .launcher-row');
      const text = await page.locator('.launcher').innerText();
      assert.doesNotMatch(text, /Deleted view|Other space row/);
      assert.doesNotMatch(text.replace(/1,?234,?567/, ''), /\brows?\b/i, 'the launcher labels by table name');
      assert.match(text, /Deal · Board/);
      assert.match(text, /Deal #48 · Proposal/);
      assert.equal(await page.locator('[data-part="views"] a.launcher-row').first().getAttribute('href'), `#/table/${ids.deal}/view/v1`);
      await page.close();
    });

    test(`${engine}: About opens the description in its own pane`, async () => {
      const page = await open(b, profile);
      await painted(page, '.launcher-about');
      await painted(page, '#main > .view-header .view-desc-body p');
      await page.click('.launcher-about');
      await painted(page, '.launcher-detail .wv-prose p');
      const body = await page.locator('.launcher-detail').innerText();
      assert.match(body, /About this space/);
      assert.match(body, /Pipeline, accounts and the people behind them\./);
      await page.close();
    });

    test(`${engine}: the search box opens the palette scoped to this space's tables, with no pick marks`, async () => {
      const page = await open(b, profile);
      await painted(page, '.launcher-search');
      assert.match(await page.locator('.launcher-search').innerText(), /Find in Sales/);
      const asked = page.waitForRequest((r) => r.url().includes('/api/search?'));
      await page.click('.launcher-search');
      const url = new URL((await asked).url());
      assert.deepEqual(url.searchParams.get('tables').split(',').sort(), payload.tables.map((t) => t.id).sort());
      await page.waitForSelector('#cmdk-input');
      await page.fill('#cmdk-input', 'Maya');
      await page.waitForSelector('#cmdk-results[data-query="Maya"] .result');
      assert.ok((await page.locator('#cmdk-results .result').first().boundingBox()).height >= 44, 'palette rows clear 44 px on a phone');
      assert.equal(await page.locator('#cmdk-results .cmdk-check').count(), 0, 'scoped browsing draws no checkboxes');
      assert.equal(await page.locator('#cmdk-results .result[aria-checked]').count(), 0);
      await page.click('#cmdk-results .result');
      await page.waitForFunction((id) => location.hash.includes(`e=${id}`), ids.maya);
      await page.close();
    });

    for (const theme of ['light', 'dark']) {
      test(`${engine} ${theme}: every control clears 44 px and messy data stays inside the phone`, async () => {
        const page = await open(b, profile, { theme });
        await painted(page, '.launcher-about');
        for (const more of await page.$$('.launcher-more')) await more.click();
        const read = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          const main = document.querySelector('#main');
          const hits = [...document.querySelectorAll('.launcher a[href], .launcher button')].filter((n) => n.getClientRects().length);
          const tile = document.querySelector('.launcher-tile');
          return {
            theme: document.documentElement.dataset.bsTheme,
            small: hits.map((n) => { const r = n.getBoundingClientRect(); return { t: n.textContent.slice(0, 30), w: r.width, h: r.height }; }).filter((b) => b.h < 44 || b.w < 44),
            over: hits.filter((n) => { const r = n.getBoundingClientRect(); return r.right > vw + 0.5 || r.left < -0.5; }).map((n) => n.textContent.slice(0, 30)),
            pageWide: document.documentElement.scrollWidth - vw,
            mainWide: main.scrollWidth - main.clientWidth,
            columns: getComputedStyle(document.querySelector('.launcher-tiles')).gridTemplateColumns.split(' ').length,
            ghosts: document.querySelectorAll('.launcher .icon-ghost').length,
            tileBg: getComputedStyle(tile.querySelector('.launcher-tile-icon')).backgroundColor,
            text: getComputedStyle(tile.querySelector('strong')).color,
            count: hits.length,
          };
        });
        assert.equal(read.theme, theme);
        assert.deepEqual(read.small, []);
        assert.deepEqual(read.over, []);
        assert.ok(read.pageWide <= 0, `page overflows by ${read.pageWide}`);
        assert.ok(read.mainWide <= 0, `main overflows by ${read.mainWide}`);
        assert.equal(read.columns, 3);
        assert.equal(read.ghosts, 0, 'every launcher icon is in the icon set');
        await page.evaluate(() => { const m = document.querySelector('#main'); m.scrollTop = m.scrollHeight; });
        const clear = await page.evaluate(() => document.querySelector('.launcher-about').getBoundingClientRect().bottom <= document.querySelector('.phone-search').getBoundingClientRect().top);
        assert.ok(clear, 'the last control scrolls clear of the bottom bar');
        assert.ok(read.count > 15);
        assert.notEqual(read.tileBg, read.text);
        await page.close();
      });
    }

    test(`${engine}: empty sections disappear, with nothing but the header left in a bare space`, async () => {
      const bare = { space: { id: ids.empty, name: 'Bare', icon: '', description: '' }, tables: [], runs: [] };
      const page = await open(b, profile, { load: bare, seen: [], space: ids.empty });
      await painted(page, '.launcher[data-ready]', { state: 'attached' });
      const parts = await page.$$eval('.launcher [data-part]', (ns) => ns.map((n) => n.dataset.part));
      assert.deepEqual(parts, []);
      await page.close();
      const some = await open(b, profile, { load: { ...payload, runs: payload.runs.slice(0, 2) }, seen: [] });
      await painted(some, '.launcher-tile');
      assert.deepEqual(await some.$$eval('.launcher [data-part]', (ns) => ns.map((n) => n.dataset.part)), ['search', 'tables', 'runs', 'about']);
      assert.equal(await some.locator('[data-part="runs"] .launcher-more').count(), 0, 'two runs need no More control');
      await some.close();
    });

    test(`${engine}: leaving the space while the launcher script loads paints nothing on the next page`, async () => {
      const page = await b.newPage(profile);
      let release;
      const held = new Promise((r) => { release = r; });
      await page.route('**/space-launcher-view.js', async (route) => { await held; await route.continue(); });
      await page.goto(`${base}/#/space/${ids.sales}`);
      await painted(page, '#main > .view-header');
      await page.evaluate((id) => { location.hash = `#/table/${id}`; }, ids.deal);
      await page.waitForFunction(() => document.querySelector('#main .table-filter-btn'));
      const loaded = page.waitForResponse('**/space-launcher-view.js');
      release();
      await loaded;
      await page.waitForLoadState('networkidle');
      assert.equal(await page.locator('.launcher').count(), 0);
      await page.close();
    });

    test(`${engine}: a failed load says so and retries`, async () => {
      const page = await open(b, profile, { load: null });
      await painted(page, '.launcher-failed');
      assert.match(await page.locator('.launcher-failed').innerText(), /home broke/);
      await page.unroute('**/api/spaces/*/home');
      await page.route('**/api/spaces/*/home', (route) => route.fulfill({ json: payload }));
      await page.click('.launcher-failed button');
      await painted(page, '.launcher-tile');
      await page.close();
    });
  }

  test('a desktop width never renders the launcher', async () => {
    const page = await open(browser, { viewport: { width: 1280, height: 844 } });
    await painted(page, '#main > .view-header');
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('.launcher').count(), 0);
    await page.close();
  });
}
