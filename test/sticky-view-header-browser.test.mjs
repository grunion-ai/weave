/* The table page's header stays on screen in both scroll modes (Issue #321).

   Kyle, 2026-09-18: "some times table title and description stays visible
   onsite Coll sometimes not, should always stay visible with breadcrumbs and
   upper right toolbar". Which one he got depended on the grid's width. A
   grid wider than its card scrolls inside its own wrap (Issue #233), so
   everything above the wrap holds still; a grid that fits scrolls the page,
   and the header block went with it: crumbs, title, description and the
   toolbar all scrolled off the top, and the column header stuck to the
   viewport's edge instead.

   Pinned here, in page-scroll mode: far down a 600-row grid the header
   block rests at one position and every part of it is on screen and on top;
   the column header (and the Σ row under it) stick directly beneath the
   block; the rows pass under both; the frozen # column rides under the same
   line; a row brought into view from above lands right under the column
   header; and an opened long description is capped so the pinned block
   never takes the viewport. A window under twice the block's height is
   too short to pin it at all: there the block scrolls with the page and a
   row stays reachable. In wrap-scroll mode nothing changes: the page
   stays still, the header sits where it was drawn, and the column header
   sticks to the wrap's own top. Every case runs in light and dark. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tall, long, wide;
const s = await launch('the table header stays on screen', (weave) => {
  weave.createSpace({ name: 'Ledger' });
  // Fits its card, so the page scrolls: the Issue's own mode.
  tall = weave.createTable({ space: 'Ledger', name: 'Tall', description: 'The ledger of record.\n\nEvery row is one entry, kept for the audit.' });
  weave.updateTable(tall.id, { hideRollups: false });
  // Rows of one height, so a row's place is its index times that height and
  // a row brought into view can be held to the pixel.
  for (let i = 0; i < 600; i++) weave.createEntity('Tall', { name: `t${String(i).padStart(4, '0')}` });
  // A description far longer than the five-line clamp.
  long = weave.createTable({
    space: 'Ledger', name: 'Long',
    description: Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1} of a description nobody should have to scroll past to reach the rows.`).join('\n\n'),
  });
  for (let i = 0; i < 300; i++) weave.createEntity('Long', { name: `l${String(i).padStart(4, '0')}` });
  // Wider than its card, so the wrap is the scroller.
  wide = weave.createTable({ space: 'Ledger', name: 'Wide', description: 'Too many columns to fit.' });
  for (let i = 0; i < 12; i++) weave.addField(wide, { name: `A long column name ${i}`, type: 'number' });
  for (let i = 0; i < 300; i++) weave.createEntity('Wide', { name: `w${String(i).padStart(4, '0')}`, values: { 'A long column name 0': i } });
});

if (s) {
  const { base, browser } = s;
  const VIEWPORT = { width: 1470, height: 900 };

  const open = async (table, theme, mode) => {
    const page = await browser.newPage({ viewport: VIEWPORT });
    await page.addInitScript(() => { try { localStorage.clear(); } catch { /* blocked */ } });
    await page.goto(`${base}/#/table/${table.id}`, { waitUntil: 'load' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.waitForSelector('.view-desc-body');
    await page.waitForFunction((m) => {
      const w = document.querySelector('.table-wrap');
      return m === 'wrap' ? !!(w?.classList.contains('wv-grid-scroll') && w.style.maxHeight) : !!w?.classList.contains('wv-fit');
    }, mode);
    await page.waitForTimeout(300);
    return page;
  };

  const scrollPage = async (page, top) => {
    await page.evaluate((t) => document.scrollingElement.scrollTo({ top: t, behavior: 'instant' }), top);
    await page.waitForTimeout(400);
  };

  /* Everything the reader needs to see about the chrome, in viewport pixels,
     and what the pointer would hit at the points that matter. */
  const measure = (page) => page.evaluate(() => {
    const rect = (n) => { const r = n.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height }; };
    const hdr = document.querySelector('#main > .view-header');
    const th = document.querySelector('.wv-grid thead tr:first-child th.col-head');
    const pid = document.querySelector('.wv-grid thead tr:first-child th.pid-head');
    const foot = document.querySelector('.wv-grid thead tr.wv-foot td.pid-cell');
    const parts = {
      crumb: rect(hdr.querySelector('.crumb-path')),
      title: rect(hdr.querySelector('.view-title')),
      desc: rect(hdr.querySelector('.view-desc')),
      toolbar: rect(hdr.querySelector('.crumb-actions')),
      eye: rect(hdr.querySelector('.eye-btn')),
    };
    const hit = (x, y) => document.elementFromPoint(x, y);
    const h = rect(hdr);
    const head = rect(th);
    const underHead = Math.max(head.bottom, foot ? foot.getBoundingClientRect().bottom : 0);
    const x = head.left + 20;
    const pidX = rect(pid).left + 10;
    const rowHit = hit(x, underHead + 3)?.closest('tbody tr.entity-row');
    const pidHit = hit(pidX, underHead + 3)?.closest('td');
    return {
      scrollY,
      innerHeight,
      hdr: h,
      parts,
      head,
      pid: rect(pid),
      foot: foot ? rect(foot) : null,
      underHead,
      hitTitle: !!hit(parts.title.left + 10, (parts.title.top + parts.title.bottom) / 2)?.closest('.view-title'),
      hitEye: !!hit((parts.eye.left + parts.eye.right) / 2, (parts.eye.top + parts.eye.bottom) / 2)?.closest('.eye-btn'),
      hitHeaderEdge: !!hit(x, h.bottom - 2)?.closest('.view-header'),
      hitHead: !!hit(x, head.top + 3)?.closest('thead th'),
      rowUnderHead: rowHit ? Number(rowHit.dataset.i) : null,
      rowUnderHeadTop: rowHit ? rowHit.getBoundingClientRect().top : null,
      pidUnderHead: pidHit ? pidHit.className : null,
      headerBg: getComputedStyle(hdr).backgroundColor,
    };
  });

  const assertPinned = (m, label) => {
    // The block is on screen: every part of it lies inside the viewport and
    // inside the block, and the pointer reaches it.
    for (const [name, r] of Object.entries(m.parts)) {
      assert.ok(r.top >= 0 && r.bottom <= m.hdr.bottom + 0.5, `${label}: the ${name} is on screen inside the header block ${JSON.stringify({ name, r, hdr: m.hdr })}`);
    }
    assert.ok(m.hdr.top <= 0 && m.hdr.bottom > 0 && m.hdr.bottom < m.innerHeight / 2, `${label}: the block rests at the top of the viewport ${JSON.stringify(m.hdr)}`);
    assert.ok(m.hitTitle, `${label}: the title is on top, not under the rows`);
    assert.ok(m.hitEye, `${label}: the toolbar's eye is on top and clickable`);
    assert.ok(m.hitHeaderEdge, `${label}: the rows pass under the block, not over it`);
    assert.notEqual(m.headerBg, 'rgba(0, 0, 0, 0)', `${label}: the block is opaque, so rows do not show through`);
    // The column header sticks directly under the block, the frozen # head
    // with it, and the rows pass under them.
    assert.ok(Math.abs(m.head.top - m.hdr.bottom) <= 1, `${label}: the column header sits right under the block ${JSON.stringify({ head: m.head, hdr: m.hdr })}`);
    assert.ok(Math.abs(m.pid.top - m.hdr.bottom) <= 1, `${label}: the frozen # head sits on the same line ${JSON.stringify({ pid: m.pid, hdr: m.hdr })}`);
    assert.ok(m.hitHead, `${label}: the column header is on top of the rows`);
    if (m.foot) assert.ok(Math.abs(m.foot.top - m.head.bottom) <= 1, `${label}: the Σ row sits right under the column header ${JSON.stringify({ foot: m.foot, head: m.head })}`);
    assert.ok(m.rowUnderHead != null, `${label}: a body row is what shows right under the column header`);
    assert.match(m.pidUnderHead ?? '', /pid-cell/, `${label}: the frozen # column rides under the same line`);
  };

  for (const theme of ['light', 'dark']) {
    test(`a page-scrolled grid keeps crumbs, title, description and toolbar pinned above its column header (${theme})`, async () => {
      const page = await open(tall, theme, 'page');
      try {
        const rest = await measure(page);
        assert.equal(rest.scrollY, 0);
        await scrollPage(page, 8000);
        const far = await measure(page);
        assert.ok(far.scrollY > 7000, `the page scrolled: ${far.scrollY}`);
        assertPinned(far, 'at 8000');
        assert.ok(far.rowUnderHead > 150, `the rows under the header are far down the table: ${far.rowUnderHead}`);
        // Its pinned position is one position, wherever the reader stands.
        await scrollPage(page, 14000);
        const further = await measure(page);
        assertPinned(further, 'at 14000');
        assert.equal(further.hdr.top, far.hdr.top, 'the block rests at the same position');
        assert.equal(further.head.top, far.head.top, 'and so does the column header');

        // A row brought into view from above lands right under the column
        // header, not under the pinned block.
        const target = further.rowUnderHead - 40;
        await page.evaluate((i) => document.querySelector('.table-wrap').wvScrollToRow(i), target);
        await page.waitForTimeout(300);
        const landed = await page.evaluate((i) => {
          const tr = document.querySelector(`.wv-grid tbody tr[data-i="${i}"]`);
          return tr ? tr.getBoundingClientRect().top : null;
        }, target);
        const after = await measure(page);
        assert.ok(landed != null && Math.abs(landed - after.underHead) <= 1,
          `row ${target} lands right under the column header ${JSON.stringify({ landed, underHead: after.underHead })}`);
        assert.equal(after.rowUnderHead, target, 'and it is the row the reader sees there');
      } finally {
        await page.close();
      }
    });

    test(`an opened long description is capped, so the pinned block leaves the rows the viewport (${theme})`, async () => {
      const page = await open(long, theme, 'page');
      try {
        await page.click('.view-desc-more');
        await page.waitForTimeout(200);
        await scrollPage(page, 4000);
        const m = await measure(page);
        assert.ok(m.scrollY > 3000, `the page scrolled: ${m.scrollY}`);
        assertPinned(m, 'long description, opened');
        assert.ok(m.hdr.bottom <= m.innerHeight * 0.45, `the pinned block takes under half the viewport ${JSON.stringify({ hdr: m.hdr, innerHeight: m.innerHeight })}`);
        const body = await page.$eval('.view-desc-body', (b) => ({ clamped: b.classList.contains('clamped'), scroll: b.scrollHeight, client: b.clientHeight, overflow: getComputedStyle(b).overflowY }));
        assert.equal(body.clamped, false, 'the description is open');
        assert.ok(body.scroll > body.client && body.overflow === 'auto', `the rest of it scrolls inside the block ${JSON.stringify(body)}`);
      } finally {
        await page.close();
      }
    });

    /* A window too short for the block and the rows both: a pinned block
       would leave the rows a strip under it, and a row's checkbox or cell
       could never be reached. There the block lets go and scrolls with the
       page, and the column header sticks at the viewport's edge again. */
    test(`in a window under twice the block's height the block scrolls with the page (${theme})`, async () => {
      const page = await browser.newPage({ viewport: { width: 1100, height: 200 } });
      try {
        await page.goto(`${base}/#/table/${tall.id}`, { waitUntil: 'load' });
        await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
        await page.waitForSelector('.view-desc-body');
        await page.waitForTimeout(300);
        await scrollPage(page, 3000);
        const m = await page.evaluate(() => ({
          hdr: document.querySelector('#main > .view-header').getBoundingClientRect().bottom,
          head: document.querySelector('.wv-grid thead th.col-head').getBoundingClientRect().top,
        }));
        assert.ok(m.hdr < 0, `the block scrolled away with the page: ${JSON.stringify(m)}`);
        assert.ok(Math.abs(m.head) <= 1, `the column header sticks at the viewport's edge: ${JSON.stringify(m)}`);
        // And a row is reachable: the one on screen under the column header
        // takes a real click on its checkbox, and the selection bar rises.
        const i = await page.evaluate(() => {
          const th = document.querySelector('.wv-grid thead th.sel-head').getBoundingClientRect();
          const under = Math.max(...[...document.querySelector('.wv-grid thead').rows].map((r) => r.cells[0].getBoundingClientRect().bottom));
          return document.elementFromPoint(th.left + th.width / 2, under + 12)?.closest('tr.entity-row')?.dataset.i;
        });
        assert.ok(i != null, 'a row shows under the column header');
        await page.locator(`.wv-grid tbody tr[data-i="${i}"] .sel-box`).check({ timeout: 5000 });
        await page.waitForSelector('.sel-puck', { timeout: 5000 });
      } finally {
        await page.close();
      }
    });

    test(`a wrap-scrolled grid is unchanged: the page holds still and the column header sticks to the wrap (${theme})`, async () => {
      const page = await open(wide, theme, 'wrap');
      try {
        const rest = await measure(page);
        await page.evaluate(() => document.querySelector('.table-wrap').scrollTo({ top: 5000, behavior: 'instant' }));
        await page.waitForTimeout(400);
        const m = await measure(page);
        const wrapTop = await page.$eval('.table-wrap', (w) => ({ top: w.getBoundingClientRect().top, scrollTop: w.scrollTop }));
        assert.ok(wrapTop.scrollTop > 4000, `the wrap scrolled: ${wrapTop.scrollTop}`);
        assert.equal(m.scrollY, 0, 'the page did not move');
        assert.equal(m.hdr.top, rest.hdr.top, 'the header block sits where it was drawn');
        assert.ok(Math.abs(m.head.top - wrapTop.top) <= 1, `the column header sticks to the wrap's own top ${JSON.stringify({ head: m.head, wrapTop })}`);
        assert.ok(m.hitTitle && m.hitEye, 'the title and the toolbar are on screen');
        assert.ok(m.rowUnderHead > 100, `the rows under the column header are far down: ${m.rowUnderHead}`);
      } finally {
        await page.close();
      }
    });
  }
}
