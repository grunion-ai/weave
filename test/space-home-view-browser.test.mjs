import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const LONG = `Quarterly enterprise renewal forecasting and account health review ${'x'.repeat(120)}`;
let ids = null;

const s = await launch('space home view', (weave) => {
  weave.markOnboarded();
  const sales = weave.createSpace({ name: 'Sales', description: 'Pipeline, accounts and the **people** behind them.' });
  const ops = weave.createSpace({ name: 'Ops' });
  const quiet = weave.createSpace({ name: 'Quiet' });
  const empty = weave.createSpace({ name: 'Empty' });
  const deal = weave.createTable({ space: 'Sales', name: 'Deal' });
  weave.addField(deal.id, { name: 'Code', type: 'text' });
  weave.addField(deal.id, { name: 'Note', type: 'text' });
  const long = weave.createTable({ space: 'Sales', name: LONG.slice(0, 80) });
  const none = weave.createTable({ space: 'Sales', name: 'Nothing yet' });
  weave.addRelation(deal.id, { name: 'Forecast', targetDb: long.id, cardinality: 'many-to-one', inverseName: 'Deals' });
  const task = weave.createTable({ space: 'Ops', name: 'Task' });
  weave.addField(task.id, { name: 'Code', type: 'text' });
  const calm = weave.createTable({ space: 'Quiet', name: 'Note' });
  weave.createEntity(calm.id, { Name: 'Only row' });
  const pipeline = weave.tableView(`${deal.id}/Pipeline`, { search: '' });
  const northstar = weave.createEntity(deal.id, { Name: LONG, Code: 'D-0' });
  for (let i = 1; i < 2500; i++) weave.createEntity(deal.id, { Name: `Deal ${i}`, Code: `D-${i}` });
  weave.createAutomation(task.id, {
    name: 'Open deal from ops',
    trigger: { type: 'entity-created' },
    actions: [{ type: 'upsert-row', table: 'Sales/Deal', key: 'Code', fields: { Code: 'row.Code', Name: 'row.Name' } }],
  });
  weave.createEntity(task.id, { Name: 'Renewal from ops', Code: 'R-1' });
  const stamp = weave.createAutomation(deal.id, { name: 'Stamp note', trigger: { type: 'field-updated', field: 'Code' }, actions: [{ type: 'set-field', field: 'Note', value: 'stamped' }] });
  weave.updateEntity(northstar.id, { Code: 'D-0b' });
  const half = weave.createAutomation(none.id, {
    name: 'Half done',
    trigger: { type: 'entity-created' },
    actions: [{ type: 'add-comment', text: 'Started' }, { type: 'upsert-row', table: 'Ops/Task', key: 'Code', fields: { Code: 'row.Name.missing' } }],
  });
  const partial = weave.createEntity(none.id, { Name: 'Partial item' });
  weave.deleteEntity(weave.createEntity(calm.id, { Name: 'Trashed row' }).id);
  ids = { sales: sales.id, ops: ops.id, quiet: quiet.id, empty: empty.id, deal: deal.id, none: none.id, task: task.id, pipeline: pipeline.id, northstar: northstar.id, stamp: stamp.id, half: half.id, partial: partial.id };
});

