import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { WIDTH } from './lib/viewports.mjs';

const LONG = `Quarterly renewal forecast reconciliation for the northern territories ${'x'.repeat(120)}`;
const minutesAgo = (n) => new Date(Date.now() - n * 60000).toISOString();

const s = await launch('workspace home view', (weave) => {
  weave.markOnboarded();
  weave.updateWorkspace({ description: 'Everything the **studio** runs.' });
  const sales = weave.createSpace({ name: 'Sales', icon: 'lucide:briefcase' });
  const ops = weave.createSpace({ name: 'Ops' });
  const long = weave.createSpace({ name: LONG.slice(0, 80) });
  const deal = weave.createTable({ space: 'Sales', name: 'Deal' });
  const task = weave.createTable({ space: 'Ops', name: 'Task' });
  weave.createTable({ space: LONG.slice(0, 80), name: 'Note' });
  weave.addRelation(deal.id, { name: 'Work', targetDb: task.id, cardinality: 'many-to-one', inverseName: 'Deals' });
  const northstar = weave.createEntity(deal.id, { Name: 'Northstar renewal' });
  const ship = weave.createEntity(task.id, { Name: 'Ship the kit' });
  return { ids: { sales: sales.id, ops: ops.id, long: long.id, deal: deal.id, task: task.id, northstar: northstar.id, ship: ship.id } };
});

const bare = await launch('workspace home view, no tables', (weave) => { weave.markOnboarded(); });

const fullPayload = (ids) => ({
  workspace: { name: 'weave', description: 'Everything the **studio** runs.' },
  spaces: [
    { id: ids.sales, name: 'Sales', icon: 'lucide:briefcase', tables: [{ id: ids.deal, name: 'Deal', icon: null, rowCount: 48, views: [{ id: 'v0', name: 'All', layout: 'table' }, { id: 'v1', name: 'Pipeline', layout: 'board' }] }] },
    { id: ids.ops, name: 'Ops', icon: null, tables: [{ id: ids.task, name: 'Task', icon: null, rowCount: 1200, views: [] }] },
    { id: ids.long, name: LONG.slice(0, 80), icon: null, tables: [] },
  ],
  runs: [
    { workflowId: 'w1', name: 'Renewal follow-up', originSpace: 'Ops', at: minutesAgo(8), outcome: 'attention', failedStep: { step: 2, error: 'Email connection expired' }, changedCount: 1, changedTables: [{ table: 'Deal', count: 1 }], changedRows: [{ id: ids.northstar, publicId: 1, name: 'Northstar renewal', table: 'Deal' }] },
    { workflowId: 'w2', name: 'Stamp task', originSpace: 'Ops', at: minutesAgo(40), outcome: 'success', failedStep: null, changedCount: 1, changedTables: [{ table: 'Task', count: 1 }], changedRows: [{ id: ids.ship, publicId: 1, name: 'Ship the kit', table: 'Task' }] },
  ],
});

const fullRecents = (ids) => [
  { kind: 'table-view', id: 'v1', tableId: ids.deal, name: 'Pipeline', url: `#/table/${ids.deal}/view/v1`, at: Date.now() - 4 * 60000 },
  { kind: 'entity', id: ids.northstar, name: 'Northstar renewal', db: 'Sales/Deal', dbId: ids.deal, publicId: 1, url: `/e/${ids.northstar}`, at: Date.now() - 6 * 60000 },
  { kind: 'entity', id: ids.ship, name: 'Ship the kit', db: 'Ops/Task', dbId: ids.task, publicId: 1, url: `/e/${ids.ship}`, at: Date.now() - 9 * 60000 },
  { kind: 'entity', id: 'gone', name: 'Gone record', db: 'Gone/Thing', publicId: 7, url: '/e/gone', at: Date.now() },
];

