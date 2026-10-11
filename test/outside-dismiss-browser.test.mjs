import test from 'node:test';
import assert from 'node:assert/strict';
import { engineOf, launch, phoneProfile } from './lib/browser.mjs';

const IPHONE = phoneProfile()?.page ?? null;

const AREAS = Array.from({ length: 12 }, (_, i) => `Area ${i + 1}`);

const s = await launch('outside taps dismiss overlays', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.addField(issues, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'In Progress', category: 'in-progress' },
    { name: 'Fixed', category: 'done' }] } });
  weave.addField(issues, { name: 'Area', type: 'select', config: { options: AREAS } });
  const row = weave.createEntity(issues, { name: 'Looks broken', values: { Status: 'Open', Area: 'Area 1' } });
  for (let i = 0; i < 5; i++) weave.createEntity(issues, { name: `Issue ${i}`, values: { Status: 'Open' } });
  return { table: `#/table/${issues.id}`, docked: `#/table/${issues.id}?e=${row.id}` };
});

const touchAway = (page) => page.evaluate(() => {
  const busy = 'a, button, input, textarea, select, label, [contenteditable], [role="button"], .vditor, tr.entity-row, .chip-pop, .picker-pop, #bug-panel, .crumb-actions, .dl-menu, .phone-bar, .bug-fab';
  window.awayClicks = 0;
  addEventListener('click', () => { window.awayClicks++; }, true);
  for (let y = 8; y < innerHeight - 20; y += 8) {
    for (let x = 8; x < innerWidth - 8; x += 12) {
      const t = document.elementFromPoint(x, y);
      if (!t || t === document.documentElement || t.closest(busy)) continue;
      for (const type of ['pointerdown', 'pointerup']) {
        t.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerType: 'touch', isPrimary: true, pointerId: 41, button: 0, buttons: type === 'pointerdown' ? 1 : 0, clientX: x, clientY: y }));
      }
      return { at: `${t.tagName.toLowerCase()}.${t.className}` };
    }
  }
  return null;
});

const shown = (page, selector) => page.evaluate((q) => [...document.querySelectorAll(q)].some((n) => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden'), selector);

if (s) {
  const { base, browser, table, docked } = s;
  const engines = [['chromium 390x844', browser, { viewport: { width: 390, height: 844 } }]];
  const webkit = await engineOf('webkit');
  if (webkit && IPHONE) engines.push(['webkit iPhone 15', webkit, IPHONE]);
  const open = async (b, profile, theme, at) => {
    const page = await b.newPage(profile);
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${at}`, { waitUntil: 'networkidle' });
    return page;
  };
  const OVERLAYS = [
    { name: 'the table sheet', at: () => table, show: '#main .crumb-row.tools-open > .crumb-actions', open: async (p) => { await p.click('#main .table-tools-btn'); } },
    { name: 'the filter popover', at: () => table, show: '.table-filter-popover', open: async (p) => { await p.click('#main .table-tools-btn'); await p.click('#main .crumb-actions .table-filter-btn'); } },
    { name: 'the view popover', at: () => table, show: '.table-view-popover', open: async (p) => { await p.click('#main .table-tools-btn'); await p.click('#main .crumb-actions .table-view-btn'); } },
    { name: 'the bug panel', at: () => table, show: '#bug-panel', open: async (p) => { await p.click('.bug-fab'); } },
    { name: 'the row menu', at: () => docked, show: '#dock .dl-menu:not(.hidden)', open: async (p) => { await p.click('#dock .dots-btn'); } },
    { name: 'the picker sheet', at: () => docked, show: '.picker-pop', open: async (p) => { await p.click('#dock .chip-trigger[title="Area"]'); } },
  ];

  for (const [engine, b, profile] of engines) {
    for (const theme of ['light', 'dark']) {
      test(`on a phone a touch outside an open overlay closes it with no click event (${engine}, ${theme}, Issue #726)`, async () => {
        for (const o of OVERLAYS) {
          const page = await open(b, profile, theme, o.at());
          try {
            assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
            await o.open(page);
            await page.waitForSelector(o.show);
            assert.ok(await shown(page, o.show), `${o.name} opens`);
            const tap = await touchAway(page);
            assert.ok(tap, `${o.name}: there is empty space to touch`);
            await page.waitForFunction((q) => ![...document.querySelectorAll(q)].some((n) => n.getClientRects().length), o.show, { timeout: 3000 }).catch(() => {});
            assert.equal(await shown(page, o.show), false, `a touch on ${tap.at} closes ${o.name}`);
            assert.equal(await page.evaluate(() => window.awayClicks), 0, 'and no click event was involved');
          } finally { await page.close(); }
        }
      });
    }
  }

  test('on a desktop a click away still closes a popover and a second click on its button toggles it shut (Issue #726)', async () => {
    const page = await open(browser, { viewport: { width: 1280, height: 844 } }, 'light', table);
    try {
      await page.click('#main .table-filter-btn');
      await page.waitForSelector('.table-filter-popover');
      await page.mouse.click(640, 800);
      await page.waitForSelector('.table-filter-popover', { state: 'detached' });
      await page.click('#main .table-filter-btn');
      await page.waitForSelector('.table-filter-popover');
      await page.click('#main .table-filter-btn');
      await page.waitForTimeout(150);
      assert.equal(await page.locator('.table-filter-popover').count(), 0, 'the button shuts its own popover');
      await page.click('#main .crumb-actions .dots-btn');
      assert.ok(await shown(page, '#main .dl-menu:not(.hidden)'), 'the table menu opens');
      await page.click('#main .crumb-actions .dots-btn');
      assert.equal(await shown(page, '#main .dl-menu:not(.hidden)'), false, 'and its button shuts it');
      await page.click('#main .crumb-actions .dots-btn');
      await page.mouse.click(640, 800);
      assert.equal(await shown(page, '#main .dl-menu:not(.hidden)'), false, 'a click away shuts it');
    } finally { await page.close(); }
  });
}
