import test from 'node:test';
import assert from 'node:assert/strict';
import { engineOf, launch, painted, phoneProfile } from './lib/browser.mjs';

const IPHONE = phoneProfile()?.page ?? null;
const LONG = 'Quarterly renewal forecast reconciliation for the northern territories and every partner';
const minutesAgo = (n) => new Date(Date.now() - n * 60000).toISOString();

const s = await launch('workspace launcher', (weave) => {
  weave.updateWorkspace({ description: 'Everything the studio runs.' });
  const sales = weave.createSpace({ name: 'Sales', icon: 'lucide:briefcase' });
  const ops = weave.createSpace({ name: 'Ops' });
  const long = weave.createSpace({ name: LONG });
  const deal = weave.createTable({ space: 'Sales', name: 'Deal' });
  const task = weave.createTable({ space: 'Ops', name: 'Task' });
  weave.createTable({ space: LONG, name: 'Note' });
  const northstar = weave.createEntity(deal, { name: 'Northstar renewal' });
  const ship = weave.createEntity(task, { name: 'Ship the kit' });
  return { ids: { sales: sales.id, ops: ops.id, long: long.id, deal: deal.id, task: task.id, northstar: northstar.id, ship: ship.id } };
});

const fullPayload = (ids) => ({
  workspace: { name: 'weave', description: 'Everything the studio runs.' },
  spaces: [
    { id: ids.sales, name: 'Sales', icon: 'lucide:briefcase', tables: [{ id: ids.deal, name: 'Deal', icon: null, rowCount: 48, views: [{ id: 'v1', name: 'Pipeline', layout: 'board' }] }] },
    { id: ids.ops, name: 'Ops', icon: null, tables: [{ id: ids.task, name: 'Task', icon: null, rowCount: 1200, views: [] }] },
    { id: ids.long, name: LONG, icon: null, tables: [] },
  ],
  runs: [
    { workflowId: 'w1', name: 'Renewal follow-up', originSpace: 'Ops', at: minutesAgo(8), outcome: 'attention', failedStep: { step: 2, error: 'Email connection expired' }, changedCount: 1, changedTables: [{ table: 'Deal', count: 1 }], changedRows: [{ id: ids.northstar, publicId: 1, name: 'Northstar renewal', table: 'Deal' }] },
    { workflowId: 'w2', name: 'Stamp task', originSpace: 'Ops', at: minutesAgo(40), outcome: 'success', failedStep: null, changedCount: 1, changedTables: [{ table: 'Task', count: 1 }], changedRows: [{ id: ids.ship, publicId: 1, name: 'Ship the kit', table: 'Task' }] },
  ],
});

const fullRecents = (ids) => [
  { kind: 'table-view', id: 'v1', tableId: ids.deal, name: 'Pipeline', url: `#/table/${ids.deal}/view/v1`, at: Date.now() - 4 * 60000 },
  { kind: 'entity', id: ids.northstar, name: 'Northstar renewal', db: 'Sales/Deal', dbId: ids.deal, publicId: 1, url: `/e/${ids.northstar}`, at: Date.now() - 6 * 60000 },
  { kind: 'entity', id: ids.ship, name: 'Ship the kit', db: 'Ops/Task', dbId: ids.task, publicId: 1, url: `/e/${ids.ship}` },
  { kind: 'entity', id: 'gone', name: 'Gone row', db: 'Gone/Thing', publicId: 7, url: '/e/gone' },
];

