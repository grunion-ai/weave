import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tasks, row;
const s = await launch('table header one row', (weave) => {
  weave.createSpace({ name: 'Backlog', icon: 'lucide:list-checks' });
  tasks = weave.createTable({ space: 'Backlog', name: 'Tasks', icon: 'lucide:square-check' });
  row = weave.createEntity(tasks, { name: 'AMEX CC Migration' });
});

if (s) {
  const { base, browser } = s;
  const settle = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  const read = (page) => page.evaluate(() => {
    const rowEl = document.querySelector('#main .view-header .crumb-row');
    const barEl = document.querySelector('#main .view-header .head-bar');
    const path = rowEl.querySelector(':scope > .crumb-path');
    const acts = barEl.querySelector(':scope > .crumb-actions');
    const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width }; };
    const seen = (e) => !!e && e.getBoundingClientRect().width > 1 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).position !== 'fixed';
    const name = (e) => e.getAttribute('aria-label') ?? e.querySelector('button, input')?.getAttribute('aria-label') ?? e.getAttribute('title') ?? e.className;
    const inRow = seen(acts) ? [...acts.children].filter(seen) : [];
    const beside = [...barEl.children].filter((e) => e !== acts && seen(e) && e.matches('.dl-wrap, .new-record-btn'));
    const copy = path.querySelector('.crumb-copy');
    return {
      row: box(rowEl), bar: box(barEl),
      crumbLine: [...rowEl.children].filter(seen).map((e) => ({ ...box(e), name: e.className })),
      path: box(path),
      acts: seen(acts) ? box(acts) : null,
      controls: [...inRow, ...beside].map((e) => ({ ...box(e), name: name(e) })),
      slots: [...path.querySelectorAll(':scope > .crumb-slot')].filter(seen).map(box),
      copy: seen(copy) ? box(copy) : null,
      copyOff: getComputedStyle(copy).display === 'none',
      cur: seen(path.querySelector('.crumb-cur')) ? box(path.querySelector('.crumb-cur')) : null,
      folded: !!path.querySelector('.crumb-more'),
      tight: barEl.classList.contains('head-bar-tight'),
      search: Math.round(rowEl.querySelector('.table-search')?.getBoundingClientRect().width ?? 0),
      pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  const oneRow = (m, at) => {
    for (const c of m.crumbLine) {
      const mid = (c.t + c.b) / 2;
      assert.ok(mid > m.path.t && mid < m.path.b, `${at}: row 1 is one line, "${c.name}" sits on the breadcrumb line: ${JSON.stringify({ c, path: m.path })}`);
    }
    for (const c of m.controls) {
      const mid = (c.t + c.b) / 2;
      assert.ok(mid > m.bar.t && mid < m.bar.b && c.t >= m.row.b, `${at}: "${c.name}" sits on row 2, under the breadcrumbs: ${JSON.stringify({ control: c, bar: m.bar })}`);
      assert.ok(c.r <= m.bar.r + 0.5, `${at}: "${c.name}" stays inside row 2: ${JSON.stringify({ control: c, bar: m.bar })}`);
    }
    for (const sl of m.slots) assert.ok(sl.r <= m.path.r + 0.5 && sl.l >= m.path.l - 0.5, `${at}: no crumb is cut by the path edge: ${JSON.stringify({ sl, path: m.path })}`);
    assert.ok(m.cur && m.cur.r <= m.path.r + 0.5, `${at}: the current crumb stays in the row: ${JSON.stringify({ cur: m.cur, path: m.path })}`);
    if (!m.copyOff) assert.ok(m.copy && m.copy.r <= m.path.r + 0.5, `${at}: the copy-permalink button stays whole: ${JSON.stringify(m.copy)}`);
    assert.ok(m.pageScroll <= 0, `${at}: the page never scrolls sideways: ${m.pageScroll}px`);
  };

  test('the table header keeps breadcrumbs on row 1 and the toolbar on row 2 from 320 to 1920 px (Feature #384)', async () => {
    const page = await browser.newPage({ viewport: { width: 1920, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main .view-header .crumb-cur');
      for (let width = 1920; width >= 320; width -= 16) {
        await page.setViewportSize({ width, height: 900 });
        await settle(page);
        oneRow(await read(page), `${width}px`);
      }
    } finally { await page.close(); }
  });

  test('a table header beside a docked record keeps its two rows, and its condensed toolbar keeps View, Share and the menu and folds search to its icon (Feature #384)', async () => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${tasks.id}?e=${row.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#dock .view-header .crumb-cur');
      let tight = null;
      for (let width = 1500; width >= 1008; width -= 12) {
        await page.setViewportSize({ width, height: 900 });
        await settle(page);
        const m = await read(page);
        if (!m.path.w) break;
        oneRow(m, `split at ${width}px`);
        if (m.tight) tight = { ...m, width };
      }
      assert.ok(tight, 'the split view condenses the table toolbar before the record takes the whole pane');
      assert.ok(tight.controls.some((c) => /^New /.test(c.name)), `New stays in row 2: ${tight.controls.map((c) => c.name)}`);
      await page.setViewportSize({ width: tight.width, height: 900 });
      await settle(page);
      const names = tight.controls.map((c) => c.name);
      assert.ok(names.some((n) => /view/i.test(n)), `View stays in the row: ${names}`);
      assert.ok(names.some((n) => /^Share/.test(n)), `Share stays in the row: ${names}`);
      assert.equal(tight.search, 28, `the search bar folds to its icon: ${tight.search}px`);
      await page.click('#main .view-header .head-bar .dots-btn');
      const labels = await page.locator('.wv-menu-label').allTextContents();
      assert.ok(!labels.some((l) => /^Search/.test(l)), `the menu repeats no Search, the icon is in the row: ${labels}`);
      assert.ok(!labels.some((l) => /^Share \(/.test(l)), `the menu repeats no Share, the button is in the row: ${labels}`);
      await page.keyboard.press('Escape');
      await page.click('#main .view-header .head-bar .table-search-btn');
      await settle(page);
      const searching = await read(page);
      assert.ok(searching.search >= 80, `the icon opens the field: ${searching.search}px`);
      assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('table-search-input')), true, 'and focuses it');
      oneRow(searching, 'while searching');
    } finally { await page.close(); }
  });

  test('the condensed state holds still from frame to frame, with rows selected and a classic scrollbar (Feature #377, Feature #384)', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    try {
      await page.addStyleTag({ content: 'html { overflow-y: scroll; scrollbar-gutter: auto; } ::-webkit-scrollbar { width: 15px; }' }).catch(() => {});
      await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main .view-header .crumb-cur');
      await page.addStyleTag({ content: '::-webkit-scrollbar { width: 15px; height: 15px; }' });
      await page.click('#main .wv-grid tbody tr.entity-row td.sel-cell .sel-box');
      const frames = (n) => page.evaluate((count) => new Promise((done) => {
        const seen = [];
        const row = document.querySelector('#main .view-header .head-bar');
        const share = row.querySelector('.table-share-btn');
        const step = () => {
          seen.push(`${row.classList.contains('head-bar-tight') ? 'tight' : 'full'}:${share && share.getClientRects().length ? 'share' : 'none'}`);
          if (seen.length < count) requestAnimationFrame(step); else done(seen);
        };
        requestAnimationFrame(step);
      }), n);
      for (const width of [1440, 1280, 1200, 1120, 1040, 1000, 960]) {
        await page.setViewportSize({ width, height: 1000 });
        await settle(page);
        const seen = await frames(16);
        assert.equal(new Set(seen).size, 1, `${width}px: the header state changed between frames: ${seen.join(' ')}`);
      }
    } finally { await page.close(); }
  });

}
