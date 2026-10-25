import test from 'node:test';
import assert from 'node:assert/strict';
import { engineOf, launch, settled, phoneProfile, PHONE } from './lib/browser.mjs';

const IPHONE = phoneProfile()?.page ?? null;

const s = await launch('header dots stay on the breadcrumb row', (weave) => {
  weave.createSpace({ name: 'Development' });
  const t = weave.createTable({ space: 'Development', name: 'Feature' });
  weave.addField(t, { name: 'Status', type: 'select', config: { options: ['Planned', 'Shipped'] } });
  const e = weave.createEntity(t, { name: 'Row one', values: { Status: 'Planned' } });
  return { table: `#/table/${t.id}`, entity: e.id };
});

const measure = (page) => page.evaluate(() => {
  const h = document.querySelector('#main .view-header');
  const box = (n) => { if (!n || !n.getClientRects().length) return null; const b = n.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height, cy: (b.top + b.bottom) / 2 }; };
  const row = h.querySelector('.crumb-row');
  const dots = h.querySelector('.dots-btn[title="Table actions"]');
  const controls = [...h.querySelectorAll('.crumb-actions > *')].filter((n) => !n.contains(dots)).map(box).filter(Boolean);
  return {
    theme: document.documentElement.dataset.bsTheme,
    row: box(row), path: box(h.querySelector('.crumb-path')), dots: box(dots), tools: box(h.querySelector('.table-tools-btn')),
    inSheet: !!dots?.closest('.crumb-actions'),
    controls,
    toolbarTop: Math.min(...controls.map((c) => c.top)),
  };
});
const overlaps = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

if (s) {
  const { base, browser, table, entity } = s;

  for (const theme of ['light', 'dark']) {
    for (const dock of [0, 500, 700, 900]) {
      test(`on a desktop the table ⋮ stays at the right end of the breadcrumb row with the dock ${dock ? `${dock}px wide` : 'shut'} (${theme}, Issue #853)`, async () => {
        const page = await browser.newPage({ viewport: { width: 1470, height: 794 } });
        try {
          await page.addInitScript(([t, w]) => { localStorage.setItem('weave-theme', t); if (w) localStorage.setItem('wv-dock-width', String(w)); }, [theme, dock]);
          await page.goto(`${base}/${table}${dock ? `?e=${entity}` : ''}`, { waitUntil: 'networkidle' });
          await page.waitForSelector('#main .view-header .dots-btn[title="Table actions"]');
          if (dock) await page.waitForSelector('#dock:not([hidden]) .view-header');
          const m = await measure(page);
          assert.equal(m.theme, theme);
          assert.ok(m.dots, 'the ⋮ shows');
          assert.ok(Math.abs(m.dots.cy - m.path.cy) <= 1, `on the breadcrumb line: ⋮ centre ${m.dots.cy}, path centre ${m.path.cy}`);
          assert.ok(Math.abs(m.dots.right - m.row.right) <= 8, `at the right end of the row: ⋮ ${m.dots.right}, row ${m.row.right}`);
          for (const c of m.controls) assert.ok(!overlaps(m.dots, c), `the ⋮ covers no toolbar control: ${JSON.stringify(c)}`);
          if (dock >= 700) assert.ok(m.toolbarTop > m.path.bottom - 1, 'the toolbar has wrapped below the breadcrumb while the ⋮ stayed');
          await page.click('#main .view-header .dots-btn[title="Table actions"]');
          await page.waitForSelector('.chip-pop.wv-menu[role="menu"] .wv-menu-row');
        } finally { await page.close(); }
      });
    }
  }

  const phones = [['chromium 390x844', browser, { viewport: { width: 390, height: 844 } }]];
  const webkit = await engineOf('webkit');
  if (webkit && IPHONE) phones.push([`webkit ${PHONE}`, webkit, IPHONE]);
  for (const [engine, b, profile] of phones) {
    for (const theme of ['light', 'dark']) {
      test(`on a phone the table ⋮ stays in the header beside the sliders button, open sheet or not (${engine}, ${theme}, Issue #853)`, async () => {
        const page = await b.newPage(profile);
        try {
          await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
          await page.goto(`${base}/${table}`, { waitUntil: 'networkidle' });
          await page.waitForSelector('#main .table-tools-btn');
          let m = await measure(page);
          assert.equal(m.theme, theme);
          assert.ok(m.dots, 'the ⋮ shows in the header');
          assert.equal(m.inSheet, false, 'the ⋮ is not part of the sliders sheet');
          assert.ok(m.dots.width >= 44 && m.dots.height >= 44, `a 44px target (${m.dots.width}x${m.dots.height})`);
          assert.ok(Math.abs(m.dots.cy - m.tools.cy) <= 1, 'on the sliders button line');
          assert.ok(m.dots.right <= m.tools.left, 'just left of the sliders button');
          assert.ok(m.dots.right - m.tools.left > -16, 'and next to it');
          await page.click('#main .table-tools-btn');
          await settled(page.locator('#main .crumb-actions'));
          m = await measure(page);
          assert.ok(m.dots, 'the ⋮ stays in the header with the sheet open');
          assert.equal(await page.locator('#main .crumb-actions .dots-btn').count(), 0, 'the sheet carries no second ⋮');
          await page.keyboard.press('Escape');
          await page.click('#main .view-header .dots-btn[title="Table actions"]');
          await page.waitForSelector('.chip-pop.wv-menu.wv-menu-sheet .wv-menu-row');
        } finally { await page.close(); }
      });
    }
  }
}