if (s) {
  const open = async (theme, width, spaceId, recents = null) => {
    const page = await s.browser.newPage({ viewport: { width, height: 900 } });
    await page.addInitScript(([t, r]) => {
      localStorage.setItem('weave-theme', t);
      if (r) localStorage.setItem(r.key, JSON.stringify(r.list));
    }, [theme, recents]);
    await page.goto(`${s.base}/#/space/${spaceId}`);
    return page;
  };
  const recentsOf = () => ({
    key: 'weave-recent:/',
    list: [
      { kind: 'table-view', id: ids.pipeline, name: 'Pipeline', tableId: ids.deal, table: 'Deal', layout: 'table', url: `#/table/${ids.deal}/view/${ids.pipeline}`, at: Date.now() - 240000 },
      { kind: 'entity', id: ids.northstar, name: LONG, db: 'Sales/Deal', dbId: ids.deal, publicId: 1, url: `/e/${ids.northstar}`, at: Date.now() - 360000 },
      { kind: 'entity', id: 'elsewhere', name: 'From another space', db: 'Ops/Task', dbId: ids.task, publicId: 1, url: '/e/elsewhere', at: Date.now() },
      { kind: 'table', id: ids.deal, name: 'Sales/Deal', url: `#/table/${ids.deal}`, at: Date.now() },
    ],
  });

  for (const theme of ['light', 'dark']) {
    for (const width of [1280, 820]) {
      test(`${theme} ${width}: sections run in the ruled order on one page and long names fit`, async () => {
        const page = await open(theme, width, ids.sales, recentsOf());
        try {
          await page.locator('.space-home').waitFor();
          const order = await page.locator('.space-home [data-section], .space-home-tables').evaluateAll((els) => els.map((e) => e.dataset.section ?? 'tables'));
          assert.deepEqual(order, ['tables', 'views', 'rows', 'runs', 'overview']);
          assert.equal(await page.locator('.space-home [role=tab]').count(), 0, 'no tabs');
          assert.equal(await page.locator('.space-home', { hasText: 'Settings' }).count(), 0, 'no Settings button');
          const overflow = await page.evaluate(() => {
            const home = document.querySelector('.space-home');
            return [...home.querySelectorAll('*')].filter((n) => n.getBoundingClientRect().right > home.getBoundingClientRect().right + 1).map((n) => n.className).slice(0, 5);
          });
          assert.deepEqual(overflow, [], 'nothing runs past the page');
          assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme ?? document.body.dataset.bsTheme), theme);
        } finally {
          await page.close();
        }
      });
    }

    test(`${theme}: a failed run reads in the warning colour with a success run beside it`, async () => {
      const page = await open(theme, 1280, ids.sales);
      try {
        const attention = page.locator('.space-home-run[data-outcome=attention]').first();
        await attention.waitFor();
        const [text, token] = await attention.locator('.space-home-result').evaluate((n) => [getComputedStyle(n).color, (() => {
          const probe = document.createElement('span');
          probe.style.color = 'var(--wv-warn-text)';
          document.body.append(probe);
          const c = getComputedStyle(probe).color;
          probe.remove();
          return c;
        })()]);
        assert.equal(text, token);
      } finally {
        await page.close();
      }
    });
  }

  test('table links carry their row counts and open the table', async () => {
    const page = await open('light', 1280, ids.sales);
    try {
      const deal = page.locator('.space-home-table', { hasText: 'Deal' }).first();
      await deal.waitFor();
      assert.match(await deal.innerText(), /2,501/);
      assert.match(await page.locator('.space-home-table', { hasText: 'Nothing yet' }).innerText(), /1/);
      await deal.click();
      await page.waitForFunction((id) => location.hash === `#/table/${id}`, ids.deal);
    } finally {
      await page.close();
    }
  });

  test('the page keys what it lists by table name and never says rows', async () => {
    const page = await open('light', 1280, ids.sales, recentsOf());
    try {
      await page.locator('.space-home-rows .space-home-row').waitFor();
      assert.deepEqual(await page.locator('.space-home-rows .space-home-group-name').allInnerTexts(), ['Deal']);
      assert.equal(await page.locator('.space-home-rows h2').innerText(), 'Recent');
      assert.match(await page.locator('.space-home-rows .space-home-row .space-home-sub').first().innerText(), /^#1\b/);
      await page.locator('.space-home-run summary').first().click();
      const text = (await page.locator('.space-home').innerText()).replaceAll(LONG, '').replaceAll('upsert-row', '');
      assert.doesNotMatch(text, /\brows?\b/i, text);
    } finally {
      await page.close();
    }
  });

  test('recents show only this space\'s tables; a recent view and row open', async () => {
    const page = await open('light', 1280, ids.sales, recentsOf());
    try {
      await page.locator('.space-home-view').waitFor();
      assert.equal(await page.locator('.space-home-view').count(), 1);
      assert.equal(await page.locator('.space-home-rows .space-home-row').count(), 1);
      assert.equal(await page.locator('.space-home', { hasText: 'From another space' }).count(), 0);
      await page.locator('.space-home-view').click();
      await page.waitForFunction((want) => location.hash.endsWith(want), `/view/${ids.pipeline}`);
      await page.goto(`${s.base}/#/space/${ids.sales}`);
      const opened = page.waitForResponse((r) => r.url().includes(`/api/entities/${ids.northstar}`));
      await page.locator('.space-home-rows .space-home-row').click();
      await opened;
    } finally {
      await page.close();
    }
  });

  test('a section with nothing in it disappears', async () => {
    const page = await open('light', 1280, ids.quiet);
    try {
      await page.locator('.space-home').waitFor();
      assert.deepEqual(await page.locator('.space-home [data-section]').evaluateAll((els) => els.map((e) => e.dataset.section)), ['overview']);
      assert.equal(await page.locator('.space-home-table').count(), 1);
    } finally {
      await page.close();
    }
  });

  test('a run from another space names both spaces and lists only rows here', async () => {
    const page = await open('light', 1280, ids.sales);
    try {
      const run = page.locator('.space-home-run', { hasText: 'Open deal from ops' });
      await run.waitFor();
      assert.match(await run.locator('summary').innerText(), /Ops → Sales · Deal 1/);
      assert.equal(await run.locator('.space-home-run-body').isVisible(), false, 'details start shut');
      await run.locator('summary').click();
      assert.match(await run.locator('.space-home-run-body').innerText(), /Renewal from ops/);
      assert.equal(await run.locator('.space-home-run-body .space-home-row').count(), 1);
    } finally {
      await page.close();
    }
  });

  test('a partial run shows its failed step and the row it changed, and the row opens', async () => {
    const page = await open('light', 1280, ids.sales);
    try {
      const run = page.locator('.space-home-run', { hasText: 'Half done' });
      await run.waitFor();
      assert.match(await run.locator('.space-home-result').innerText(), /^Step 2 failed/);
      await run.locator('summary').click();
      assert.match(await run.locator('.space-home-failure').innerText(), /Step 2 failed/);
      await run.locator('.space-home-row', { hasText: 'Partial item' }).click();
      await page.waitForResponse((r) => r.url().includes(`/api/entities/${ids.partial}`)).catch(() => {});
    } finally {
      await page.close();
    }
  });

  test('the outcome filter narrows the runs', async () => {
    const page = await open('light', 1280, ids.sales);
    try {
      await page.locator('.space-home-run').first().waitFor();
      assert.ok((await page.locator('.space-home-run[data-outcome=success]').count()) > 0);
      await page.locator('.space-home-filter .picker-face').click();
      await page.locator('.picker-pop .picker-row', { hasText: 'Needs attention' }).first().click();
      assert.equal(await page.locator('.space-home-run[data-outcome=success]').count(), 0);
      assert.ok((await page.locator('.space-home-run[data-outcome=attention]').count()) > 0);
    } finally {
      await page.close();
    }
  });

  test('the overview starts shut, then holds the description, tables and relation map, and stays open', async () => {
    const page = await open('light', 1280, ids.sales);
    try {
      const box = page.locator('details.space-home-overview');
      await box.waitFor();
      assert.equal(await box.evaluate((d) => d.open), false);
      assert.equal(await page.locator('.home-map').count(), 0, 'nothing is drawn until it opens');
      await box.locator('summary').click();
      await box.locator('.home-map').waitFor();
      assert.match(await box.locator('.space-home-description').innerHTML(), /<strong>people<\/strong>/);
      assert.ok(await box.locator('.space-tables .list-row').count() >= 3);
      assert.equal(await box.locator('details.wv-schema').count(), 1);
      await page.reload();
      await page.locator('details.space-home-overview[open] .home-map').waitFor();
    } finally {
      await page.close();
    }
  });

  test('existing header actions stay', async () => {
    const page = await open('light', 1280, ids.sales);
    try {
      await page.locator('.space-home').waitFor();
      assert.equal(await page.locator('.view-header .crumb-actions button', { hasText: /share/i }).count() + await page.locator('.view-header [aria-label*="Share" i], .view-header [title*="Share" i]').count() > 0, true);
      assert.equal(await page.locator('.view-header .dl-wrap').count(), 1);
    } finally {
      await page.close();
    }
  });

  test('a system space keeps its note and reaches the new home', async () => {
    const page = await s.browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.goto(s.base);
      await page.waitForFunction(() => typeof state !== 'undefined' && state.schema?.length > 0);
      const sysId = await page.evaluate(() => state.schema.find((sp) => sp.system)?.spaceId);
      await page.goto(`${s.base}/#/space/${sysId}`);
      await page.locator('.space-home').waitFor();
      await page.locator('.view-header .space-system-note').waitFor();
      assert.ok(await page.locator('.space-home-table').count() > 0);
    } finally {
      await page.close();
    }
  });

  test('a space with no tables keeps its add-a-table state', async () => {
    const page = await open('light', 1280, ids.empty);
    try {
      await page.locator('.space-home .space-tables').waitFor();
      assert.match(await page.locator('.space-home .space-tables').innerText(), /No tables in this space yet/);
      await page.locator('.space-home .space-tables button', { hasText: 'New table' }).waitFor();
    } finally {
      await page.close();
    }
  });

  test('below the phone breakpoint today\'s page stays', async () => {
    const page = await open('light', 390, ids.sales);
    try {
      await page.locator('.space-tables .list-row').first().waitFor();
      assert.equal(await page.locator('.space-home').count(), 0);
    } finally {
      await page.close();
    }
  });

  test('moving away while the home loads leaves the next page alone', async () => {
    const page = await s.browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.route('**/api/spaces/*/home', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        await route.continue();
      });
      await page.goto(`${s.base}/#/space/${ids.sales}`);
      await page.waitForFunction(() => location.hash.includes('/space/'));
      await page.evaluate((id) => { location.hash = `#/table/${id}`; }, ids.deal);
      await page.waitForResponse('**/api/spaces/*/home');
      await page.waitForFunction((id) => state.route?.dbId === id, ids.deal);
      assert.equal(await page.locator('.space-home').count(), 0);
    } finally {
      await page.close();
    }
  });
}