if (s) {
  const { base, browser, ids } = s;
  const payload = fullPayload(ids);
  const recents = fullRecents(ids);
  const engines = [['chromium 390x844', browser, { viewport: { width: 390, height: 844 } }]];
  const webkit = await engineOf('webkit');
  if (webkit && IPHONE) engines.push(['webkit iPhone 15', webkit, IPHONE]);

  const open = async (b, profile, { theme = 'light', load = payload, seen = recents, real = false } = {}) => {
    const page = await b.newPage(profile);
    const failures = [];
    page.on('pageerror', (e) => failures.push(e.message));
    await page.addInitScript(([t, list]) => {
      localStorage.setItem('weave-theme', t);
      localStorage.setItem('weave-recent:/', JSON.stringify(list));
    }, [theme, seen]);
    if (!real) await page.route('**/api/workspace/home', (route) => (load ? route.fulfill({ json: load }) : route.fulfill({ status: 500, json: { error: 'home broke' } })));
    await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
    page.failures = failures;
    return page;
  };

  for (const [engine, b, profile] of engines) {
    test(`${engine}: the workspace opens as a launcher under its header, with no desktop cards`, async () => {
      const page = await open(b, profile);
      await painted(page, '.launcher[data-ready]');
      const read = await page.evaluate(() => {
        const main = document.querySelector('#main');
        return {
          header: !!main.querySelector(':scope > .view-header'),
          kids: [...main.querySelector('.launcher-home').children].map((n) => n.dataset.part),
          desktop: main.querySelectorAll(':scope > .system-tables, :scope > .home-map, :scope > .card.list-rows').length,
          search: main.querySelector('.launcher-search').textContent,
        };
      });
      assert.ok(read.header, 'the workspace header stays');
      assert.deepEqual(read.kids, ['search', 'spaces', 'views', 'rows', 'runs', 'about']);
      assert.equal(read.desktop, 0, 'the desktop cards do not render on a phone');
      assert.match(read.search, /^Find in /);
      assert.deepEqual(page.failures, []);
      await page.close();
    });

    test(`${engine}: one tile per space with its record count, opening the space`, async () => {
      const page = await open(b, profile);
      await painted(page, '[data-part="spaces"] .launcher-tile');
      const tiles = await page.$$eval('.launcher-tile', (ns) => ns.map((n) => ({ name: n.querySelector('strong').textContent, count: n.querySelector('small').textContent, href: n.getAttribute('href') })));
      assert.deepEqual(tiles.map((t) => t.name), ['Sales', 'Ops', LONG]);
      assert.deepEqual(tiles[0], { name: 'Sales', count: '48', href: `#/space/${ids.sales}` });
      assert.equal(tiles[1].count, '1,200');
      assert.equal(tiles[2].count, '0');
      await page.click(`.launcher-tile[href="#/space/${ids.ops}"]`);
      await page.waitForFunction((id) => location.hash === `#/space/${id}`, ids.ops);
      await page.close();
    });

    test(`${engine}: recents span every space and drop rows from tables that are gone`, async () => {
      const page = await open(b, profile);
      await painted(page, '[data-part="rows"] .launcher-row');
      const text = await page.locator('.launcher').innerText();
      assert.match(text, /Northstar renewal/);
      assert.match(text, /Deal · Board/);
      assert.doesNotMatch(text, /Gone row/);
      assert.match(await page.locator('[data-part="rows"]').innerText(), /Ship the kit/);
      assert.equal(await page.locator('[data-part="rows"] .launcher-more').count(), 0, 'two recents need no More control');
      await page.close();
    });

    test(`${engine}: a run names where it started and opens details with no affected space line`, async () => {
      const page = await open(b, profile);
      await painted(page, '[data-part="runs"] .launcher-row');
      const first = page.locator('[data-part="runs"] .launcher-row').first();
      assert.match(await first.innerText(), /Ops · Deal 1/);
      assert.doesNotMatch(await first.innerText(), /→/);
      await first.click();
      await painted(page, '.launcher-detail');
      const body = await page.locator('.launcher-detail').innerText();
      for (const want of ['Renewal follow-up', 'Partial completion', 'Started in', 'Ops', 'Step 2: Email connection expired', 'Northstar renewal']) assert.ok(body.includes(want), `detail names ${want}`);
      assert.doesNotMatch(body, /Affected space/);
      await page.click('.launcher-return');
      await painted(page, '.launcher-home');
      assert.equal(await page.locator('#main > .view-header').isVisible(), true);
      await page.close();
    });

    test(`${engine}: About this workspace holds the description, the system tables and the relation map`, async () => {
      const page = await open(b, profile);
      await painted(page, '.launcher-about');
      assert.match(await page.locator('.launcher-about').innerText(), /About this workspace/);
      await painted(page, '#main > .view-header .view-desc-body p');
      await page.click('.launcher-about');
      await painted(page, '.launcher-detail .system-tables .list-row');
      const body = await page.locator('.launcher-detail').innerText();
      assert.match(body, /Everything the studio runs\./);
      assert.match(body, /Activity/);
      await page.click('.launcher-detail .system-tables .list-row[data-href="#/activity"]');
      await page.waitForFunction(() => location.hash === '#/activity');
      await page.close();
    });

    test(`${engine}: the real workspace home route drives the launcher, with no fixture`, async () => {
      const page = await open(b, profile, { real: true, seen: [] });
      await painted(page, '.launcher[data-ready]');
      const tiles = await page.$$eval('.launcher-tile', (ns) => ns.map((n) => [n.querySelector('strong').textContent, n.querySelector('small').textContent]));
      assert.ok(tiles.some(([name, count]) => name === 'Sales' && count === '1'), JSON.stringify(tiles));
      assert.ok(!tiles.some(([name]) => /^(System|Workspace)$/.test(name)), 'the system space has no tile');
      await page.close();
    });

    for (const theme of ['light', 'dark']) {
      test(`${engine} ${theme}: every control clears 44 px and long names stay inside the phone`, async () => {
        const page = await open(b, profile, { theme });
        await painted(page, '.launcher-about');
        for (const more of await page.$$('.launcher-more')) await more.click();
        const read = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          const main = document.querySelector('#main');
          const hits = [...document.querySelectorAll('.launcher a[href], .launcher button')].filter((n) => n.getClientRects().length);
          return {
            theme: document.documentElement.dataset.bsTheme,
            small: hits.map((n) => { const r = n.getBoundingClientRect(); return { t: n.textContent.slice(0, 30), w: r.width, h: r.height }; }).filter((x) => x.h < 44 || x.w < 44),
            over: hits.filter((n) => { const r = n.getBoundingClientRect(); return r.right > vw + 0.5 || r.left < -0.5; }).map((n) => n.textContent.slice(0, 30)),
            pageWide: document.documentElement.scrollWidth - vw,
            mainWide: main.scrollWidth - main.clientWidth,
            ghosts: document.querySelectorAll('.launcher .icon-ghost').length,
          };
        });
        assert.equal(read.theme, theme);
        assert.deepEqual(read.small, []);
        assert.deepEqual(read.over, []);
        assert.ok(read.pageWide <= 0, `page overflows by ${read.pageWide}`);
        assert.ok(read.mainWide <= 0, `main overflows by ${read.mainWide}`);
        assert.equal(read.ghosts, 0, 'every launcher icon is in the icon set');
        await page.close();
      });
    }

    test(`${engine}: a failed load says so and retries`, async () => {
      const page = await open(b, profile, { load: null });
      await painted(page, '.launcher-failed');
      assert.match(await page.locator('.launcher-failed').innerText(), /This workspace did not load: home broke/);
      await page.unroute('**/api/workspace/home');
      await page.route('**/api/workspace/home', (route) => route.fulfill({ json: payload }));
      await page.click('.launcher-failed button');
      await painted(page, '.launcher-tile');
      await page.close();
    });

    test(`${engine}: leaving home while the launcher script loads paints nothing on the next page`, async () => {
      const page = await b.newPage(profile);
      let release;
      const held = new Promise((r) => { release = r; });
      await page.route('**/space-launcher-view.js', async (route) => { await held; await route.continue(); });
      await page.goto(`${base}/#/`);
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
  }

  test('a desktop width keeps the workspace cards and never renders the launcher', async () => {
    const page = await open(browser, { viewport: { width: 1280, height: 844 } });
    await painted(page, '#main > .system-tables');
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('.launcher').count(), 0);
    await page.close();
  });
}
