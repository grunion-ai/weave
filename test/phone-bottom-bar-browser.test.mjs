import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually, phoneBrowser, phonePage } from './lib/browser.mjs';

const s = await launch('phone bottom bar', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  for (let i = 0; i < 40; i++) weave.createEntity(issues, { name: `Issue ${i} with a name long enough to wrap on a phone` });
  const row = weave.createEntity(issues, { name: 'Docked one' });
  return { tableId: issues.id, table: `#/table/${issues.id}`, docked: `#/table/${issues.id}?e=${row.id}` };
});

if (s) {
  const { base, browser, tableId, table, docked } = s;
  const open = async (hash, { width, theme = 'light' } = {}) => {
    const page = width ? await browser.newPage({ viewport: { width, height: 844 } }) : await phonePage(await phoneBrowser());
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.bug-fab', { state: 'attached' });
    return page;
  };
  const bar = (page) => page.evaluate(() => {
    const rect = (n) => { if (!n) return null; const r = n.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const fab = document.querySelector('.bug-fab');
    const inset = parseFloat(getComputedStyle(fab).borderTopWidth) || 0;
    const shown = (n) => !!n && getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().height > 0;
    return {
      theme: document.documentElement.dataset.bsTheme,
      bar: shown(document.querySelector('.phone-bar')),
      search: rect(document.querySelector('.phone-bar .phone-search')),
      searchFill: getComputedStyle(document.querySelector('.phone-bar .phone-search') ?? document.body).backgroundColor,
      newShown: shown(document.querySelector('.phone-bar .phone-new')),
      newBtn: rect(document.querySelector('.phone-bar .phone-new')),
      fab: rect(fab), fabInset: inset,
      vw: innerWidth, vh: innerHeight,
    };
  });
  const rowCount = (page) => page.evaluate(async (id) => (await (await fetch(`/api/tables/${id}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()).items.length, tableId);

  for (const theme of ['light', 'dark']) {
    test(`on a phone a glass search capsule and a blue New circle float at the bottom of a table (${theme}, Feature #268)`, async () => {
      const page = await open(table, { theme });
      try {
        const b = await bar(page);
        assert.equal(b.theme, theme);
        assert.ok(b.bar, 'the bar shows');
        assert.ok(b.search.height >= 44, `the search capsule is ${b.search.height}px tall`);
        assert.ok(b.vh - b.search.bottom >= 8 && b.vh - b.search.bottom <= 40, `it floats near the bottom edge (${b.vh - b.search.bottom}px up)`);
        assert.ok(b.newShown, 'a table page shows the New button');
        assert.ok(b.newBtn.width >= 44 && Math.abs(b.newBtn.width - b.newBtn.height) < 1, `New is a ${b.newBtn.width}px circle`);
        assert.ok(b.newBtn.left >= b.search.right, 'New sits right of the capsule');
        assert.ok(b.fab.width >= 44 && b.fab.height >= 44, 'the bug button keeps its 44px target');
        assert.ok(b.fab.bottom - b.fabInset <= b.search.top, `the bug button sits above the bar (${b.fab.bottom - b.fabInset} vs ${b.search.top})`);
        assert.ok(b.vw - b.fab.right <= 3.5, 'and hugs the right edge');
        await page.evaluate(() => { const m = document.querySelector('#main'); m.scrollTop = m.scrollHeight; });
        await page.waitForTimeout(150);
        const last = await page.$eval('#main', (m) => {
          const rows = [...m.querySelectorAll('tbody tr.entity-row')];
          return rows.at(-1).getBoundingClientRect().bottom;
        });
        assert.ok(last <= b.search.top, `the last row ends at ${last}px, above the bar at ${b.search.top}px`);
      } finally { await page.close(); }
    });

    test(`on a phone the search capsule opens the command palette (${theme}, Feature #268)`, async () => {
      const page = await open(table, { theme });
      try {
        await page.click('.phone-bar .phone-search');
        await page.waitForSelector('#cmdk-back #cmdk-input');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#cmdk-back', { state: 'detached' });
      } finally { await page.close(); }
    });
  }

  test('on a phone New opens the new-row sheet and adds nothing until Create (Feature #268, Issue #739)', async () => {
    const page = await open(table);
    try {
      const before = await rowCount(page);
      await page.click('.phone-bar .phone-new');
      await page.waitForSelector('.new-row-sheet');
      await page.waitForTimeout(300);
      assert.equal(await rowCount(page), before, 'the tap writes no row');
    } finally { await page.close(); }
  });

  test('on a phone the bar has no New button off a table and hides under a row page (Feature #268)', async () => {
    const page = await open('');
    try {
      const b = await bar(page);
      assert.ok(b.bar, 'the home page shows the bar');
      assert.equal(b.newShown, false, 'without a New button');
    } finally { await page.close(); }
    const row = await open(docked);
    try {
      await row.waitForSelector('#dock:not([hidden]) textarea.name-edit');
      assert.equal((await bar(row)).bar, false, 'a row page covers the bar');
    } finally { await row.close(); }
  });

  test('on a desktop there is no bottom bar and the bug button keeps its corner (Feature #268)', async () => {
    const page = await open(table, { width: 1280 });
    try {
      const b = await bar(page);
      assert.equal(b.bar, false);
      assert.equal(Math.round(b.fab.width), 26);
      assert.equal(Math.round(b.vh - b.fab.bottom), 40);
    } finally { await page.close(); }
  });
}
