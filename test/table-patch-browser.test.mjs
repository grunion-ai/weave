/* Issue #444: a toolbar change patches the grid, never the page. Every table
   control (search, filter, view, Reset view, density, field show/hide, field
   order, Add field) used to end in drawDatabase's main.replaceChildren():
   breadcrumb, title, description, toolbar, header and rows all rebuilt, so
   the description went blank until /markdown answered, a view switch
   painted the route skeleton, and the search box was a new node every
   keystroke. The chrome is now drawn once per route and the grid body is
   swapped under it.

   The probe watches the page the way the reader does: every animation frame
   records whether #main holds the header, a grid with rows (or the search's
   empty note), no skeleton, a filled-in description, and where the grid
   starts; a MutationObserver counts element nodes removed from the page
   header; the toolbar's controls are held by reference so a replaced node
   shows up as disconnected. Each case prints its numbers as `#444 probe` so
   the before and after can be read off a run.

   Issue #433: a change that has to refetch dims the grid body (aria-busy)
   at once, never the toolbar, and puts the rope over the grid only once the
   wait passes the loader's 500 ms threshold. A second chip click during the
   wait is kept, never lost. Playwright is NOT a dependency of weave. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let table;
const s = await launch('table patch', (weave) => {
  weave.createSpace({ name: 'Ops' });
  table = weave.createTable({ space: 'Ops', name: 'Job', description: 'Jobs the ops team runs.\n\n**Owner** is whoever is on call for it.' });
  weave.addField(table, { name: 'Owner', type: 'text' });
  weave.addField(table, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'Doing', category: 'in-progress' },
    { name: 'Done', category: 'done' }] } });
  const states = ['Open', 'Doing', 'Done'];
  for (let i = 1; i <= 60; i++) weave.createEntity(table, { name: `Row ${i}`, values: { Owner: `owner ${i % 7}`, Status: states[i % 3] } });
  weave.tableView(`${table.id}/Narrow`, { fields: ['Name', 'Status'] });
});

/* Installed once per page. start() tags the chrome and begins sampling;
   stop() returns the counts for the stretch in between. */
function installProbe() {
  const P = { on: false, frames: [], headerRemoved: 0, navRemoved: 0, controls: [] };
  const main = document.querySelector('#main');
  const inHeader = (n) => n.nodeType === 1 && (n.matches('.view-header') || n.closest?.('.view-header'));
  new MutationObserver((recs) => {
    if (!P.on) return;
    for (const r of recs) {
      for (const n of r.removedNodes) {
        if (n.nodeType !== 1) continue;
        const size = 1 + n.querySelectorAll('*').length;
        if (n.matches('.view-header') || n.querySelector('.view-header') || (r.target.nodeType === 1 && r.target.closest('.view-header'))) P.headerRemoved += size;
        else if (inHeader(r.target)) P.headerRemoved += size;
      }
    }
  }).observe(main, { childList: true, subtree: true });
  new MutationObserver((recs) => {
    if (!P.on) return;
    for (const r of recs) for (const n of r.removedNodes) if (n.nodeType === 1) P.navRemoved += 1 + n.querySelectorAll('*').length;
  }).observe(document.querySelector('#nav'), { childList: true, subtree: true });
  const sample = () => {
    if (!P.on) return;
    const header = main.querySelector(':scope > .view-header');
    const wrap = main.querySelector('.table-wrap');
    const desc = main.querySelector('.view-desc');
    P.frames.push({
      header: !!header,
      wrap: !!wrap,
      rows: main.querySelectorAll('.wv-grid tbody tr.entity-row').length,
      note: !!main.querySelector('.table-search-empty'),
      skeleton: !!main.querySelector('.sk'),
      descEmpty: !desc || !desc.querySelector('.view-desc-body'),
      gridTop: wrap ? Math.round(wrap.getBoundingClientRect().top + scrollY) : null,
    });
    requestAnimationFrame(sample);
  };
  window.__probe = {
    start() {
      P.frames = []; P.headerRemoved = 0; P.navRemoved = 0;
      P.controls = ['.table-search-input', '.table-view-btn', '.table-density-btn', '.eye-btn', '.table-filter-btn', '.view-title', '.view-desc-body', '.crumb-path']
        .map((sel) => [sel, main.querySelector(sel)]);
      P.on = true;
      requestAnimationFrame(sample);
    },
    stop() {
      P.on = false;
      const bad = P.frames.filter((f) => !f.header || !f.wrap || f.skeleton || f.descEmpty || (!f.rows && !f.note));
      const tops = new Set(P.frames.map((f) => f.gridTop));
      return {
        frames: P.frames.length,
        badFrames: bad.length,
        headerNodesRemoved: P.headerRemoved,
        navNodesRemoved: P.navRemoved,
        controlsReplaced: P.controls.filter(([, n]) => !n?.isConnected).map(([sel]) => sel),
        gridTopMoves: tops.size - 1,
      };
    },
  };
}

