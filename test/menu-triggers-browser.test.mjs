import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { launch } from './lib/browser.mjs';

let scratch;
const s = await launch('menu triggers', (weave) => {
  scratch = new Weave();
  scratch.state.meta.name = 'scratch';
  scratch.markOnboarded();
  const space = weave.createSpace({ name: 'Product' });
  const tasks = weave.createTable({ space: 'Product', name: 'Task' });
  weave.addField(tasks, { name: 'Stage', type: 'select', config: { options: ['Now', 'Later'] } });
  weave.addField(tasks, { name: 'Notes', type: 'document' });
  const first = weave.createEntity(tasks, { name: 'First', values: { Stage: 'Now' } });
  weave.setDoc(first.id, '# Plan\n\nShip it.', 'Notes');
  const view = weave.createView({ name: 'Focus', blocks: [{ table: 'Task' }] });
  return { tableId: tasks.id, spaceId: space.id ?? weave.describeSchema().find((x) => x.space === 'Product').spaceId, entityId: first.id, viewId: view.id };
}, { server: () => ({ workspaces: { scratch } }) });

const ROWS = {
  table: ['Add description…', 'Move to space…', 'Duplicate', 'New share page…', 'Forms…', 'Copy create link', 'CSV', 'Move to trash'],
  record: ['Duplicate', 'Markdown', 'HTML', 'PDF', 'Move to trash'],
  doc: ['Markdown', 'Mermaid', 'HTML', 'PDF'],
  space: ['Move to trash'],
  'share-page': ['Move to trash'],
  workspace: ['Delete workspace…'],
  field: ['Field settings…', 'Insert field…', 'Move to trash'],
};

