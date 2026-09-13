/* The row window against a real page (Issue #271).

   The Case table drew all 2,087 rows on open: 58,706 DOM nodes and one
   17–52 s task for fifteen rows on screen. The pure arithmetic is pinned in
   test/grid-window.test.mjs; this suite proves the DOM half in
   public/app.js on a table of 1,200 rows: fewer than 200 <tr>s after open
   and no task over a second; the spacers keep the scrollbar honest; a fast
   scroll to the middle leaves no blank band under the viewport; the end of
   the table is reachable by scroll and by End; ⌘A takes the loaded rows and
   the foot says how many; a cell commit re-windows at the same scroll and
   hands focus back to the same cell.

   Playwright is NOT a dependency of weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const N = 1200;
let cases, suites, ids = [];
const s = await launch('the row window', (weave) => {
  weave.createSpace({ name: 'Quality' });
  suites = weave.createTable({ space: 'Quality', name: 'Suite' });
  cases = weave.createTable({ space: 'Quality', name: 'Case' });
  weave.addField(cases, { name: 'Status', type: 'select', config: { options: ['pass', 'fail'] } });
  // The Case grid's own shape: a relation chip in every row is what made a
  // row 28 nodes.
  weave.addRelation(cases, { name: 'Suite', targetDb: suites, cardinality: 'many-to-one', inverseName: 'Cases' });
  const st = weave.createEntity(suites, { name: 'engine' });
  for (let i = 0; i < N; i++) {
    ids.push(weave.createEntity(cases, { name: `case ${String(i).padStart(4, '0')}`, values: { Status: i % 2 ? 'pass' : 'fail', Suite: st.id } }).id);
  }
});

if (s) {
  const { base, browser } = s;

  // Long tasks are collected from before the app script runs, so the open
  // itself is measured.
  const open = async ({ viewport = { width: 1280, height: 800 } } = {}) => {
    const page = await browser.newPage({ viewport });
    await page.addInitScript(() => {
      window.__long = [];
      try { new PerformanceObserver((l) => window.__long.push(...l.getEntries().map((e) => e.duration))).observe({ type: 'longtask', buffered: true }); } catch { /* no longtask API */ }
    });
    await page.goto(`${base}/#/table/${cases.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    return page;
  };
  const drawn = (page) => page.evaluate(() => document.querySelectorAll('.wv-grid tbody tr.entity-row').length);
  const scrollBox = (page) => page.evaluate(() => {
    const wrap = document.querySelector('.table-wrap');
    return wrap.classList.contains('wv-grid-scroll') ? 'wrap' : 'page';
  });
  const scrollTo = (page, top) => page.evaluate((t) => {
    const wrap = document.querySelector('.table-wrap');
    const box = wrap.classList.contains('wv-grid-scroll') ? wrap : document.scrollingElement;
    // Instant: Tabler asks the page for smooth scrolling, and a jump that
    // animates is not the fast scroll under test.
    box.scrollTo({ top: t, behavior: 'instant' });
    // The scroll event lands on the next task; the window is painted on the
    // frame after that.
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, top);
  const scrollMax = (page) => page.evaluate(() => {
    const wrap = document.querySelector('.table-wrap');
    const box = wrap.classList.contains('wv-grid-scroll') ? wrap : document.scrollingElement;
    return box.scrollHeight - box.clientHeight;
  });
  const frames = (page, n = 2) => page.evaluate((k) => new Promise((r) => { const step = () => (k-- > 0 ? requestAnimationFrame(step) : r()); step(); }), n);

  test('the Case table opens with fewer than 200 rows drawn and no task over a second', async () => {
    const page = await open();
    try {
      const n = await drawn(page);
      assert.ok(n > 0 && n < 200, `${n} rows drawn for ${N}`);
      const long = await page.evaluate(() => window.__long);
      assert.ok(Math.max(0, ...long) < 1000, `longest task ${Math.max(0, ...long)} ms (${long.length} long tasks)`);
      // The spacers stand in for the rest: the body is as tall as every row.
      const g = await page.evaluate(() => {
        const tbody = document.querySelector('.wv-grid tbody');
        const row = tbody.querySelector('tr.entity-row');
        return { body: tbody.getBoundingClientRect().height, row: row.getBoundingClientRect().height };
      });
      assert.ok(Math.abs(g.body - g.row * N) < g.row * 3, `the body stands ${N} rows tall (${g.body}px at ${g.row}px a row)`);
      const note = await page.evaluate(() => document.querySelector('.wv-grid .wv-loaded')?.textContent);
      assert.match(note, /^200 of 1,200 loaded$/, 'the foot says how much of the table is here');
    } finally { await page.close(); }
  });

  test('a fast scroll to the middle leaves no blank band: every row under the viewport is drawn after one frame', async () => {
    const page = await open();
    try {
      const max = await scrollMax(page);
      await scrollTo(page, Math.round(max / 2));
      await frames(page, 2);
      const gap = await page.evaluate(() => {
        // Every row whose box crosses the viewport is a <tr> — drawn, or a
        // placeholder at the row height while its page lands — and never a
        // spacer's span.
        const wrap = document.querySelector('.table-wrap');
        const box = wrap.classList.contains('wv-grid-scroll') ? wrap.getBoundingClientRect() : { top: 0, bottom: innerHeight };
        const head = document.querySelector('.wv-grid thead').getBoundingClientRect().bottom;
        const rows = [...document.querySelectorAll('.wv-grid tbody tr')].filter((tr) => !tr.hidden);
        const inView = rows.filter((tr) => { const r = tr.getBoundingClientRect(); return r.bottom > Math.max(box.top, head) && r.top < box.bottom; });
        return inView.filter((tr) => tr.classList.contains('wv-spacer')).length;
      });
      assert.equal(gap, 0, 'no spacer under the viewport');
      // And the page lands: real rows replace the placeholders.
      await page.waitForFunction(() => !document.querySelector('.wv-grid tbody tr.entity-row-pending'), null, { timeout: 5000 });
      const ix = await page.evaluate(() => [...document.querySelectorAll('.wv-grid tbody tr.entity-row')].map((tr) => Number(tr.dataset.i)));
      assert.ok(ix.some((i) => i > 500 && i < 700), `the window sits in the middle of the table (${ix[0]}–${ix.at(-1)})`);
      assert.ok(ix.length < 200, `${ix.length} rows drawn`);
    } finally { await page.close(); }
  });

  test('scrolling to the end draws the last row; the foot counts what is loaded', async () => {
    const page = await open();
    try {
      await scrollTo(page, await scrollMax(page));
      await page.waitForSelector(`tr[data-eid="${ids[N - 1]}"]`, { timeout: 5000 });
      const n = await drawn(page);
      assert.ok(n < 200, `${n} rows drawn at the end`);
      const note = await page.evaluate(() => document.querySelector('.wv-grid .wv-loaded')?.textContent);
      assert.match(note, /^\d{3} of 1,200 loaded$/, `two pages in: ${note}`);
    } finally { await page.close(); }
  });

  test('End lands the cursor on the last row and Home on the first, scrolling each in first', async () => {
    const page = await open();
    try {
      await page.focus(`tr[data-eid="${ids[0]}"] td[data-field="Name"]`);
      await page.keyboard.press('End');
      await page.waitForFunction((last) => document.activeElement?.closest?.('tr')?.dataset.eid === last, ids[N - 1], { timeout: 5000 });
      const at = await page.evaluate(() => ({ field: document.activeElement.dataset.field, tag: document.activeElement.tagName, drawn: document.querySelectorAll('.wv-grid tbody tr.entity-row').length }));
      assert.equal(at.field, 'Name', 'the same column');
      assert.equal(at.tag, 'TD', 'resting on the cell');
      assert.ok(at.drawn < 200, `${at.drawn} rows drawn`);
      await page.keyboard.press('Home');
      await page.waitForFunction((first) => document.activeElement?.closest?.('tr')?.dataset.eid === first, ids[0], { timeout: 5000 });
      // A plain arrow past the window's edge walks on, one row at a time.
      await page.keyboard.press('ArrowDown');
      await page.waitForFunction((second) => document.activeElement?.closest?.('tr')?.dataset.eid === second, ids[1]);
    } finally { await page.close(); }
  });

  test('⌘A and the header box take the loaded rows, not the drawn window', async () => {
    const page = await open();
    try {
      await page.focus(`tr[data-eid="${ids[0]}"] td[data-field="Name"]`);
      await page.keyboard.press('Meta+a');
      const count = await page.evaluate(() => document.querySelector('.sel-puck .sel-count')?.textContent);
      assert.match(count, /^200 /, `every loaded row is chosen: ${count}`);
      const head = await page.evaluate(() => ({ checked: document.querySelector('thead .sel-box').checked, ind: document.querySelector('thead .sel-box').indeterminate }));
      assert.deepEqual(head, { checked: true, ind: false }, 'the header box reads all');
      // Rows drawn later paint the selection they belong to.
      await scrollTo(page, 30 * 150);
      await frames(page, 2);
      const painted = await page.evaluate(() => [...document.querySelectorAll('.wv-grid tbody tr.entity-row')].every((tr) => tr.classList.contains('row-selected')));
      assert.ok(painted, 'a row scrolled in wears the selection');
    } finally { await page.close(); }
  });

  test('a cell commit in the middle of the table re-windows at the same scroll and gives the cell back', async () => {
    const page = await open();
    try {
      const max = await scrollMax(page);
      await scrollTo(page, Math.round(max / 2));
      await page.waitForFunction(() => !document.querySelector('.wv-grid tbody tr.entity-row-pending') && document.querySelectorAll('.wv-grid tbody tr.entity-row').length > 0, null, { timeout: 5000 });
      const eid = await page.evaluate(() => {
        // A drawn row that is on screen.
        const wrap = document.querySelector('.table-wrap');
        const box = wrap.classList.contains('wv-grid-scroll') ? wrap.getBoundingClientRect() : { top: 0, bottom: innerHeight };
        const head = document.querySelector('.wv-grid thead').getBoundingClientRect().bottom;
        return [...document.querySelectorAll('.wv-grid tbody tr.entity-row')].find((tr) => { const r = tr.getBoundingClientRect(); return r.top > Math.max(box.top, head) + 5 && r.bottom < box.bottom - 5; }).dataset.eid;
      });
      const before = await page.evaluate(() => {
        const wrap = document.querySelector('.table-wrap');
        const box = wrap.classList.contains('wv-grid-scroll') ? wrap : document.scrollingElement;
        return box.scrollTop;
      });
      assert.ok(before > 1000, `scrolled well down (${before})`);
      await page.click(`tr[data-eid="${eid}"] td[data-field="Name"] input`);
      await page.keyboard.type(' edited');
      await page.keyboard.press('Tab');
      // The commit PATCHes, re-reads the pages under the window and redraws;
      // focus comes back to the cell Tab reached — the next stop along the
      // row, the description — at the same scroll.
      await page.waitForFunction((e) => {
        const td = document.activeElement?.closest?.('tr[data-eid] > td');
        return td?.parentElement.dataset.eid === e && td.dataset.field === 'Description';
      }, eid, { timeout: 5000 });
      const after = await page.evaluate(() => {
        const wrap = document.querySelector('.table-wrap');
        const box = wrap.classList.contains('wv-grid-scroll') ? wrap : document.scrollingElement;
        return { top: box.scrollTop, rowH: document.querySelector('.wv-grid tbody tr.entity-row').getBoundingClientRect().height, drawn: document.querySelectorAll('.wv-grid tbody tr.entity-row').length, name: document.querySelector(`tr[data-eid="${document.activeElement.closest('tr').dataset.eid}"] td[data-field="Name"] input`)?.value };
      });
      // Held to within a row: the redraw's spacers are sized on a remembered
      // row height that can differ from the laid-out one by a fraction of a
      // pixel per row. A jump to the top is thousands of pixels.
      assert.ok(Math.abs(after.top - before) <= after.rowH, `the scroll held (${before} → ${after.top})`);
      assert.ok(after.drawn < 200, `${after.drawn} rows drawn after the commit`);
      assert.match(after.name, / edited$/, 'the row shows the value it was given');
    } finally { await page.close(); }
  });

  test('the Σ row and + New keep their place under a windowed body; a new row is scrolled to and takes the caret', async () => {
    const page = await open();
    try {
      await page.click('.wv-grid .add-entity-btn');
      await page.waitForFunction(() => {
        const a = document.activeElement;
        return a?.tagName === 'INPUT' && a.closest('td')?.dataset.field === 'Name' && a.value === '';
      }, null, { timeout: 5000 });
      const at = await page.evaluate(() => {
        const tr = document.activeElement.closest('tr');
        const r = tr.getBoundingClientRect();
        return { i: Number(tr.dataset.i), onScreen: r.top >= 0 && r.bottom <= innerHeight, drawn: document.querySelectorAll('.wv-grid tbody tr.entity-row').length };
      });
      assert.equal(at.i, N, 'the new row is the last row of the table');
      assert.ok(at.onScreen, 'and it is on screen');
      assert.ok(at.drawn < 200, `${at.drawn} rows drawn`);
    } finally { await page.close(); }
  });

  test('a short table is drawn whole and says nothing in its foot', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/#/table/${suites.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      const g = await page.evaluate(() => ({
        rows: document.querySelectorAll('.wv-grid tbody tr.entity-row').length,
        spacers: [...document.querySelectorAll('.wv-grid tbody tr.wv-spacer')].filter((tr) => !tr.hidden).length,
        note: document.querySelector('.wv-grid .wv-loaded')?.textContent ?? '',
      }));
      assert.deepEqual(g, { rows: 1, spacers: 0, note: '' });
    } finally { await page.close(); }
  });

  test('the scroller is measured, not assumed: the same window arithmetic serves the page and the wrap', async () => {
    // A narrow viewport makes the grid wider than its card, so the wrap is
    // the scroller (Issue #233); the wide one leaves the page to scroll.
    const narrow = await open({ viewport: { width: 700, height: 700 } });
    const wide = await open({ viewport: { width: 1600, height: 900 } });
    try {
      assert.equal(await scrollBox(narrow), 'wrap');
      for (const page of [narrow, wide]) {
        await scrollTo(page, await scrollMax(page));
        await page.waitForSelector(`tr[data-eid="${ids[N - 1]}"]`, { timeout: 5000 });
        assert.ok((await drawn(page)) < 200);
      }
    } finally { await narrow.close(); await wide.close(); }
  });
}