if (s) {
  const { base, browser, weave } = s;
  const rows = (page) => page.locator('.wv-grid tbody tr.entity-row').count();
  const settle = async (page) => {
    await page.waitForLoadState('networkidle');
    // The description renders off /markdown; give a stray re-render its frames.
    await page.waitForTimeout(300);
  };
  async function open(view = '') {
    weave.tableView(`${table.id}/Default`, { fields: ['Name', 'Description', 'Owner', 'Status'], filters: {}, sort: [], density: 'comfortable' });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${base}/#/table/${table.id}${view}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.waitForSelector('.view-desc .view-desc-body');
    /* A description renders off /markdown. Held a little here, as a busy
       server holds it: a page that re-renders its header paints it blank. */
    await page.route('**/markdown', async (route) => { await new Promise((r) => setTimeout(r, 120)); await route.continue(); });
    await page.evaluate(installProbe);
    return page;
  }
  async function measure(page, name, act) {
    await page.evaluate(() => window.__probe.start());
    await act();
    await settle(page);
    const m = await page.evaluate(() => window.__probe.stop());
    console.log(`#444 probe ${name} ${JSON.stringify(m)}`);
    return m;
  }
  const clean = (m, name) => {
    assert.equal(m.badFrames, 0, `${name}: no frame paints an empty, skeleton or half-built #main`);
    assert.equal(m.headerNodesRemoved, 0, `${name}: no node of the page header is removed`);
    assert.deepEqual(m.controlsReplaced, [], `${name}: the toolbar and title keep their nodes`);
    assert.equal(m.gridTopMoves, 0, `${name}: the grid never jumps`);
  };

  test('search narrows the rows under a toolbar that never repaints, and the box keeps its focus and caret', async () => {
    const page = await open();
    try {
      await page.click('.table-search-input');
      const input = await page.$('.table-search-input');
      const m = await measure(page, 'search', async () => {
        await page.keyboard.type('Row 1', { delay: 40 });
        await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody tr.entity-row').length === 11);
      });
      clean(m, 'search');
      assert.equal(await input.evaluate((n) => n === document.activeElement && n.isConnected), true, 'the same input still has the focus');
      assert.deepEqual(await input.evaluate((n) => [n.selectionStart, n.selectionEnd, n.value]), [5, 5, 'Row 1'], 'the caret stays where it was typed');
    } finally { await page.close(); }
  });

  test('a filter chip swaps the rows; the popover and toolbar stay put', async () => {
    const page = await open();
    try {
      await page.click('.table-filter-btn');
      await page.locator('.table-filter-popover').evaluate((pop) => { pop.dataset.probe = 'same'; });
      const m = await measure(page, 'filter', async () => {
        await page.locator('.table-filter-popover .filter-chip:text-is("Done")').click();
        await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody tr.entity-row').length === 20);
      });
      clean(m, 'filter');
      assert.equal(await page.locator('.table-filter-popover').getAttribute('data-probe'), 'same', 'the open popover is the same node');
      assert.equal(await page.textContent('.table-filter-btn .table-filter-count'), '1');
    } finally { await page.close(); }
  });

  test('switching views swaps the grid without painting the route skeleton', async () => {
    const page = await open();
    try {
      await page.click('.table-view-btn');
      const m = await measure(page, 'view switch', async () => {
        await page.locator('.table-view-popover .view-tab[aria-label="Narrow"]').click();
        await page.waitForFunction(() => [...document.querySelectorAll('.wv-grid .col-label')].map((h) => h.textContent.trim()).join(',') === 'Name,Status');
      });
      clean(m, 'view switch');
      assert.equal(await page.getAttribute('.table-view-btn', 'aria-label'), 'View: Narrow', 'the view button names the view on screen');
      assert.equal(await page.locator('.table-view-popover .view-tab.active').getAttribute('aria-label'), 'Narrow');
    } finally { await page.close(); }
  });

  test('Reset view redraws the grid, not the page', async () => {
    const page = await open();
    try {
      weave.tableView(`${table.id}/Default`, { fields: ['Name'], sort: [{ field: 'Name', dir: 'desc' }] });
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.view-desc .view-desc-body');
      await page.evaluate(installProbe);
      await page.click('.table-view-btn');
      const m = await measure(page, 'reset view', async () => {
        await page.click('.view-reset');
        await page.waitForFunction(() => [...document.querySelectorAll('.wv-grid .col-label')].some((h) => h.textContent.trim() === 'Owner'));
      });
      clean(m, 'reset view');
    } finally { await page.close(); }
  });

  test('density changes the row height token and nothing else', async () => {
    const page = await open();
    try {
      const m = await measure(page, 'density', async () => {
        await page.click('.table-density-btn');
        await page.click('.table-density-popover .seg-opt:has-text("Compact")');
        await page.waitForFunction(() => document.querySelector('.table-density-btn')?.getAttribute('aria-label') === 'Row density: Compact');
      });
      clean(m, 'density');
    } finally { await page.close(); }
  });

  test('hiding and reordering a field patch the columns under a still toolbar and popover', async () => {
    const page = await open();
    try {
      await page.click('.eye-btn');
      await page.locator('.table-fields-popover').evaluate((pop) => { pop.dataset.probe = 'same'; });
      const hide = await measure(page, 'field hide', async () => {
        await page.locator('.table-field-row[data-field="Owner"] .eye-row').click();
        await page.waitForFunction(() => ![...document.querySelectorAll('.wv-grid .col-label')].some((h) => h.textContent.trim() === 'Owner'));
      });
      clean(hide, 'field hide');
      const order = await measure(page, 'field reorder', async () => {
        await page.locator('.table-field-row[data-field="Status"] .field-reorder-handle').focus();
        // Hidden Owner sits between Description and Status in the picker.
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('ArrowUp');
        await page.waitForFunction(() => [...document.querySelectorAll('.wv-grid .col-label')].map((h) => h.textContent.trim()).join(',') === 'Name,Status,Description');
      });
      clean(order, 'field reorder');
      assert.equal(await page.locator('.table-fields-popover').getAttribute('data-probe'), 'same', 'the open popover is the same node');
    } finally { await page.close(); }
  });

  test('adding a field adds its column under the same chrome', async () => {
    const page = await open();
    try {
      await page.click('.add-field-btn');
      await page.waitForSelector('#tray .tray-form');
      await page.fill('.tray-form input[name="name"]', 'Probe field');
      const m = await measure(page, 'add field', async () => {
        await page.locator('.tray-form button[type="submit"]').click();
        await page.waitForFunction(() => [...document.querySelectorAll('.wv-grid .col-label')].some((h) => h.textContent.trim() === 'Probe field'));
      });
      clean(m, 'add field');
    } finally { await page.close(); }
  });

  /* Issue #433. The query is held so the wait is long enough to see. */
  test('a slow refetch dims the grid at once, shows the rope over it past 500 ms, and keeps a second click', async () => {
    const page = await open();
    try {
      let hold = 0;
      await page.route(`**/tables/${table.id}/query`, async (route) => {
        if (hold) await new Promise((r) => setTimeout(r, hold));
        await route.continue();
      });
      hold = 1200;
      await page.click('.table-filter-btn');
      await page.locator('.table-filter-popover .filter-chip:text-is("Done")').click();
      // The debounce (250 ms) then the held query: busy from the click, not from the fetch.
      await page.waitForTimeout(120);
      const early = await page.evaluate(() => ({
        busy: document.querySelector('#main .table-wrap')?.closest('[aria-busy="true"]') ? true : false,
        toolbarBusy: !!document.querySelector('#main .view-header[aria-busy="true"], #main .view-header [aria-busy="true"]'),
        rope: !!document.querySelector('#main .grid-loader:not([hidden])'),
        pageRope: !document.querySelector('#page-loader')?.hidden,
      }));
      assert.deepEqual(early, { busy: true, toolbarBusy: false, rope: false, pageRope: false }, 'the grid dims at once, the toolbar does not, and no rope yet');
      // The dim is a short opacity transition; a loaded gate may not have painted its first frame yet.
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#main .table-wrap')).opacity !== '1', null, { timeout: 400 }).catch(() => {});
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#main .table-wrap')).opacity !== '1'), true, 'the stale rows are dimmed');
      await page.waitForTimeout(500);
      assert.equal(await page.locator('#main .grid-loader:not([hidden])').count(), 1, 'past 500 ms the rope covers the grid');
      // A second chip while the first is still loading.
      await page.locator('.table-filter-popover .filter-chip:text-is("Doing")').click();
      assert.equal(await page.locator('#main .grid-loader svg').count() > 0, true, 'the rope is the weave loader');
      assert.equal(await page.evaluate(() => document.querySelector('#page-loader').hidden), true, 'the page-wide rope stays down');
      hold = 0;
      // 40 rows match; the window draws the ones in view, more than Done's 20.
      await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody tr.entity-row').length > 20 && !document.querySelector('#main [aria-busy="true"]'), null, { timeout: 15000 });
      await page.waitForLoadState('networkidle');
      const drawn = await page.$$eval('.wv-grid tbody tr.entity-row', (rs) => rs.map((r) => r.dataset.eid));
      const status = new Map(weave.query(table.id).items.map((e) => [e.id, e.fields.Status]));
      assert.deepEqual([...new Set(drawn.map((id) => status.get(id)))].sort(), ['Doing', 'Done'], 'the grid shows the answer to both chips');
      assert.deepEqual(weave.tableView(table).views.find((v) => v.name === 'Default').filters, { Status: ['Done', 'Doing'] }, 'the second click was kept');
      assert.deepEqual((await page.$$eval('.table-filter-popover .filter-chip.on', (bs) => bs.map((b) => b.textContent.trim()))).sort(), ['Doing', 'Done']);
      await page.waitForFunction(() => document.querySelector('#main .grid-loader')?.hidden !== false, null, { timeout: 5000 });
    } finally { await page.close(); }
  });

  test('a fast refetch dims for its moment and never shows the rope', async () => {
    const page = await open();
    try {
      await page.evaluate(() => {
        window.__rope = 0;
        new MutationObserver(() => { if (document.querySelector('#main .grid-loader:not([hidden])')) window.__rope++; })
          .observe(document.querySelector('#main'), { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
      });
      await page.fill('.table-search-input', 'Row 2');
      await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody tr.entity-row').length === 11);
      await settle(page);
      assert.equal(await page.evaluate(() => window.__rope), 0, 'no rope for a fast answer');
      assert.equal(await page.locator('#main [aria-busy="true"]').count(), 0, 'nothing left busy');
      assert.equal(await rows(page), 11);
    } finally { await page.close(); }
  });
}
