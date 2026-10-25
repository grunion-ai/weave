import test from 'node:test';
import assert from 'node:assert/strict';
import { engineOf, launch, phoneProfile } from './lib/browser.mjs';

const IPHONE = phoneProfile()?.page ?? null;
const HEIGHT = { compact: 1, comfortable: 2, spacious: 2 };

const s = await launch('phone list chip line', (weave) => {
  weave.createSpace({ name: 'Development' });
  const ids = {};
  for (const density of Object.keys(HEIGHT)) {
    const issues = weave.createTable({ space: 'Development', name: `Issue ${density}` });
    weave.addField(issues, { name: 'Status', type: 'workflow', config: { states: [
      { name: 'Open', category: 'not-started', default: true },
      { name: 'Fixed', category: 'done' }] } });
    weave.addField(issues, { name: 'Severity', type: 'select', config: { options: ['Low', 'Medium', 'High'] } });
    weave.addField(issues, { name: 'Symptom', type: 'multiselect', config: { options: ['Looks broken', 'Slow', 'Wrong data', 'Error'] } });
    weave.addField(issues, { name: 'Area', type: 'select', config: { options: ['Grid', 'Document editor', 'Phone shell'] } });
    weave.addField(issues, { name: 'Release', type: 'text' });
    for (let i = 0; i < 12; i++) {
      weave.createEntity(issues, {
        name: i % 2 ? `Issue ${i}` : `Issue ${i}: on a phone list row at Comfortable or Spacious, the chips split across two lines`,
        values: { Status: 'Open', Severity: 'Medium', Symptom: ['Looks broken', 'Wrong data'], Area: i % 3 ? 'Document editor' : 'Grid', Release: i % 4 ? 'v0.4.82 and later' : '' },
      });
    }
    ids[density] = issues.id;
  }
  return { ids };
});

const rows = (page) => page.evaluate(() => {
  const wrap = document.querySelector('#main .list-wrap');
  return {
    theme: document.documentElement.dataset.bsTheme,
    density: wrap.dataset.density,
    rows: [...wrap.querySelectorAll('.wv-list .list-row')].map((tr) => {
      const r = tr.getBoundingClientRect();
      const name = tr.querySelector('.list-title').getBoundingClientRect();
      const chips = [...tr.querySelectorAll('.phone-chip[data-field]')].filter((td) => td.getClientRects().length).map((td) => {
        const b = td.getBoundingClientRect();
        return { top: Math.round(b.top - r.top), bottom: b.bottom - r.top, right: b.right, more: getComputedStyle(td, '::after').content };
      });
      return { h: Math.round(r.height), right: r.right, nameBottom: name.bottom - r.top, chips };
    }),
  };
});

if (s) {
  const { base, browser, ids } = s;
  const engines = [['chromium 390x844', browser, { viewport: { width: 390, height: 844 } }]];
  const webkit = await engineOf('webkit');
  if (webkit && IPHONE) engines.push(['webkit iPhone 15', webkit, IPHONE]);
  const open = async (b, profile, theme, density) => {
    const id = ids[density];
    const page = await b.newPage(profile);
    await page.addInitScript(([t, id, d]) => { localStorage.setItem('weave-theme', t); localStorage.setItem(`weave-grid-density:${id}`, d); }, [theme, id, density]);
    await page.goto(`${base}/#/table/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(profile.viewport.width > 600 ? '#main .wv-grid tbody tr.entity-row' : `#main .list-wrap[data-density="${density}"] .list-row`);
    await page.waitForTimeout(200);
    return page;
  };

  for (const [engine, b, profile] of engines) {
    for (const theme of ['light', 'dark']) {
      for (const density of ['compact', 'comfortable', 'spacious']) {
        test(`on a phone at ${density} every list row keeps one chip line under its name, inside the row, with +N for the rest (${engine}, ${theme}, Issue #730, Issue #740)`, async () => {
          const page = await open(b, profile, theme, density);
          try {
            const seen = await rows(page);
            assert.equal(seen.theme, theme);
            assert.equal(seen.density, density);
            let counted = 0;
            for (const [i, r] of seen.rows.entries()) {
              assert.ok(r.h >= 44, `row ${i} is a touch row (${r.h}px)`);
              assert.ok(r.chips.length >= 1, `row ${i} shows chips`);
              const tops = new Set(r.chips.map((c) => c.top));
              assert.equal(tops.size, 1, `row ${i}'s chips share one top: ${[...tops]}`);
              for (const c of r.chips) {
                assert.ok(c.top >= r.nameBottom, `row ${i}'s chips sit under its name`);
                assert.ok(c.bottom <= r.h + 0.5 && c.right <= r.right + 0.5, `row ${i}'s chips sit inside the row: ${JSON.stringify({ c, h: r.h, right: r.right })}`);
              }
              if (r.chips.some((c) => /^"\+\d+"$/.test(c.more))) counted++;
            }
            assert.ok(counted > 0, 'a row with more chips than room shows a +N counter');
          } finally { await page.close(); }
        });
      }
    }
  }

  test('on a desktop the grid keeps one chip per cell and shows no phone counter (Issue #730)', async () => {
    const page = await open(browser, { viewport: { width: 1280, height: 844 } }, 'light', 'comfortable');
    try {
      const n = await page.evaluate(() => document.querySelectorAll('#main :is(td, .phone-chip)[data-more], #main :is(td, .phone-chip).list-hide').length);
      assert.equal(n, 0);
    } finally { await page.close(); }
  });
}
