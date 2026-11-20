import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const NAME = 'AMEX CC Migration and the vendor cutover plan for the second quarter';
let tasks, row;
const s = await launch('two-row header', (weave) => {
  weave.createSpace({ name: 'Backlog', icon: 'lucide:list-checks' });
  tasks = weave.createTable({ space: 'Backlog', name: 'Tasks', icon: 'lucide:square-check', description: 'Work the team has taken on.' });
  weave.addField(tasks, { name: 'Stage', type: 'select', config: { options: ['Open', 'Done'] } });
  row = weave.createEntity(tasks, { name: NAME, values: { Stage: 'Open' } });
  weave.createEntity(tasks, { name: 'Close the books', values: { Stage: 'Done' } });
});

if (s) {
  const { base, browser } = s;
  const settle = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  const read = (page, scope) => page.evaluate(([scope]) => {
    const header = document.querySelector(`${scope} .view-header`);
    const row1 = header.querySelector(':scope > .crumb-row');
    const row2 = header.querySelector(':scope > .head-bar');
    const path = row1.querySelector(':scope > .crumb-path');
    const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
    const seen = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).position !== 'fixed' && e.getBoundingClientRect().width > 1;
    const name = (e) => e.getAttribute('aria-label') ?? e.getAttribute('title') ?? e.className;
    const controls = [...header.querySelectorAll('button, input, .table-search')]
      .filter((e) => seen(e) && !e.closest('.view-desc') && !(e.matches('button, input') && e.parentElement.closest('.table-search, .view-title-h')))
      .map((e) => ({ ...box(e), name: name(e), row: row1.contains(e) ? 1 : row2.contains(e) ? 2 : 0 }));
    const kids = [...row1.children].filter(seen).map((e) => ({ ...box(e), name: e.className }));
    return {
      row1: box(row1), row2: box(row2), path: box(path), kids, controls,
      tools: [row2.querySelector(':scope > .crumb-actions'), row2.querySelector(':scope > .table-tools-btn')].filter(seen).map(box)[0] ?? null,
      slots: [...path.querySelectorAll(':scope > .crumb-slot')].filter(seen).map(box),
      pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, [scope]);
  const overlap = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
  const twoRows = (m, at) => {
    const line = m.kids.map((k) => (k.t + k.b) / 2);
    for (const [i, k] of m.kids.entries()) {
      assert.ok(line[i] > m.path.t && line[i] < m.path.b, `${at}: row 1 is one line, "${k.name}" sits on the breadcrumb line: ${JSON.stringify({ k, path: m.path })}`);
    }
    for (const sl of m.slots) assert.ok(sl.r <= m.path.r + 0.5 && sl.l >= m.path.l - 0.5, `${at}: no crumb is cut by the path edge: ${JSON.stringify({ sl, path: m.path })}`);
    assert.ok(m.row2.t >= m.row1.b - 0.5, `${at}: row 2 sits under row 1: ${JSON.stringify({ row1: m.row1, row2: m.row2 })}`);
    assert.ok(m.tools && m.tools.t >= m.row1.b - 0.5, `${at}: the toolbar lives in row 2: ${JSON.stringify(m.tools)}`);
    for (const c of m.controls) assert.ok(c.row, `${at}: "${c.name}" sits in one of the two rows`);
    for (const [i, a] of m.controls.entries()) {
      for (const b of m.controls.slice(i + 1)) {
        if (a.w > 1 && b.w > 1) assert.ok(overlap(a, b) < 1, `${at}: "${a.name}" and "${b.name}" overlap: ${JSON.stringify({ a, b })}`);
      }
    }
    assert.ok(m.pageScroll <= 0, `${at}: the page never scrolls sideways: ${m.pageScroll}px`);
  };
  const sweep = async (page, scope, from = 1920, to = 320) => {
    for (let width = from; width >= to; width -= 16) {
      await page.setViewportSize({ width, height: 900 });
      await settle(page);
      twoRows(await read(page, scope), `${scope} at ${width}px`);
    }
  };

  test('the full-page record header keeps row 1 to one line and the toolbar in row 2 from 320 to 1920 px (Feature #384)', async () => {
    const page = await browser.newPage({ viewport: { width: 1920, height: 900 } });
    try {
      await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main .view-header .record-kind');
      await sweep(page, '#main');
    } finally { await page.close(); }
  });

  test('the table header keeps row 1 to one line and the toolbar in row 2 from 320 to 1920 px (Feature #384)', async () => {
    const page = await browser.newPage({ viewport: { width: 1920, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main .view-header .crumb-cur');
      await sweep(page, '#main');
    } finally { await page.close(); }
  });

  test('a docked record and the table beside it keep two clean rows (Feature #384)', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 800 } });
    try {
      await page.addInitScript(() => localStorage.setItem('wv-dock-width', '400'));
      await page.goto(`${base}/#/table/${tasks.id}?e=${row.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#dock .view-header .record-kind');
      for (const width of [1440, 1200, 1100, 1000, 960, 901]) {
        await page.setViewportSize({ width, height: 800 });
        await settle(page);
        twoRows(await read(page, '#dock'), `dock at ${width}px`);
        if (await page.locator('#main .view-header .crumb-cur').isVisible()) twoRows(await read(page, '#main'), `table beside the dock at ${width}px`);
      }
    } finally { await page.close(); }
  });

  test('row 1 holds the crumbs and the pane controls, row 2 the record tools (Feature #384)', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${tasks.id}?e=${row.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#dock .view-header .record-kind');
      await settle(page);
      const names = (scope, sel) => page.locator(`${scope} .view-header ${sel} >> visible=true`).evaluateAll((list) => list.map((n) => n.getAttribute('aria-label') ?? n.getAttribute('title')));
      assert.deepEqual(await names('#dock', '.crumb-row button:not(.crumb-copy, .nav-menu)'), ['Expand to the full page', 'Close'], 'the pane keeps Expand and Close on row 1');
      assert.deepEqual(await names('#dock', '.head-bar .crumb-actions button'), ['Show or hide fields', 'Share (Beta)', 'Record actions'], 'and its tools on row 2');
      await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main .view-header .record-kind');
      await settle(page);
      assert.deepEqual(await names('#main', '.crumb-row button:not(.crumb-copy, .nav-menu, .crumb-more)'), ['Close — back to the table'], 'the record page keeps Close on row 1');
      assert.deepEqual(await names('#main', '.head-bar .crumb-actions button'), ['Show or hide fields', 'Share (Beta)', 'Record actions'], 'and its tools on row 2');
      await page.click('#main .view-header .head-bar .dots-btn');
      const labels = await page.locator('.wv-menu-label').allTextContents();
      assert.ok(labels.includes('Dock beside table'), `the menu docks the record: ${labels}`);
    } finally { await page.close(); }
  });

  const named = (page, scope) => page.evaluate((scope) => {
    const h = document.querySelector(`${scope} .view-header`);
    const slots = [...h.querySelectorAll('.crumb-path > .crumb-slot:not([hidden])')].filter((n) => n.getClientRects().length);
    const last = slots.at(-1);
    return {
      crumbs: slots.map((n) => n.querySelector('.crumb-item')?.innerText.trim()).filter(Boolean),
      lastKind: [...(last?.querySelector('.crumb-item')?.classList ?? [])].find((k) => k.startsWith('crumb-k-')),
      copyAfterLast: !!last?.querySelector('.crumb-item ~ .crumb-copy'),
      bar: h.querySelector('.head-bar .record-kind').innerText.trim(),
      text: h.innerText,
    };
  }, scope);
  const once = (text, pid) => text.match(new RegExp(`#${pid}(?!\\d)`, 'g'))?.length ?? 0;

  test('a record names itself once: row 1 ends at the table with Copy permalink, row 2 carries the #id (Issues #1862, #1878)', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main .view-header .record-kind');
      await settle(page);
      const m = await named(page, '#main');
      assert.equal(m.crumbs.at(-1), 'Tasks', `the trail ends at the table: ${m.crumbs}`);
      assert.equal(m.lastKind, 'crumb-k-table', 'the last crumb is the table');
      assert.ok(m.copyAfterLast, 'Copy permalink follows the table crumb');
      assert.equal(m.bar, `#${row.publicId}`, 'row 2 leads with the table icon and the #id');
      assert.equal(once(m.text, row.publicId), 1, `the header names the #id once: ${JSON.stringify(m.text)}`);
      assert.equal(m.text.split(NAME).length - 1, 0, 'the header text never repeats the name');
      assert.equal(await page.locator('#main .view-header .name-edit').inputValue(), NAME, 'the title carries it once');
    } finally { await page.close(); }
  });

  test('a docked record shows the table crumb in row 1 and its #id once, at every pane width (Issue #1878)', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.addInitScript(() => localStorage.setItem('wv-dock-width', '400'));
      await page.goto(`${base}/#/table/${tasks.id}?e=${row.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#dock .view-header .record-kind');
      for (const width of [1440, 1000, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await settle(page);
        const m = await named(page, '#dock');
        assert.equal(m.crumbs.at(-1), 'Tasks', `the pane's last crumb is the table at ${width}px: ${m.crumbs}`);
        assert.equal(m.lastKind, 'crumb-k-table', `the last crumb is the table at ${width}px`);
        assert.ok(m.copyAfterLast, `Copy permalink follows the table crumb at ${width}px`);
        assert.equal(once(m.text, row.publicId), 1, `the pane header names the #id once at ${width}px: ${JSON.stringify(m.text)}`);
      }
    } finally { await page.close(); }
  });

  test('header text is smaller: a 16 px table title at weight 600, a 20 px record title, 13 px crumbs (Feature #384)', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      const font = (sel) => page.locator(sel).first().evaluate((n) => [getComputedStyle(n).fontSize, getComputedStyle(n).fontWeight]);
      await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main .view-header .view-title');
      assert.deepEqual(await font('#main .view-header .view-title'), ['16px', '600']);
      assert.equal((await font('#main .view-header .crumb-path'))[0], '13px');
      await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main .view-header .name-edit');
      assert.equal((await font('#main .view-header .name-edit'))[0], '20px');
      assert.equal((await font('#main .view-header .crumb-path'))[0], '13px');
    } finally { await page.close(); }
  });

  test('the table title, its description toggle and the toolbar share one centred line, with no dead band above the grid (Issue #1867)', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main .wv-grid thead');
      await settle(page);
      const m = await page.evaluate(() => {
        const mid = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return (r.top + r.bottom) / 2; };
        return {
          title: mid('#main .head-bar .view-title'), toggle: mid('#main .head-bar .desc-info'),
          view: mid('#main .head-bar .table-view-btn'), add: mid('#main .head-bar .new-record-btn'),
          bar: document.querySelector('#main .head-bar').getBoundingClientRect().bottom,
          thead: document.querySelector('#main .wv-grid thead').getBoundingClientRect().top,
        };
      });
      for (const k of ['toggle', 'view', 'add']) assert.ok(Math.abs(m[k] - m.title) <= 1, `the ${k} centres on the title: ${JSON.stringify(m)}`);
      assert.ok(m.thead - m.bar <= 20, `the grid header follows row 2 without a dead band: ${m.thead - m.bar}px`);
    } finally { await page.close(); }
  });

  test('the View button in row 2 counts the active filters (Issue #1863)', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      s.weave.tableView(`${tasks.id}/Standard`, { filters: { Stage: ['Open'] } });
      await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
      const view = page.locator('#main .view-header .head-bar .table-view-btn');
      await view.waitFor();
      assert.equal((await view.locator('.view-count').textContent()).trim(), '1');
      assert.match(await view.getAttribute('aria-label'), /1 filter on/);
    } finally {
      s.weave.tableView(`${tasks.id}/Standard`, { filters: {} });
      await page.close();
    }
  });
}
