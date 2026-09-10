/* The # column is frozen to the grid's left edge (Issue #252).

   A wide table scrolls sideways inside `.table-wrap`, and before this the
   whole header row went with it: scroll right to read a far column and the
   row lost its identity — no `#12 ↗` to open it, no id to say which record
   the values belonged to. The selection box shares the fate, and it has to
   travel WITH the # link or the pair separates mid-scroll.

   Freezing a table cell is more than `left: 0`. A sticky cell floats over
   content that is still moving underneath it, so it has to paint: an opaque
   ground in both themes, and a z-order that beats the cells beside it, the
   Σ rollup row it passes under, and the sticky header it meets in the
   corner. Each of those is a claim below, read off a real layout — the
   opacity by asking the document what is actually on top at that point,
   which is the only question a bleed-through answers wrong.

   The other half of the Issue — that no drag can move or precede the #
   column — was already locked by test/table-reorder-browser.test.mjs
   ("the # column takes no drag") when Issue #139 landed; the two suites
   together are the Issue's gate. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

/* Ten wide columns against a 900px window: the wrap has to scroll. */
const COLS = Array.from({ length: 10 }, (_, i) => `A rather wide column ${i}`);

let wide, narrow;
const s = await launch('the frozen # column', (weave) => {
  weave.createSpace({ name: 'Ledger' });
  // A grid that fits its card, for the clipped-wrap case below.
  narrow = weave.createTable({ space: 'Ledger', name: 'Narrow' });
  weave.addField(narrow, { name: 'A', type: 'text' });
  for (let i = 0; i < 4; i++) weave.createEntity(narrow, { name: `n${i}`, values: { A: 'x' } });
  wide = weave.createTable({ space: 'Ledger', name: 'Wide' });
  for (const name of COLS) weave.addField(wide, { name, type: 'text' });
  for (let i = 0; i < 25; i++) {
    weave.createEntity('Wide', {
      name: `Row ${i}`,
      values: Object.fromEntries(COLS.map((c) => [c, `value ${i} for ${c}`])),
    });
  }
});

