import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, settled } from './lib/browser.mjs';

const CONTROLS = ['.table-search', '.table-view-btn', '.table-density-btn', '.eye-btn', '.table-filter-btn', '.dots-btn'];

const s = await launch('phone table menu', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.addField(issues, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'In Progress', category: 'in-progress' },
    { name: 'Fixed', category: 'done' }] } });
  weave.addField(issues, { name: 'Severity', type: 'select', config: { options: ['Low', 'High'] } });
  for (let i = 0; i < 6; i++) weave.createEntity(issues, { name: `Issue ${i}`, values: { Status: i % 2 ? 'Open' : 'Fixed', Severity: 'High' } });
  weave.updateTable(issues, { filters: { Status: ['Open'] } });
  return { table: `#/table/${issues.id}` };
});

if (s) {
  const { base, browser, table } = s;
  const open = async ({ width = 390, theme = 'light' } = {}) => {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
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
    return {
      theme: document.documentElement.dataset.bsTheme,
      tools: shown(tools) ? box(tools) : null,
      badge: tools?.querySelector('.table-tools-count')?.textContent ?? null,
      badgeShown: shown(tools?.querySelector('.table-tools-count')),
      controls: Object.fromEntries(controls.map((q) => { const n = head.querySelector(`.crumb-actions ${q}`); return [q, shown(n) ? box(n) : null]; })),
      marked: head.querySelector('.crumb-actions .table-filter-btn')?.dataset.mark ?? null,
      sheet: shown(head.querySelector('.crumb-actions')) ? box(head.querySelector('.crumb-actions')) : null,
      scrollWidth: document.documentElement.scrollWidth,
    };
  }, controls);

  for (const theme of ['light', 'dark']) {
    test(`on a phone one sliders button with a filter count holds the table toolbar (${theme}, Feature #271)`, async () => {
      const page = await open({ theme });
      try {
        await page.$eval('#main .table-filter-btn', (b) => { b.dataset.mark = 'same'; });
        let seen = await read(page, CONTROLS);
        assert.equal(seen.theme, theme);
        assert.ok(seen.tools, 'the sliders button shows');
        assert.deepEqual([seen.tools.width, seen.tools.height], [44, 44], 'as a 44px circle');
        assert.ok(seen.badgeShown && seen.badge === '1', `its badge counts the one active filter (${seen.badge})`);
        for (const q of CONTROLS) assert.equal(seen.controls[q], null, `${q} is folded away`);
        assert.ok(seen.scrollWidth <= 390);
        await page.click('#main .table-tools-btn');
        await settled(page.locator('#main .crumb-actions'));
        seen = await read(page, CONTROLS);
        assert.ok(seen.sheet, 'the sliders button opens the sheet');
        assert.ok(seen.sheet.left >= 0 && seen.sheet.right <= 390, 'which fits the screen');
        for (const q of CONTROLS) {
          assert.ok(seen.controls[q], `${q} shows in the sheet`);
          assert.ok(seen.controls[q].height >= 44, `${q} is a ${seen.controls[q].height}px target`);
        }
        assert.equal(seen.marked, 'same', 'the sheet holds the toolbar\'s own filter button, not a copy');
        await page.click('#main .crumb-actions .table-filter-btn');
        await page.waitForSelector('.table-filter-popover');
        await page.keyboard.press('Escape');
        await page.waitForSelector('.table-filter-popover', { state: 'detached' });
        await page.keyboard.press('Escape');
        assert.equal((await read(page, CONTROLS)).sheet, null, 'Esc shuts the sheet');
        await page.click('#main .table-tools-btn');
        await page.mouse.click(195, 800);
        assert.equal((await read(page, CONTROLS)).sheet, null, 'a tap outside shuts it');
      } finally { await page.close(); }
    });
  }

  test('on a desktop the toolbar stays inline and there is no sliders button (Feature #271)', async () => {
    const page = await open({ width: 1280 });
    try {
      const seen = await read(page, CONTROLS);
      assert.equal(seen.tools, null);
      for (const q of CONTROLS) assert.ok(seen.controls[q] && seen.controls[q].height < 40, `${q} shows inline at its desktop size`);
    } finally { await page.close(); }
  });
}
