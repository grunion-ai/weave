import test from 'node:test';
import assert from 'node:assert/strict';
import { atRest, launch, painted, phoneProfile } from './lib/browser.mjs';

const IPHONE = phoneProfile()?.page ?? null;
const DENSITIES = ['compact', 'comfortable', 'spacious'];
const HEIGHT = { compact: 68, comfortable: 88, spacious: 118 };
const NAME_LINES = { compact: 1, comfortable: 2, spacious: 2 };
const WRAP_NAME_LINES = { compact: 1, comfortable: 1, spacious: 2 };
const CHIP_LINES = { compact: 1, comfortable: 1, spacious: 2 };
const LONG = 'Phone rows at Spacious give a long record name two whole lines before the value chips start';

const s = await launch('phone row density line budget', (weave) => {
  weave.createSpace({ name: 'Development' });
  const ids = {};
  for (const wrap of [false, true]) for (const density of DENSITIES) {
    const name = `${wrap ? 'Wrapped' : 'Plain'} ${density}`;
    const issues = weave.createTable({ space: 'Development', name });
    weave.addField(issues, { name: 'Status', type: 'workflow', config: { states: [
      { name: 'Open', category: 'not-started', default: true },
      { name: 'Fixed', category: 'done' }] } });
    weave.addField(issues, { name: 'Severity', type: 'select', config: { options: ['Low', 'Medium', 'High'] } });
    weave.addField(issues, { name: 'Symptom', type: 'multiselect', config: { options: ['Looks broken', 'Slow', 'Wrong data'] } });
    weave.addField(issues, { name: 'Area', type: 'select', config: { options: ['Grid', 'Document editor', 'Phone shell'] } });
    weave.addField(issues, { name: 'Platform', type: 'select', config: { options: ['iOS Safari', 'Android Chrome'] } });
    weave.addField(issues, { name: 'Release', type: 'text' });
    weave.addField(issues, { name: 'Owner', type: 'text' });
    for (let i = 0; i < 10; i++) {
      weave.createEntity(issues, {
        name: i % 2 ? `Issue ${i}` : `${LONG} (${i})`,
        values: {
          Status: 'Open', Severity: 'Medium', Symptom: ['Looks broken', 'Wrong data'], Area: i % 3 ? 'Document editor' : 'Grid',
          Platform: 'iOS Safari', Release: 'v0.4.82 and later', Owner: i % 2 ? 'Kyle' : 'The phone shell team',
        },
      });
    }
    weave.tableView(`Development/${name}/Standard`, {
      density,
      fields: ['Name', 'Status', 'Severity', 'Symptom', 'Area', 'Platform', 'Release', 'Owner'],
      ...(wrap ? { phoneRow: { lead: 'Status', chips: ['Severity', 'Symptom', 'Area', 'Platform', 'Release', 'Owner'], wrap: true } } : {}),
    });
    ids[`${wrap ? 'wrap' : 'plain'}:${density}`] = issues.id;
  }
  return { ids };
}, { engine: 'webkit' });

const measure = (page) => page.evaluate(() => {
  const grid = document.querySelector('#main .wv-grid');
  return {
    theme: document.documentElement.dataset.bsTheme,
    density: grid.dataset.density,
    token: parseFloat(getComputedStyle(grid).getPropertyValue('--wv-row-h')),
    declared: PHONE_ROW_H[grid.dataset.density],
    rows: [...grid.querySelectorAll('tbody tr.entity-row')].map((tr) => {
      const r = tr.getBoundingClientRect();
      const cs = getComputedStyle(tr);
      const box = { top: r.top, bottom: r.bottom - parseFloat(cs.borderBottomWidth), left: r.left, right: r.right - parseFloat(cs.paddingRight) };
      const inside = (b) => b.top >= box.top - 0.5 && b.bottom <= box.bottom + 0.5 && b.left >= box.left - 0.5 && b.right <= box.right + 0.5;
      const nameEl = tr.querySelector('.list-name');
      const name = nameEl.getBoundingClientRect();
      const chips = [...tr.querySelectorAll(':scope > td[data-field]')].filter((td) => td.getClientRects().length).map((td) => {
        const b = td.getBoundingClientRect();
        return { top: Math.round(b.top - r.top), inside: inside(b), more: td.dataset.more ?? null, field: td.dataset.field };
      });
      return {
        h: r.height,
        long: nameEl.textContent.length > 40,
        nameLines: Math.round(name.height / parseFloat(getComputedStyle(nameEl).lineHeight)),
        nameInside: inside(name),
        nameBottom: name.bottom - r.top,
        chips,
      };
    }),
  };
});