if (s) {
  const { base, browser } = s;

  const openScrolled = async (theme) => {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await page.goto(`${base}/#/table/${wide.id}`, { waitUntil: 'load' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    if (theme) await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    // Scroll the wrap, not the page: the wrap is the sideways scroller.
    const scrolled = await page.evaluate(() => {
      const wrap = document.querySelector('.table-wrap');
      wrap.scrollLeft = 400;
      return wrap.scrollLeft;
    });
    assert.ok(scrolled > 100, `the grid actually scrolls sideways (scrollLeft ${scrolled})`);
    await page.waitForTimeout(60);
    return page;
  };

  /* Geometry, painted colour and what is on top, for one row's frozen pair. */
  const frozenState = (page) => page.evaluate(() => {
    const wrap = document.querySelector('.table-wrap');
    const wrapLeft = wrap.getBoundingClientRect().left;
    const read = (el) => {
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      return {
        offset: Math.round(r.left - wrapLeft),
        width: Math.round(r.width),
        bg: getComputedStyle(el).backgroundColor,
        zIndex: getComputedStyle(el).zIndex,
        // The element the reader's pointer would hit at the cell's middle:
        // anything but this cell (or its own content) means something else
        // is painting over it, and a transparent cell shows what is under.
        onTop: at ? (el.contains(at) || at === el) : false,
        onTopTag: at ? `${at.tagName}.${at.className}` : 'none',
      };
    };
    const row = document.querySelector('.wv-grid tbody tr.entity-row');
    const anyField = row.querySelector('td[data-field]');
    return {
      sel: read(row.querySelector('td.sel-cell')),
      pid: read(row.querySelector('td.pid-cell')),
      headSel: read(document.querySelector('.wv-grid thead th.sel-head')),
      headPid: read(document.querySelector('.wv-grid thead th.pid-head')),
      headCol: read(document.querySelector('.wv-grid thead th.col-head')),
      // A field cell that has scrolled left, out of the wrap: proof the body
      // moved while the frozen pair did not.
      fieldOffset: Math.round(anyField.getBoundingClientRect().left - wrapLeft),
    };
  });

  /* A colour is opaque unless it states an alpha. Both notations turn up
     here: a token resolves to `rgb(…)`/`rgba(…)`, a `color-mix` to
     `color(srgb … / a)`. */
  const opaque = (bg) => {
    assert.match(bg, /^(rgba?|color)\(/, `a painted background, got ${bg}`);
    const alpha = /\/\s*([\d.]+)\s*\)$/.exec(bg) ?? /^rgba\([^)]*,\s*([\d.]+)\s*\)$/.exec(bg);
    return !alpha || Number(alpha[1]) === 1;
  };

  for (const theme of ['light', 'dark']) {
    test(`${theme}: the # column and its checkbox stay at the wrap's left edge while the body scrolls away`, async () => {
      const page = await openScrolled(theme);
      try {
        const g = await frozenState(page);
        assert.equal(g.sel.offset, 0, `the checkbox column is pinned to the wrap's left edge: ${JSON.stringify(g.sel)}`);
        assert.equal(g.pid.offset, g.sel.width,
          `the # column sits immediately right of it, still frozen: ${JSON.stringify(g.pid)}`);
        assert.equal(g.headSel.offset, 0, 'the select-all header is pinned too');
        assert.equal(g.headPid.offset, g.headSel.width, 'and the # header sits with it');
        assert.ok(g.fieldOffset < 0,
          `the body really did scroll out from under them (first field cell at ${g.fieldOffset})`);
      } finally { await page.close(); }
    });

    test(`${theme}: the frozen cells paint opaque, so nothing bleeds through them`, async () => {
      const page = await openScrolled(theme);
      try {
        const g = await frozenState(page);
        // headCol is a plain header: at this width it has scrolled out of the
        // wrap, which is the point — only the four frozen cells are on screen.
        for (const name of ['sel', 'pid', 'headSel', 'headPid']) {
          const cell = g[name];
          assert.ok(opaque(cell.bg), `${name} has an opaque ground, not ${cell.bg}`);
          assert.ok(cell.onTop, `${name} is what the reader sees at its own middle, not ${cell.onTopTag}`);
        }
      } finally { await page.close(); }
    });
  }

  test('the seam appears only once something is passing under the frozen column', async () => {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    try {
      await page.goto(`${base}/#/table/${wide.id}`, { waitUntil: 'load' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      const seam = () => page.evaluate(() => getComputedStyle(
        document.querySelector('.wv-grid tbody td.pid-cell')).borderRightColor);
      const rest = await seam();
      assert.match(rest, /rgba\(0, 0, 0, 0\)|transparent/, `no rule down the grid at rest, got ${rest}`);
      await page.evaluate(() => { document.querySelector('.table-wrap').scrollLeft = 400; });
      await page.waitForTimeout(80);
      const scrolled = await seam();
      assert.notEqual(scrolled, rest, 'the seam takes its colour once the body scrolls under it');
      assert.doesNotMatch(scrolled, /rgba\(0, 0, 0, 0\)/, `and it is a visible hairline, got ${scrolled}`);
      // Reserved at rest, so the columns beside it do not jump by a pixel
      // the first time the reader scrolls.
      const widths = await page.evaluate(() => getComputedStyle(
        document.querySelector('.wv-grid tbody td.pid-cell')).borderRightWidth);
      assert.equal(widths, '1px', 'the hairline is reserved, not grown');
      await page.evaluate(() => { document.querySelector('.table-wrap').scrollLeft = 0; });
      await page.waitForTimeout(80);
      assert.equal(await seam(), rest, 'and it goes again when the grid comes back to its left edge');
    } finally { await page.close(); }
  });

  test('a chosen row carries its tint onto the frozen cells without going see-through', async () => {
    const page = await openScrolled();
    try {
      await page.click('.wv-grid tbody tr.entity-row td.sel-cell .sel-box');
      await page.waitForSelector('.wv-grid tbody tr.row-selected');
      const g = await page.evaluate(() => {
        const row = document.querySelector('.wv-grid tbody tr.row-selected');
        const bg = (sel) => getComputedStyle(row.querySelector(sel)).backgroundColor;
        return { pid: bg('td.pid-cell'), sel: bg('td.sel-cell'), field: bg('td[data-field]') };
      });
      for (const [name, bg] of Object.entries(g)) {
        if (name === 'field') continue;
        assert.ok(opaque(bg), `the chosen row's ${name} cell stays opaque, not ${bg}`);
      }
      assert.notEqual(g.pid, g.field, 'and it is the tint, not the plain surface');
    } finally { await page.close(); }
  });

  test('a grid that fits its card is not shifted by the freeze', async () => {
    /* A fitting grid clips instead of scrolling (`.wv-fit`, Issue #233), and
       `overflow: clip` is not a scroll container — a sticky cell inside one
       resolves against the page instead of the wrap. Nothing should move:
       every cell is already past its own offset, so the freeze is inert. */
    const page = await browser.newPage({ viewport: { width: 1400, height: 700 } });
    try {
      await page.goto(`${base}/#/table/${narrow.id}`, { waitUntil: 'load' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      await page.waitForTimeout(300);
      const g = await page.evaluate(() => {
        const wrap = document.querySelector('.table-wrap');
        const at = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().left
          - wrap.getBoundingClientRect().left);
        return {
          clipped: getComputedStyle(wrap).overflowX === 'clip',
          sel: at('.wv-grid tbody td.sel-cell'),
          pid: at('.wv-grid tbody td.pid-cell'),
          selWidth: Math.round(document.querySelector('.wv-grid tbody td.sel-cell').getBoundingClientRect().width),
        };
      });
      assert.ok(g.clipped, 'the narrow grid clips rather than scrolling');
      assert.equal(g.sel, 0, 'the checkbox column sits where it always did');
      assert.equal(g.pid, g.selWidth, 'and the # right behind it, unshifted');
    } finally { await page.close(); }
  });

  test('the corner header out-ranks the sticky header row, which out-ranks the frozen body cells', async () => {
    const page = await openScrolled();
    try {
      const g = await frozenState(page);
      const z = (v) => (v === 'auto' ? 0 : Number(v));
      assert.ok(z(g.headPid.zIndex) > z(g.headCol.zIndex),
        `the corner beats a plain sticky header (${g.headPid.zIndex} vs ${g.headCol.zIndex})`);
      assert.ok(z(g.headSel.zIndex) > z(g.headCol.zIndex), 'both corner cells do');
      assert.ok(z(g.headCol.zIndex) > z(g.pid.zIndex),
        `and the header beats the frozen body cells (${g.headCol.zIndex} vs ${g.pid.zIndex})`);
      assert.ok(z(g.pid.zIndex) > 0, 'which are themselves lifted over the cells beside them');
    } finally { await page.close(); }
  });

  test('the Σ rollup row keeps its own frozen corner over the body scrolling under it', async () => {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    try {
      await page.goto(`${base}/#/table/${wide.id}`, { waitUntil: 'load' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      // The Σ row is opt-in per table (Issue #249): switch it on directly.
      await page.evaluate(async (id) => {
        await fetch(`/api/tables/${id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hideRollups: false }),
        });
      }, wide.id);
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('.wv-grid tr.wv-foot');
      const g = await page.evaluate(() => {
        const wrap = document.querySelector('.table-wrap');
        wrap.scrollLeft = 400;
        const wrapLeft = wrap.getBoundingClientRect().left;
        const foot = document.querySelector('.wv-grid tr.wv-foot');
        const cell = foot.querySelector('td.pid-cell');
        const r = cell.getBoundingClientRect();
        const at = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
        const bodyPid = document.querySelector('.wv-grid tbody td.pid-cell');
        const zi = (el) => { const v = getComputedStyle(el).zIndex; return v === 'auto' ? 0 : Number(v); };
        return {
          offset: Math.round(r.left - wrapLeft),
          onTop: at ? (cell.contains(at) || at === cell) : false,
          onTopTag: at ? `${at.tagName}.${at.className}` : 'none',
          footZ: zi(foot.querySelector('td:not(.sel-cell):not(.pid-cell)')),
          footCornerZ: zi(cell),
          bodyZ: zi(bodyPid),
        };
      });
      assert.ok(g.offset > 0 && g.offset < 60, `the Σ row's # cell is frozen at the left edge too (${g.offset})`);
      assert.ok(g.onTop, `and it paints over what scrolls under it, not ${g.onTopTag}`);
      assert.ok(g.footCornerZ > g.footZ, 'its corner beats the rest of the Σ row');
      assert.ok(g.footZ > g.bodyZ, 'and the Σ row beats the frozen body cells that pass beneath it');
    } finally { await page.close(); }
  });

  test('the sticky + New row does not tear when the grid is scrolled sideways', async () => {
    const page = await openScrolled();
    try {
      const g = await page.evaluate(() => {
        const wrap = document.querySelector('.table-wrap');
        const td = document.querySelector('.wv-grid tr.add-entity-row td');
        const r = td.getBoundingClientRect();
        const w = wrap.getBoundingClientRect();
        const zi = (el) => { const v = getComputedStyle(el).zIndex; return v === 'auto' ? 0 : Number(v); };
        return {
          spans: Math.round(r.width) >= Math.round(wrap.scrollWidth) - 2,
          inView: r.bottom > w.top && r.top < w.bottom,
          addZ: zi(td),
          bodyZ: zi(document.querySelector('.wv-grid tbody td.pid-cell')),
        };
      });
      assert.ok(g.spans, 'the + New cell still spans the whole grid');
      assert.ok(g.inView, 'and is still on screen at the bottom of the wrap');
      assert.ok(g.addZ >= g.bodyZ, 'and is not punched through by a frozen cell passing under it');
    } finally { await page.close(); }
  });

  test('a related grid, which has no checkbox column, freezes its # against the edge itself', async () => {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    try {
      await page.goto(`${base}/#/table/${wide.id}`, { waitUntil: 'load' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      const g = await page.evaluate(() => {
        const grid = document.querySelector('.wv-grid');
        // The registry, stats and related grids draw pid-head with no
        // sel-head beside it; the offset is read off the same rule.
        const probe = document.createElement('table');
        probe.className = 'wv-grid';
        probe.innerHTML = '<thead><tr><th class="pid-head">#</th><th class="col-head">A</th></tr></thead>';
        grid.parentElement.append(probe);
        const cs = getComputedStyle(probe.querySelector('.pid-head'));
        const out = { position: cs.position, left: cs.left };
        probe.remove();
        return out;
      });
      assert.equal(g.position, 'sticky', 'the # header is frozen there too');
      assert.equal(g.left, '0px', 'and against the edge, with no checkbox column to clear');
    } finally { await page.close(); }
  });
}
