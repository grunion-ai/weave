import test from 'node:test';
import assert from 'node:assert/strict';
import { engineOf, launch, phoneProfile } from './lib/browser.mjs';

const IPHONE = phoneProfile()?.page ?? null;
const DENSITIES = ['compact', 'comfortable', 'spacious'];
const SYMPTOMS = ['Looks broken', 'Wrong data', 'Error message shown'];

const s = await launch('phone chip line', (weave) => {
  weave.createSpace({ name: 'Development' });
  const ids = {};
  for (const density of DENSITIES) {
    const t = weave.createTable({ space: 'Development', name: `Task ${density}` });
    weave.addField(t, { name: 'Status', type: 'workflow', config: { states: [
      { name: 'Open', category: 'not-started', default: true },
      { name: 'Fixed', category: 'done' }] } });
    weave.addField(t, { name: 'Severity', type: 'select', config: { options: ['Low', 'Medium', 'High'] } });
    weave.addField(t, { name: 'Estimate', type: 'number' });
    weave.addField(t, { name: 'Due', type: 'date' });
    weave.addField(t, { name: 'Release', type: 'text' });
    weave.addField(t, { name: 'Symptom', type: 'multiselect', config: { options: SYMPTOMS } });
    weave.addField(t, { name: 'Area', type: 'select', config: { options: ['Grid', 'Document editor', 'Phone shell'] } });
    weave.addField(t, { name: 'Size', type: 'formula', config: { expression: 'if(Estimate > 5, "big", "unsized")' } });
    for (let i = 0; i < 12; i++) {
      const name = i % 2 ? `Task ${i}` : `Task ${i}: a long name that runs past one line on a phone list row`;
      const values = [
        { Status: 'Open', Severity: 'Medium', Estimate: i, Due: '2026-11-20', Release: 'v0.4.82 and later', Symptom: SYMPTOMS, Area: 'Document editor' },
        { Status: 'Open', Severity: 'Low', Symptom: SYMPTOMS, Area: 'Document editor' },
        { Status: 'Fixed', Release: 'v0.4.82 and later', Symptom: SYMPTOMS },
        { Status: 'Open', Severity: 'Low', Symptom: ['Looks broken', 'Error message shown'], Area: 'Document editor', Release: 'v0.4.82 and later' },
      ][i % 4];
      weave.createEntity(t, { name, values });
    }
    weave.createEntity(t, { name: 'Only a name', values: {} });
    ids[density] = t.id;
  }
  return { ids };
});

const read = (page) => page.evaluate(() => {
  const grid = document.querySelector('#main .wv-grid');
  const visible = (n) => !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
  return [...grid.querySelectorAll('tbody tr.entity-row')].map((tr) => {
    const r = tr.getBoundingClientRect();
    const box = (n) => { const b = n.getBoundingClientRect(); return { left: b.left - r.left, top: b.top - r.top, bottom: b.bottom - r.top, right: b.right - r.left, h: b.height }; };
    const cells = [...tr.querySelectorAll(':scope > td[data-field]')].filter(visible).map((td) => {
      const face = [...td.querySelectorAll(':scope > .wv-cb > :not(.date-cell, .ms-box), :scope > .wv-cb > .date-cell > input.date-text, :scope > .wv-cb > .ms-box > .k:not(.k-more)')].find(visible);
      const style = face && getComputedStyle(face);
      const counters = [...td.querySelectorAll('.k-more')].filter(visible).map((n) => n.textContent.trim());
      const after = getComputedStyle(td, '::after').content;
      if (/^"\+\d+"$/.test(after)) counters.push(after.slice(1, -1));
      return {
        field: td.dataset.field, ...box(td),
        face: face ? { tag: face.tagName.toLowerCase(), cls: face.className, font: style.fontSize, bg: style.backgroundColor, ...box(face) } : null,
        counters,
      };
    });
    return { cells };
  });
});

const lines = (cells) => {
  const out = new Map();
  for (const c of cells) {
    const key = [...out.keys()].find((t) => Math.abs(t - c.top) < 4) ?? c.top;
    out.set(key, [...(out.get(key) ?? []), c]);
  }
  return [...out.values()];
};

if (s) {
  const { base, browser, ids } = s;
  const engines = [['chromium 390x844', browser, { viewport: { width: 390, height: 844 } }]];
  engines.push(['webkit iPhone 15', await engineOf('webkit'), IPHONE]);
  const open = async (b, profile, theme, density) => {
    const id = ids[density];
    const page = await b.newPage(profile);
    await page.addInitScript(([t, id, d]) => { localStorage.setItem('weave-theme', t); localStorage.setItem(`weave-grid-density:${id}`, d); }, [theme, id, density]);
    await page.goto(`${base}/#/table/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`#main .wv-grid[data-density="${density}"] tbody tr.entity-row`);
    await page.waitForTimeout(200);
    return page;
  };

  for (const [engine, b, profile] of engines) {
    for (const theme of ['light', 'dark']) {
      for (const density of DENSITIES) {
        test(`a phone chip line at ${density} draws every value as a same-size chip with one counter (${engine}, ${theme}, Issues #1372 #1373 #1388)`, async () => {
          const page = await open(b, profile, theme, density);
          try {
            const rows = await read(page);
            const select = rows.flatMap((r) => r.cells).find((c) => c.field === 'Severity')?.face;
            assert.ok(select, 'a select chip shows on some row');
            let sized = 0;
            const wrong = new Set();
            for (const r of rows) {
              for (const c of r.cells) {
                if (!c.face) continue;
                if (c.face.font !== select.font) wrong.add(`Issue #1372: ${c.field} (${c.face.tag}.${c.face.cls}) draws at ${c.face.font}, the select chip at ${select.font}`);
                if (c.field === 'Size') {
                  sized++;
                  if (c.face.bg === 'rgba(0, 0, 0, 0)') wrong.add('Issue #1388: the formula text has no chip background');
                  if (c.face.bg !== select.bg) wrong.add(`Issue #1388: the formula chip fills ${c.face.bg}, the select chip ${select.bg}`);
                  if (Math.abs(c.face.h - select.h) >= 1) wrong.add(`Issue #1388: the formula chip is ${c.face.h}px tall, the select chip ${select.h}px`);
                }
              }
              for (const line of lines(r.cells)) {
                const counters = line.flatMap((c) => c.counters);
                if (counters.length > 1) wrong.add(`Issue #1373: one chip line shows ${counters.length} counters`);
              }
            }
            assert.ok(sized > 0, 'the formula value shows on some row');
            assert.deepEqual([...wrong], []);
          } finally { await page.close(); }
        });
      }
    }
  }
}
