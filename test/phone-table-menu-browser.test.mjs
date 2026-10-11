import test from 'node:test';
import assert from 'node:assert/strict';
import { engineOf, launch, settled, phoneProfile } from './lib/browser.mjs';

const IPHONE = phoneProfile()?.page ?? null;

const SHEET = ['.table-view-btn', '.table-density-btn', '.eye-btn', '.table-filter-btn', '.table-sort-btn'];
const FOLDED = ['.table-search', '.dots-btn'];
const rgb = (c) => {
  const n = String(c).match(/[\d.]+/g).map(Number);
  return (c.startsWith('color(') ? n.slice(0, 3).map((v) => Math.round(v * 255)) : n.slice(0, 3)).join(',');
};
const DESKTOP = ['.table-search', '.table-view-btn', '.table-density-btn', '.eye-btn', '.table-filter-btn', '.dots-btn'];

const s = await launch('phone table menu', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.addField(issues, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'In Progress', category: 'in-progress' },
    { name: 'Fixed', category: 'done' }] } });
  weave.addField(issues, { name: 'Severity', type: 'select', config: { options: ['Low', 'High'] } });
  for (let i = 0; i < 6; i++) weave.createEntity(issues, { name: `Issue ${i}`, values: { Status: i % 2 ? 'Open' : 'Fixed', Severity: i % 3 ? 'High' : 'Low' } });
  weave.updateTable(issues, { filters: { Status: ['Open'] } });
  return { table: `#/table/${issues.id}`, id: issues.id };
});

