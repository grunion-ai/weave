/* The hairline header and the trailing "+" (Feature #240, Kyle 2026-09-27).

   The header was a grey band with rounded top corners, and the add-field "+"
   sat in the one column with no width of its own, which took whatever the
   fields left of the card: on a small table the grey ran past the last field
   to the card's edge, ending in a rounded corner around a lonely "+". The
   header now sits on the card surface over one hairline, a step stronger
   than the row rule; the "+" trails the last field and the stretch after it
   is bare card; on a grid wider than its card the "+" holds at the wrap's
   right edge. Header behaviour (sticky, resize, reorder, freeze) is gated by
   its own suites and is not re-tested here; this file asserts the look, in
   both themes, off computed styles and rendered geometry.

   Playwright is NOT a dependency; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const VIEW = { width: 1600, height: 720 };

let small, wide;
const s = await launch('hairline grid header', (weave) => {
  weave.createSpace({ name: 'Look' });
  small = weave.createTable({ space: 'Look', name: 'Small' });
  weave.addField(small, { name: 'Owner', type: 'text' });
  weave.addField(small, { name: 'Status', type: 'select', config: { options: ['Open', 'Done'] } });
  // Tall enough that the page scrolls the header into its stuck place.
  for (let i = 0; i < 80; i++) weave.createEntity(small, { name: `row ${i}`, values: { Owner: 'Sam' } });
  wide = weave.createTable({ space: 'Look', name: 'Wide' });
  for (let i = 0; i < 14; i++) weave.addField(wide, { name: `A long column name ${i}`, type: 'text' });
  for (let i = 0; i < 60; i++) weave.createEntity(wide, { name: `wide ${i}` });
});

if (s) {
  const { base, browser } = s;
  const open = async (db, theme) => {
    const page = await browser.newPage({ viewport: VIEW });
    await page.goto(`${base}/#/table/${db.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForTimeout(150);
    return page;
  };
  /* The page reads its own colours: the surface is #main's ground, and a
     box-shadow list is split into its layers, each with its colour and
     whether it is inset. */
  const PROBE = () => {
    // A color-mix() computes to `color(srgb r g b [/ a])` in 0..1.
    const rgb = (c) => {
      const n = (c.match(/[\d.]+/g) ?? []).map(Number);
      return c.startsWith('color(srgb') ? n.map((v, i) => (i < 3 ? v * 255 : v)) : n;
    };
    const layers = (v) => (v === 'none' ? [] : v.split(/,(?![^(]*\))/).map((l) => ({
      color: rgb(l.match(/(?:rgba?|color)\([^)]*\)/)?.[0] ?? ''), inset: /inset/.test(l),
    })));
    const lum = ([r, g, b]) => [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    // Composite a translucent rule over the surface before judging it.
    const over = (c, bg) => (c.length === 4 ? c.slice(0, 3).map((v, i) => v * c[3] + bg[i] * (1 - c[3])) : c.slice(0, 3));
    const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    return { rgb, layers, over, contrast };
  };
  const surface = (page) => page.evaluate(() => getComputedStyle(document.querySelector('#main')).backgroundColor);

  for (const theme of ['light', 'dark']) {
    test(`${theme}: the header sits on the card surface, no band and no rounded corner`, async () => {
      const page = await open(small, theme);
      try {
        const ground = await surface(page);
        const heads = await page.evaluate(() => [...document.querySelectorAll('.wv-grid > thead > tr:first-child > th')].map((th) => {
          const cs = getComputedStyle(th);
          return { cls: th.className, bg: cs.backgroundColor, radius: [cs.borderTopLeftRadius, cs.borderTopRightRadius] };
        }));
        assert.ok(heads.length >= 5, 'checkbox, #, three fields and the "+"');
        for (const h of heads) {
          assert.equal(h.bg, ground, `${h.cls} paints the card surface (${h.bg} vs ${ground})`);
          assert.deepEqual(h.radius, ['0px', '0px'], `${h.cls} has square corners`);
        }
      } finally { await page.close(); }
    });

    test(`${theme}: labels are sentence case, 12 to 13px, weight 500, secondary ink`, async () => {
      const page = await open(small, theme);
      try {
        const got = await page.evaluate(() => {
          const cs = getComputedStyle(document.querySelector('.wv-grid th.col-head[data-col="Owner"]'));
          const probe = document.createElement('span');
          probe.style.color = 'var(--tblr-secondary)';
          document.body.append(probe);
          const secondary = getComputedStyle(probe).color;
          probe.remove();
          return { tt: cs.textTransform, ls: cs.letterSpacing, fw: cs.fontWeight, fs: parseFloat(cs.fontSize), color: cs.color, secondary };
        });
        assert.equal(got.tt, 'none', 'no uppercase');
        assert.ok(got.ls === 'normal' || got.ls === '0px', `no tracking (${got.ls})`);
        assert.equal(got.fw, '500');
        assert.ok(got.fs >= 12 && got.fs <= 13, `12 to 13px (${got.fs})`);
        assert.equal(got.color, got.secondary, 'the secondary ink');
      } finally { await page.close(); }
    });

    test(`${theme}: the header's hairline is one step stronger than the row rule`, async () => {
      const page = await open(small, theme);
      try {
        const got = await page.evaluate((probe) => {
          const P = new Function(`return (${probe})()`)();
          const bg = P.rgb(getComputedStyle(document.querySelector('#main')).backgroundColor);
          const ruleOf = (el) => P.over(P.layers(getComputedStyle(el).boxShadow).find((l) => l.inset).color, bg);
          const head = ruleOf(document.querySelector('.wv-grid th.col-head'));
          const row = ruleOf(document.querySelector('.wv-grid tbody tr.entity-row > td'));
          return { head: P.contrast(head, bg), row: P.contrast(row, bg) };
        }, PROBE.toString());
        assert.ok(got.head > got.row + 0.05, `header rule ${got.head.toFixed(2)}:1 against the row rule ${got.row.toFixed(2)}:1`);
      } finally { await page.close(); }
    });

    test(`${theme}: on a small table the "+" trails the last field and the stretch after it is bare card`, async () => {
      const page = await open(small, theme);
      try {
        const ground = await surface(page);
        const got = await page.evaluate(() => {
          const wrap = document.querySelector('.table-wrap');
          const grid = document.querySelector('.wv-grid');
          const heads = [...grid.tHead.rows[0].querySelectorAll('th.col-head')];
          const plusTh = grid.querySelector('th.add-field-head');
          const plus = plusTh.querySelector('.add-field-btn').getBoundingClientRect();
          const cs = getComputedStyle(plusTh);
          return {
            lastRight: heads.at(-1).getBoundingClientRect().right,
            plusLeft: plus.left,
            thRight: plusTh.getBoundingClientRect().right,
            gridRight: grid.getBoundingClientRect().right,
            wrapRight: wrap.getBoundingClientRect().left + wrap.clientWidth,
            bg: cs.backgroundColor,
            fade: getComputedStyle(plusTh, '::before').content,
            fits: wrap.classList.contains('wv-fit'),
          };
        });
        assert.ok(got.fits, 'the small grid fits its card');
        assert.ok(got.plusLeft >= got.lastRight - 1 && got.plusLeft - got.lastRight <= 16,
          `the "+" sits right after the last field (last field ends ${got.lastRight}, "+" starts ${got.plusLeft})`);
        assert.ok(got.gridRight <= got.thRight + 1, 'the grid ends with the "+" cell');
        assert.ok(got.wrapRight - got.gridRight > 200, `the card's slack is left bare, not handed to a column (${got.wrapRight - got.gridRight}px)`);
        assert.equal(got.bg, ground, 'the "+" cell paints the surface, no tint');
        assert.ok(got.fade === 'none' || got.fade === 'normal', `no overflow fade on a grid that fits (${got.fade})`);
      } finally { await page.close(); }
    });

    test(`${theme}: on a wide table the "+" holds at the right edge, scrolled to either end`, async () => {
      const page = await open(wide, theme);
      try {
        const ground = await surface(page);
        const at = (x) => page.evaluate((to) => {
          const wrap = document.querySelector('.table-wrap');
          wrap.scrollLeft = to === 'end' ? wrap.scrollWidth : 0;
          const w = wrap.getBoundingClientRect();
          const th = wrap.querySelector('th.add-field-head');
          const b = th.querySelector('.add-field-btn').getBoundingClientRect();
          const cs = getComputedStyle(th);
          return {
            scrolls: wrap.scrollWidth > wrap.clientWidth, left: b.left, right: b.right,
            wrapLeft: w.left, wrapRight: w.left + wrap.clientWidth,
            position: cs.position, rightPx: cs.right, bg: cs.backgroundColor,
            fade: getComputedStyle(th, '::before').content,
          };
        }, x);
        for (const end of ['start', 'end']) {
          const got = await at(end);
          assert.ok(got.scrolls, 'the wide grid overflows its card');
          assert.equal(got.position, 'sticky');
          assert.equal(got.rightPx, '0px');
          assert.equal(got.bg, ground, 'an opaque surface under the "+"');
          assert.ok(got.left >= got.wrapLeft && got.right <= got.wrapRight + 0.5,
            `scrolled to the ${end}, the "+" is inside the wrap (${got.left}..${got.right} in ${got.wrapLeft}..${got.wrapRight})`);
          assert.ok(got.fade !== 'none' && got.fade !== 'normal', 'the left fade shows while the grid overflows');
        }
      } finally { await page.close(); }
    });

    test(`${theme}: the header lifts with a faint shadow only once it is stuck`, async () => {
      const outer = (page) => page.evaluate((probe) => {
        const P = new Function(`return (${probe})()`)();
        const th = document.querySelector('.wv-grid > thead > tr:last-child > :last-child');
        return P.layers(getComputedStyle(th).boxShadow).filter((l) => !l.inset).length;
      }, PROBE.toString());
      // The page scrolls a grid that fits its card.
      let page = await open(small, theme);
      try {
        assert.equal(await outer(page), 0, 'no shadow at rest');
        await page.evaluate(() => document.querySelector('#main').scrollTo({ top: 1500, behavior: 'instant' })); // the page's scroller (Issue #609)
        await page.waitForTimeout(150);
        assert.equal(await outer(page), 1, 'a shadow once the page scrolls the rows under it');
        await page.evaluate(() => document.querySelector('#main').scrollTo({ top: 0, behavior: 'instant' }));
        await page.waitForTimeout(150);
        assert.equal(await outer(page), 0, 'and none back at the top');
      } finally { await page.close(); }
      // A wide grid scrolls in its own wrap.
      page = await open(wide, theme);
      try {
        assert.equal(await outer(page), 0, 'no shadow at rest in a scrolling wrap');
        await page.evaluate(() => { document.querySelector('.table-wrap').scrollTop = 600; });
        await page.waitForTimeout(150);
        assert.equal(await outer(page), 1, 'a shadow once the wrap scrolls the rows under it');
      } finally { await page.close(); }
    });

    test(`${theme}: a hovered header tints alone, and the + New bar carries no grey`, async () => {
      const page = await open(small, theme);
      try {
        const ground = await surface(page);
        await page.hover('.wv-grid th.col-head[data-col="Owner"]');
        await page.waitForTimeout(200);
        const bgs = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.wv-grid th.col-head')]
          .map((th) => [th.dataset.col, getComputedStyle(th).backgroundColor])));
        assert.notEqual(bgs.Owner, ground, 'the hovered header tints');
        assert.equal(bgs.Status, ground, 'its neighbour stays on the surface');
        await page.hover('.wv-grid .add-entity-btn');
        await page.waitForTimeout(200);
        const foot = await page.evaluate(() => getComputedStyle(document.querySelector('.wv-grid .add-entity-btn')).backgroundColor);
        assert.equal(foot, 'rgba(0, 0, 0, 0)', 'the + New bar has no fill under the pointer');
      } finally { await page.close(); }
    });
  }
}