if (s) {
  const { base, browser, ids } = s;
  const payload = fullPayload(ids);
  const recents = fullRecents(ids);

  const open = async ({ theme = 'light', width = 1280, load = payload, seen = recents, real = false, overview = false } = {}) => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const failures = [];
    page.on('pageerror', (e) => failures.push(e.message));
    await page.addInitScript(([t, list, openOverview]) => {
      localStorage.setItem('weave-theme', t);
      localStorage.setItem('weave-recent:/', JSON.stringify(list));
      if (openOverview) localStorage.setItem('weave-space-overview-open', '1');
    }, [theme, seen, overview]);
    if (!real) await page.route('**/api/workspace/home', (route) => (load ? route.fulfill({ json: load }) : route.fulfill({ status: 500, json: { error: 'home broke' } })));
    await page.goto(`${base}/#/`);
    page.failures = failures;
    return page;
  };

  for (const theme of ['light', 'dark']) {
    for (const width of [1280, WIDTH.narrowestDesktop]) {
      test(`${theme} ${width}: the workspace opens as one page in the ruled order, with no launcher and no loose cards`, async () => {
        const page = await open({ theme, width });
        try {
          await page.locator('.space-home').waitFor();
          const read = await page.evaluate(() => {
            const main = document.querySelector('#main');
            const home = main.querySelector('.space-home');
            return {
              header: !!main.querySelector(':scope > .view-header'),
              order: [...home.querySelectorAll('[data-section], .space-home-tables')].map((n) => n.dataset.section ?? n.getAttribute('aria-label')),
              loose: main.querySelectorAll(':scope > .system-tables, :scope > .home-map, :scope > .card.list-rows, :scope > details.wv-schema').length,
              launcher: main.querySelectorAll('.launcher').length,
              tabs: home.querySelectorAll('[role=tab]').length,
              over: [...home.querySelectorAll('*')].filter((n) => n.getBoundingClientRect().right > home.getBoundingClientRect().right + 1).map((n) => n.className).slice(0, 5),
              theme: document.documentElement.dataset.bsTheme ?? document.body.dataset.bsTheme,
            };
          });
          assert.ok(read.header, 'the workspace header stays');
          assert.deepEqual(read.order, ['Spaces', 'views', 'rows', 'runs', 'overview']);
          assert.equal(read.loose, 0, 'the cards live in the overview');
          assert.equal(read.launcher, 0);
          assert.equal(read.tabs, 0, 'no tabs');
          assert.deepEqual(read.over, [], 'nothing runs past the page');
          assert.equal(read.theme, theme);
          assert.deepEqual(page.failures, []);
        } finally {
          await page.close();
        }
      });
    }
  }

  test('one link per space with its record count, opening the space', async () => {
    const page = await open();
    try {
      await page.locator('.space-home-table').first().waitFor();
      const links = await page.locator('.space-home-table').evaluateAll((ns) => ns.map((n) => ({ name: n.querySelector('.space-home-table-name').textContent, count: n.querySelector('.space-home-count').textContent, href: n.getAttribute('href') })));
      assert.deepEqual(links.map((l) => l.name), ['Sales', 'Ops', LONG.slice(0, 80)]);
      assert.deepEqual(links[0], { name: 'Sales', count: '48', href: `#/space/${ids.sales}` });
      assert.equal(links[1].count, '1,200');
      assert.equal(links[2].count, '0');
      await page.locator(`.space-home-table[href="#/space/${ids.ops}"]`).click();
      await page.waitForFunction((id) => location.hash === `#/space/${id}`, ids.ops);
    } finally {
      await page.close();
    }
  });

  test('recents span every space, key by table name and drop records from tables that are gone', async () => {
    const page = await open();
    try {
      await page.locator('.space-home-rows .space-home-row').first().waitFor();
      assert.deepEqual(await page.locator('.space-home-rows .space-home-group-name').allInnerTexts(), ['Deal', 'Task']);
      assert.equal(await page.locator('.space-home-rows .space-home-row').count(), 2);
      assert.equal(await page.locator('.space-home', { hasText: 'Gone record' }).count(), 0);
      assert.match(await page.locator('.space-home-view').innerText(), /Pipeline[\s\S]*Deal · Board/);
      const text = await page.locator('.space-home').innerText();
      assert.doesNotMatch(text, /\brows?\b/i, text);
      await page.locator('.space-home-view').click();
      await page.waitForFunction((want) => location.hash.endsWith(want), '/view/v1');
    } finally {
      await page.close();
    }
  });

  test('a run names the space it started in, with no arrow, and opens to the record it changed', async () => {
    const page = await open();
    try {
      const run = page.locator('.space-home-run', { hasText: 'Renewal follow-up' });
      await run.waitFor();
      assert.match(await run.locator('summary').innerText(), /Ops · Deal 1/);
      assert.doesNotMatch(await run.locator('summary').innerText(), /→/);
      assert.match(await run.locator('.space-home-result').innerText(), /^Step 2 failed/);
      assert.match(await page.locator('.space-home-runs .space-home-note').innerText(), /^Changes in /);
      assert.doesNotMatch(await page.locator('.space-home-runs .space-home-note').innerText(), /other spaces/);
      await run.locator('summary').click();
      assert.match(await run.locator('.space-home-run-body').innerText(), /Northstar renewal/);
      await page.locator('.space-home-filter .picker-face').click();
      await page.locator('.picker-pop .picker-row', { hasText: 'Needs attention' }).first().click();
      assert.equal(await page.locator('.space-home-run[data-outcome=success]').count(), 0);
    } finally {
      await page.close();
    }
  });

  test('the overview starts shut, then holds the description, system tables, relation map and spaces registry, and stays open', async () => {
    const page = await open();
    try {
      const box = page.locator('details.space-home-overview');
      await box.waitFor();
      assert.equal(await box.evaluate((d) => d.open), false);
      assert.match(await box.locator('summary').innerText(), /Workspace overview/);
      assert.equal(await page.locator('.system-tables, .home-map').count(), 0, 'nothing is drawn until it opens');
      await box.locator('summary').click();
      await box.locator('.home-map').waitFor();
      assert.match(await box.locator('.space-home-description').innerHTML(), /<strong>studio<\/strong>/);
      assert.match(await box.locator('.system-tables').innerText(), /Activity/);
      assert.equal(await box.locator('details.wv-schema').count(), 1);
      await page.reload();
      await page.locator('details.space-home-overview[open] .home-map').waitFor();
      await page.locator('details.space-home-overview .system-tables .list-row[data-href="#/activity"]').click();
      await page.waitForFunction(() => location.hash === '#/activity');
    } finally {
      await page.close();
    }
  });

  test('the real workspace home route drives the page, and the system space has no link', async () => {
    const page = await open({ real: true, seen: [] });
    try {
      await page.locator('.space-home-table').first().waitFor();
      const links = await page.locator('.space-home-table').evaluateAll((ns) => ns.map((n) => [n.querySelector('.space-home-table-name').textContent, n.querySelector('.space-home-count').textContent]));
      assert.ok(links.some(([name, count]) => name === 'Sales' && count === '1'), JSON.stringify(links));
      assert.ok(!links.some(([name]) => /^(System|Workspace)$/.test(name)), 'the system space has no link');
      assert.deepEqual(await page.locator('.space-home [data-section]').evaluateAll((els) => els.map((e) => e.dataset.section)), ['overview'], 'empty sections disappear');
    } finally {
      await page.close();
    }
  });

  test('a failed home read still draws the space links from the schema', async () => {
    const page = await open({ load: null, seen: [] });
    try {
      await page.locator('.space-home-table').first().waitFor();
      const names = await page.locator('.space-home-table-name').allInnerTexts();
      assert.deepEqual(names.slice().sort(), ['Ops', 'Sales', LONG.slice(0, 80)].sort());
      assert.match(await page.locator(`.space-home-table[href="#/space/${ids.sales}"]`).innerText(), /1/);
    } finally {
      await page.close();
    }
  });

  test('two draws of the home that overlap paint one page', async () => {
    const page = await open();
    try {
      await page.locator('.space-home-rows .space-home-row').first().waitFor();
      await page.evaluate(() => Promise.all([route(), route()]));
      await page.locator('.space-home-rows .space-home-row').first().waitFor();
      assert.equal(await page.locator('.space-home').count(), 1);
      assert.equal(await page.locator('.space-home-rows .space-home-row').count(), 2);
    } finally {
      await page.close();
    }
  });

  test('moving away while the home loads leaves the next page alone', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      let asked;
      const requested = new Promise((resolve) => { asked = resolve; });
      let release;
      const held = new Promise((resolve) => { release = resolve; });
      await page.route('**/api/workspace/home', async (route) => {
        asked();
        await held;
        await route.continue();
      }, { times: 1 });
      await page.goto(`${base}/#/`);
      await requested;
      await page.evaluate((id) => { location.hash = `#/table/${id}`; }, ids.deal);
      await page.waitForFunction((id) => state.route?.dbId === id, ids.deal);
      const answered = page.waitForResponse('**/api/workspace/home');
      release();
      await (await answered).finished();
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.locator('.space-home').count(), 0);
    } finally {
      await page.close();
    }
  });

  test('below the phone breakpoint the launcher replaces the home', async () => {
    const page = await open({ width: WIDTH.phone });
    try {
      await page.locator('.launcher[data-ready]').waitFor({ state: 'attached' });
      assert.equal(await page.locator('.space-home').count(), 0);
    } finally {
      await page.close();
    }
  });
}

if (bare) {
  test('a workspace with no tables keeps its onboarding card and today\'s cards', async () => {
    const page = await bare.browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.goto(`${bare.base}/#/`);
      await page.locator('#main > .system-tables').waitFor();
      assert.equal(await page.locator('.space-home').count(), 0);
    } finally {
      await page.close();
    }
  });
}