if (s) {
  const { base, browser, table, id } = s;
  const engines = [['chromium 390x844', browser, { viewport: { width: 390, height: 844 } }]];
  const webkit = await engineOf('webkit');
  if (webkit && IPHONE) engines.push(['webkit iPhone 15', webkit, IPHONE]);
  const open = async (b, { profile = { viewport: { width: 1280, height: 844 } }, theme = 'light' } = {}) => {
    const page = await b.newPage(profile);
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${table}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main .table-filter-btn', { state: 'attached' });
    return page;
  };
  const read = (page, controls) => page.evaluate((controls) => {
    const head = document.querySelector('#main > .view-header');
    const box = (n) => { if (!n) return null; const r = n.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: Math.round(r.width), height: Math.round(r.height) }; };
    const tools = head.querySelector('.table-tools-btn');
    const shown = (n) => !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
    const sheet = head.querySelector('.crumb-actions');
    const group = sheet.querySelector('.tools-group');
    return {
      theme: document.documentElement.dataset.bsTheme,
      tools: shown(tools) ? box(tools) : null,
      badge: tools?.querySelector('.table-tools-count')?.textContent ?? null,
      badgeShown: shown(tools?.querySelector('.table-tools-count')),
      controls: Object.fromEntries(controls.map((q) => { const n = head.querySelector(`.crumb-actions ${q}`); return [q, shown(n) ? box(n) : null]; })),
      marked: head.querySelector('.crumb-actions .table-filter-btn')?.dataset.mark ?? null,
      sheet: shown(sheet) ? box(sheet) : null,
      group: shown(group) ? {
        head: group.querySelector('.tools-group-head')?.textContent,
        rows: [...group.querySelectorAll('.tools-row')].map((r) => ({ text: r.textContent.trim(), h: Math.round(r.getBoundingClientRect().height), color: getComputedStyle(r).color, inside: box(r).bottom <= box(sheet).bottom + 0.5 && box(r).top >= box(sheet).top - 0.5 })),
      } : null,
      danger: (() => { const probe = document.createElement('span'); probe.style.color = 'var(--tblr-danger)'; sheet.append(probe); const c = getComputedStyle(probe).color; probe.remove(); return c; })(),
      menus: [...document.querySelectorAll('.dl-menu:not(.hidden)')].filter(shown).length,
      sortValue: head.querySelector('.crumb-actions .table-sort-value')?.textContent ?? null,
      scrollWidth: document.documentElement.scrollWidth,
      vw: document.documentElement.clientWidth,
    };
  }, controls);

  for (const [engine, b, profile] of engines) {
    for (const theme of ['light', 'dark']) {
      test(`on a phone one sliders button with a filter count holds the table toolbar (${engine}, ${theme}, Feature #271)`, async () => {
        const page = await open(b, { profile, theme });
        try {
          await page.$eval('#main .table-filter-btn', (n) => { n.dataset.mark = 'same'; });
          let seen = await read(page, [...SHEET, ...FOLDED]);
          assert.equal(seen.theme, theme);
          assert.ok(seen.tools, 'the sliders button shows');
          assert.deepEqual([seen.tools.width, seen.tools.height], [44, 44], 'as a 44px circle');
          assert.ok(seen.badgeShown && seen.badge === '1', `its badge counts the one active filter (${seen.badge})`);
          for (const q of [...SHEET, ...FOLDED]) assert.equal(seen.controls[q], null, `${q} is folded away`);
          assert.ok(seen.scrollWidth <= seen.vw);
          await page.click('#main .table-tools-btn');
          await settled(page.locator('#main .crumb-actions'));
          seen = await read(page, [...SHEET, ...FOLDED]);
          assert.ok(seen.sheet, 'the sliders button opens the sheet');
          assert.ok(seen.sheet.left >= 0 && seen.sheet.right <= seen.vw, 'which fits the screen');
          for (const q of SHEET) {
            assert.ok(seen.controls[q], `${q} shows in the sheet`);
            assert.ok(seen.controls[q].height >= 44, `${q} is a ${seen.controls[q].height}px target`);
          }
          assert.equal(seen.marked, 'same', 'the sheet holds the toolbar\'s own filter button, not a copy');
          await page.click('#main .crumb-actions .table-filter-btn');
          await page.waitForSelector('.table-filter-popover');
          await page.keyboard.press('Escape');
          await page.waitForSelector('.table-filter-popover', { state: 'detached' });
          await page.keyboard.press('Escape');
          assert.equal((await read(page, SHEET)).sheet, null, 'Esc shuts the sheet');
          await page.click('#main .table-tools-btn');
          await page.mouse.click(Math.round(seen.vw / 2), Math.round(seen.sheet.bottom) + 40);
          assert.equal((await read(page, SHEET)).sheet, null, 'a tap outside shuts it');
        } finally { await page.close(); }
      });

      test(`on a phone the table sheet lists the table actions as its own rows, with no kebab, no second search and a Sort control (${engine}, ${theme}, Issue #723)`, async () => {
        const page = await open(b, { profile, theme });
        try {
          await page.click('#main .table-tools-btn');
          await settled(page.locator('#main .crumb-actions'));
          const seen = await read(page, [...SHEET, ...FOLDED]);
          for (const q of FOLDED) assert.equal(seen.controls[q], null, `${q} is not in the sheet`);
          assert.equal(seen.sortValue, 'None', 'the Sort row says the table is unsorted');
          assert.ok(seen.group, 'a Table group shows in the sheet');
          assert.equal(seen.group.head, 'Table');
          assert.deepEqual(seen.group.rows.map((r) => r.text), ['Column stats…', 'Export CSV', 'Share…', 'New share page…', 'Row term (row)…', 'Delete table'], 'every table action is a row, Delete table last');
          for (const r of seen.group.rows) {
            assert.ok(r.h >= 44, `${r.text} is a ${r.h}px row`);
            assert.ok(r.inside, `${r.text} sits inside the sheet`);
          }
          const del = seen.group.rows.at(-1).color;
          assert.equal(rgb(del), rgb(seen.danger), 'Delete table is red');
          assert.notEqual(rgb(seen.group.rows[0].color), rgb(del), 'and the others are not');
          assert.equal(seen.menus, 0, 'no second menu opens outside the sheet');
          await page.click('#main .crumb-actions .table-sort-btn');
          await page.waitForSelector('.table-sort-popover .table-sort-field');
          await page.click('.table-sort-popover .table-sort-field:has-text("Severity")');
          await page.waitForFunction(() => document.querySelector('#main .table-sort-value')?.textContent.startsWith('Severity'), null, { timeout: 10000 });
          const saved = await page.evaluate(async (id) => (await (await fetch('/api/schema')).json()).flatMap((sp) => sp.tables).find((t) => t.id === id).sort, id);
          assert.deepEqual(saved, [{ field: 'Severity', dir: 'asc' }], 'the pick sorts the table');
        } finally {
          await page.evaluate((id) => fetch(`/api/tables/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sort: [] }) }), id).catch(() => {});
          await page.close();
        }
      });
    }
  }

  for (const [engine, b, profile] of engines) {
    for (const theme of ['light', 'dark']) {
      test(`on a phone the sliders icon sits centred and the sheet opens 8px below the button with matching right edges (${engine}, ${theme}, Issue #727)`, async () => {
        const page = await open(b, { profile, theme });
        try {
          await page.click('#main .table-tools-btn');
          await settled(page.locator('#main .crumb-actions'));
          const m = await page.evaluate(() => {
            const btn = document.querySelector('#main .table-tools-btn');
            const b = btn.getBoundingClientRect();
            const i = btn.querySelector('svg').getBoundingClientRect();
            const s = document.querySelector('#main .crumb-row.tools-open > .crumb-actions').getBoundingClientRect();
            return { dx: (i.left + i.right) / 2 - (b.left + b.right) / 2, dy: (i.top + i.bottom) / 2 - (b.top + b.bottom) / 2, gap: s.top - b.bottom, right: s.right - b.right, theme: document.documentElement.dataset.bsTheme };
          });
          assert.equal(m.theme, theme);
          assert.ok(Math.abs(m.dx) <= 0.5 && Math.abs(m.dy) <= 0.5, `the icon centre sits on the button centre (${m.dx}, ${m.dy})`);
          assert.ok(Math.abs(m.gap - 8) <= 0.5, `the sheet opens 8px below the button (${m.gap})`);
          assert.ok(Math.abs(m.right) <= 0.5, `the sheet and the button share a right edge (${m.right})`);
        } finally { await page.close(); }
      });
    }
  }

  test('on a desktop the toolbar stays inline, keeps its search and kebab, and has no sliders button or Sort row (Feature #271, Issue #723)', async () => {
    const page = await open(browser);
    try {
      const seen = await read(page, [...DESKTOP, '.table-sort-btn']);
      assert.equal(seen.tools, null);
      for (const q of DESKTOP) assert.ok(seen.controls[q] && seen.controls[q].height < 40, `${q} shows inline at its desktop size`);
      assert.equal(seen.controls['.table-sort-btn'], null, 'the Sort row is a phone control');
      assert.equal(seen.group, null, 'the table actions stay in the kebab menu');
    } finally { await page.close(); }
  });
}