if (s) {
  const { base, browser, ids } = s;
  const profile = { ...(IPHONE ?? {}), viewport: { width: 390, height: 844 } };
  const open = async (id, theme, density) => {
    const page = await browser.newPage(profile);
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/#/table/${id}`, { waitUntil: 'networkidle' });
    await painted(page, `#main .wv-grid[data-density="${density}"] tbody tr.entity-row > td[data-more]`);
    await page.evaluate(() => document.fonts.ready);
    await atRest(page.locator('#main .wv-grid tbody tr.entity-row').first());
    return page;
  };

  for (const theme of ['light', 'dark']) {
    for (const wrap of [false, true]) {
      const kind = wrap ? 'phone-wrap' : 'one chip line';
      test(`on a phone each density holds its name and whole chips inside a declared row, and Spacious shows more than Comfortable (webkit 390x844, ${theme}, ${kind}, Feature #354)`, async () => {
        const seen = {};
        for (const density of DENSITIES) {
          const page = await open(ids[`${wrap ? 'wrap' : 'plain'}:${density}`], theme, density);
          try { seen[density] = await measure(page); } finally { await page.close(); }
        }
        for (const density of DENSITIES) {
          const v = seen[density];
          assert.equal(v.theme, theme);
          assert.equal(v.token, HEIGHT[density], `${density} declares a ${HEIGHT[density]}px row`);
          assert.equal(v.declared, v.token, `${density} windows on the same pitch it paints`);
          let counted = 0;
          let twoLines = 0;
          for (const [i, r] of v.rows.entries()) {
            assert.ok(Math.abs(r.h - v.token) < 0.5, `${density} row ${i} is ${r.h}px, not its ${v.token}px token`);
            assert.ok(r.nameInside, `${density} row ${i}'s name sits inside the row`);
            if (r.long) {
              const want = (wrap ? WRAP_NAME_LINES : NAME_LINES)[density];
              assert.equal(r.nameLines, want, `${density} row ${i}'s long name shows ${want} line(s)`);
            }
            assert.ok(r.chips.length >= 1, `${density} row ${i} shows chips`);
            const tops = [...new Set(r.chips.map((c) => c.top))].sort((a, b) => a - b);
            for (const c of r.chips) {
              assert.ok(c.inside, `${density} row ${i}'s ${c.field} chip sits inside the row`);
              assert.ok(c.top >= r.nameBottom - 0.5, `${density} row ${i}'s chips sit under its name`);
            }
            if (!wrap) assert.ok(tops.length <= CHIP_LINES[density], `${density} row ${i} keeps ${CHIP_LINES[density]} chip line(s): ${tops}`);
            if (tops.length > 1) twoLines++;
            const more = r.chips.filter((c) => c.more);
            assert.ok(more.length <= 1, `${density} row ${i} shows one +N at most`);
            if (more.length) {
              counted++;
              assert.match(more[0].more, /^\+\d+$/);
              assert.equal(more[0].top, tops.at(-1), `${density} row ${i}'s +N sits on its last chip line`);
              assert.equal(more[0], r.chips.at(-1), `${density} row ${i}'s +N follows its last whole chip`);
            }
          }
          assert.ok(counted > 0, `${density} counts the chips it has no room for`);
          if (density === 'spacious') assert.ok(twoLines > 0, 'spacious wraps chips onto a second line');
        }
        assert.ok(seen.spacious.token > seen.comfortable.token, 'the Spacious row is taller than the Comfortable one');
        const comfy = seen.comfortable.rows.map((r) => r.chips.length);
        for (const [i, n] of seen.spacious.rows.map((r) => r.chips.length).entries()) {
          assert.ok(n >= comfy[i], `spacious row ${i} shows ${n} chips, comfortable shows ${comfy[i]}`);
        }
      });
    }
  }
}
