import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const s = await launch('phone full-screen menu', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.createTable({ space: 'Development', name: 'Feature' });
  weave.createEntity(issues, { name: 'First issue' });
  weave.createSpace({ name: 'Handbook' });
  weave.createTable({ space: 'Handbook', name: 'Guide' });
  return { hash: `#/table/${issues.id}` };
});

if (s) {
  const { base, browser, hash } = s;
  const open = async ({ width = 390, theme = 'light' } = {}) => {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main .nav-menu', { state: 'attached' });
    return page;
  };
  const menu = (page) => page.evaluate(() => {
    const rect = (q) => { const n = document.querySelector(q); const r = n.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    return {
      theme: document.documentElement.dataset.bsTheme,
      open: document.querySelector('#app').classList.contains('nav-peek'),
      sidebar: rect('#sidebar'),
      rail: rect('#ws-rail'),
      railRow: getComputedStyle(document.querySelector('#ws-rail')).flexDirection,
      close: rect('#nav-collapse'),
      stats: rect('#sidebar .nav-stats'),
      health: rect('#sidebar .nav-health'),
      rows: [...document.querySelectorAll('#sidebar a.nav-db')].map((a) => Math.round(a.getBoundingClientRect().height)),
      scrollWidth: document.documentElement.scrollWidth,
    };
  });

  for (const theme of ['light', 'dark']) {
    test(`on a phone the menu covers the whole screen with 44px rows, a close button top right and the stats at the foot (${theme}, Feature #269)`, async () => {
      const page = await open({ theme });
      try {
        await page.click('#main .nav-menu');
        await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
        const m = await menu(page);
        assert.equal(m.theme, theme);
        assert.ok(m.open, 'the menu button opens the menu');
        assert.deepEqual([m.sidebar.left, m.sidebar.top, m.sidebar.width], [0, 0, 390], 'the menu spans the screen from the top-left corner');
        assert.equal(m.rail.bottom, 844, 'the workspace bar sits on the bottom edge');
        assert.equal(m.rail.width, 390, 'and runs the full width');
        assert.equal(m.railRow, 'row', 'its workspaces, theme and help lie in a row');
        assert.ok(m.sidebar.bottom <= m.rail.top + 1, `the menu ends above the bar (${m.sidebar.bottom} vs ${m.rail.top})`);
        assert.ok(m.close.width >= 44 && m.close.height >= 44, `the close button is ${m.close.width}x${m.close.height}`);
        assert.ok(m.close.right >= 390 - 24 && m.close.top <= 24, `the close button sits top right (${m.close.right}, ${m.close.top})`);
        assert.ok(m.rows.length >= 3 && m.rows.every((h) => h >= 44), `every table row is 44px: ${m.rows}`);
        assert.ok(m.stats.bottom <= m.rail.top + 1 && m.stats.bottom >= m.rail.top - 4, `the records, size and version sit at the foot of the menu (${m.stats.bottom} vs ${m.rail.top})`);
        assert.ok(m.health.height > 0, 'the version chip shows');
        assert.ok(m.scrollWidth <= 390, `the open menu does not widen the page (${m.scrollWidth})`);
        await page.click('#nav-collapse');
        assert.equal((await menu(page)).open, false, 'the close button shuts it');
      } finally { await page.close(); }
    });
  }

  test('on a desktop the sidebar and rail keep their place and size (Feature #269)', async () => {
    const page = await open({ width: 1280 });
    try {
      const m = await menu(page);
      assert.equal(m.sidebar.width, 264);
      assert.equal(m.sidebar.left, m.rail.right, 'the sidebar sits beside the rail');
      assert.equal(m.rail.width, 52);
      assert.equal(m.railRow, 'column');
      assert.ok(m.rows.every((h) => h < 40), `table rows keep their desktop height: ${m.rows}`);
      assert.ok(m.close.width < 40, `the collapse button keeps its desktop size (${m.close.width})`);
    } finally { await page.close(); }
  });
}