if (s) {
  const { base, browser, tableId, spaceId, entityId, viewId } = s;
  const open = async (hash, theme = 'light') => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    return page;
  };
  const MENU = '.chip-pop.wv-menu[role="menu"]';
  const read = (page) => page.locator(`${MENU} .wv-menu-row`).evaluateAll((rs) => rs.map((r) => (r.querySelector('.wv-menu-label, .hold-label')?.textContent ?? r.textContent).trim()));
  const shut = async (page) => {
    await page.keyboard.press('Escape');
    await page.waitForSelector(MENU, { state: 'detached' });
  };
  const via = (sel, how = 'click') => async (page) => {
    await page.waitForSelector(sel, { state: 'attached' });
    if (how === 'corner') {
      const target = page.locator(sel).first();
      const bounds = await target.boundingBox();
      await target.click({ button: 'right', position: { x: bounds.width - 2, y: bounds.height - 2 } });
    } else if (how === 'right') await page.locator(sel).first().click({ button: 'right', force: true });
    else await page.locator(sel).first().click({ force: true });
    await page.waitForSelector(MENU);
    const rows = await read(page);
    const head = await page.locator(`${MENU} .wv-menu-head`).count();
    await shut(page);
    return { rows, head };
  };

  const KINDS = [
    {
      kind: 'table', hash: `#/table/${tableId}`, ready: '#main .wv-grid',
      triggers: {
        'header ⋮': via('#main .crumb-row .dots-btn[title="Table actions"]'),
        'header right-click': via('#main .view-header', 'corner'),
        'nav row ⋮': via(`#nav .nav-db[data-db="${tableId}"] .nav-db-menu .dots-btn`),
        'nav row right-click': via(`#nav .nav-db[data-db="${tableId}"]`, 'right'),
      },
    },
    {
      kind: 'field', hash: `#/table/${tableId}`, ready: '#main .wv-grid',
      triggers: {
        'column ⋮': via('#main .wv-grid thead th.col-head[data-col="Stage"] .field-menu'),
        'column right-click': via('#main .wv-grid thead th.col-head[data-col="Stage"] .col-label', 'right'),
      },
    },
    {
      kind: 'record', hash: `#/entity/${entityId}`, ready: '#main textarea.name-edit',
      triggers: {
        'header ⋮': via('#main .view-header .crumb-row .dots-btn'),
        'header right-click': via('#main .view-header .activity-btn', 'right'),
      },
    },
    {
      kind: 'record', label: 'record in peek', hash: `#/table/${tableId}?e=${entityId}`, ready: '#dock:not([hidden]) textarea.name-edit',
      triggers: {
        'peek ⋮': via('#dock .view-header .crumb-row .dots-btn'),
        'peek right-click': via('#dock .view-header .activity-btn', 'right'),
      },
    },
    {
      kind: 'doc', hash: `#/entity/${entityId}`, ready: '#main .doc-section[data-doc-field="Notes"]',
      triggers: {
        'section ⋮': via('#main .doc-section[data-doc-field="Notes"] .doc-dl .dots-btn'),
        'section right-click': via('#main .doc-section[data-doc-field="Notes"] .doc-section-name', 'right'),
      },
    },
    {
      kind: 'space', hash: `#/space/${spaceId}`, ready: '#main .view-header .dots-btn',
      triggers: {
        'header ⋮': via('#main .view-header .crumb-row .dots-btn'),
        'header right-click': via('#main .view-header .view-desc', 'right'),
        'nav row ⋮': via(`#nav .nav-space-row:has(a.nav-space[href="#/space/${spaceId}"]) .nav-space-menu .dots-btn`),
        'nav row right-click': via(`#nav .nav-space-row a.nav-space[href="#/space/${spaceId}"]`, 'right'),
      },
    },
    {
      kind: 'share-page', hash: `#/view/${viewId}`, ready: '#main .share-page-head .dots-btn',
      triggers: {
        'header ⋮': via('#main .share-page-head .dots-btn'),
        'header right-click': via('#main .share-page-head h1', 'right'),
      },
    },
    {
      kind: 'workspace', hash: `w/${scratch.state.meta.id}/`, ready: '#main .view-header .dots-btn[title="Workspace actions"]',
      triggers: {
        'header ⋮': via('#main .view-header .dots-btn[title="Workspace actions"]'),
        'header right-click': via('#main .view-header .view-desc', 'right'),
        'tray click': via('#ws-list .ws-icon.active'),
        'tray right-click': via('#ws-list .ws-icon.active', 'right'),
      },
    },
  ];

  for (const theme of ['light', 'dark']) {
    for (const k of KINDS) {
      test(`${theme}: every trigger for a ${k.label ?? k.kind} opens the same rows (Feature #296, Issue #761)`, async () => {
        const page = await open(k.hash, theme);
        try {
          await page.waitForSelector(k.ready);
          assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
          const seen = {};
          for (const [name, run] of Object.entries(k.triggers)) seen[name] = await run(page);
          const names = Object.keys(seen);
          const want = ROWS[k.kind] ?? seen[names[0]].rows;
          for (const name of names) assert.deepEqual(seen[name].rows, want, `${name} opens the ${k.kind} menu`);
          if (k.kind === 'workspace') assert.deepEqual(want, ['Delete workspace…'], 'the workspace menu holds Delete alone (Feature #347)');
          for (const name of names.filter((n) => /right-click|nav row|tray/.test(n))) assert.equal(seen[name].head, 1, `${name} names the object in a head row`);
        } finally { await page.close(); }
      });
    }
  }

  const EXPORTS = [
    { kind: 'table', hash: `#/table/${tableId}`, trigger: '#main .crumb-row .dots-btn[title="Table actions"]', rows: [['CSV', '.csv']] },
    { kind: 'record', hash: `#/entity/${entityId}`, trigger: '#main .view-header .crumb-row .dots-btn', rows: [['Markdown', '.md'], ['HTML', '.html'], ['PDF', '.pdf']] },
    { kind: 'doc', hash: `#/entity/${entityId}`, trigger: '#main .doc-section[data-doc-field="Notes"] .doc-dl .dots-btn', rows: [['Markdown', '.md'], ['Mermaid', '.mmd'], ['HTML', '.html'], ['PDF', '.pdf']] },
  ];
  for (const x of EXPORTS) {
    test(`the ${x.kind} menu exports from one labelled section, format name with its extension in the hint (Feature #296, Issue #764)`, async () => {
      const page = await open(x.hash);
      try {
        await page.waitForSelector(x.trigger, { state: 'attached' });
        await page.locator(x.trigger).click({ force: true });
        await page.waitForSelector(MENU);
        const seen = await page.evaluate((m) => {
          const pop = document.querySelector(m);
          const labels = [...pop.querySelectorAll('.wv-menu-section')].map((n) => n.textContent.trim());
          const sec = pop.querySelector('.wv-menu-section');
          const rows = [];
          for (let n = sec?.nextElementSibling; n && n.classList.contains('wv-menu-row'); n = n.nextElementSibling) {
            rows.push([n.querySelector('.wv-menu-label').textContent.trim(), n.querySelector('.wv-menu-hint')?.textContent.trim() ?? null, n.getAttribute('href'), n.getAttribute('download')]);
          }
          return { labels, rows };
        }, MENU);
        assert.deepEqual(seen.labels, ['Export'], 'Export is the one labelled section');
        assert.deepEqual(seen.rows.map((r) => [r[0], r[1]]), x.rows);
        for (const r of seen.rows) {
          assert.ok(r[2].endsWith(r[1]), `${r[0]} links to its ${r[1]} (${r[2]})`);
          assert.ok(r[3].endsWith(r[1]), `${r[0]} downloads as ${r[1]} (${r[3]})`);
        }
      } finally { await page.close(); }
    });
  }

  test('the table toolbar has no Stats control and the table menu has no stats row (Feature #308)', async () => {
    const page = await open(`#/table/${tableId}`);
    try {
      await page.waitForSelector('#main .crumb-actions .eye-btn', { state: 'attached' });
      const order = await page.$$eval('#main .crumb-actions > *', (ns) => ns.map((n) => `${n.className} ${n.textContent} ${n.getAttribute('aria-label') ?? ''} ${n.title ?? ''}`));
      assert.equal(await page.locator('#main .table-stats-btn').count(), 0, 'no Stats button');
      assert.deepEqual(order.filter((t) => /stat/i.test(t)), [], `no toolbar control names stats: ${order.join(' | ')}`);
      const eye = order.findIndex((c) => /eye-btn/.test(c));
      assert.match(order[eye + 1], /table-filter-btn/, 'Filters sits right after Fields');
      const { rows } = await via('#main .crumb-row .dots-btn[title="Table actions"]')(page);
      assert.deepEqual(rows.filter((r) => /stat/i.test(r)), [], `no table menu row names stats: ${rows.join(' | ')}`);
      assert.equal(await page.locator('#modal.wv-stats').count(), 0);
    } finally { await page.close(); }
  });

  test('double-clicking a nav table row renames it in place (Feature #296)', async () => {
    const page = await open(`#/table/${tableId}`);
    try {
      await page.waitForSelector(`#nav .nav-db[data-db="${tableId}"]`);
      await page.dblclick(`#nav .nav-db[data-db="${tableId}"]`, { position: { x: 30, y: 8 } });
      const input = page.locator('#nav .nav-inline-add');
      await input.waitFor();
      assert.equal(await input.inputValue(), 'Task');
      await input.fill('Chore');
      await input.press('Enter');
      await page.waitForSelector(`#nav .nav-db[data-db="${tableId}"]:has-text("Chore")`);
      await page.dblclick(`#nav .nav-db[data-db="${tableId}"]`, { position: { x: 30, y: 8 } });
      await page.locator('#nav .nav-inline-add').fill('Task');
      await page.locator('#nav .nav-inline-add').press('Enter');
      await page.waitForSelector(`#nav .nav-db[data-db="${tableId}"]:has-text("Task")`);
    } finally { await page.close(); }
  });
}
