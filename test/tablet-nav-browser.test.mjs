import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let table;
const s = await launch('tablet nav', (weave) => {
  weave.createSpace({ name: 'Development' });
  table = weave.createTable({ space: 'Development', name: 'Issue' });
  for (let i = 0; i < 6; i++) weave.createEntity(table, { name: `Issue ${i + 1}` });
});

if (s) {
  const { base, browser } = s;

  const read = (page) => page.evaluate(() => {
    const seen = (n) => !!n && n.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && n.getBoundingClientRect().width > 0;
    return {
      rail: seen(document.querySelector('#ws-rail')),
      sidebar: seen(document.querySelector('#sidebar')),
      menus: [...document.querySelectorAll('.nav-menu')].filter(seen).length,
    };
  });

  const open = async (width, theme) => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${base}/#/table/${table.id}`, { waitUntil: 'load' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    return page;
  };

  for (const theme of ['light', 'dark']) {
    for (const width of [601, 768, 900]) {
      test(`at ${width}px the menu button stands in for the rail and sidebar, never beside them (${theme}, Issue #1457)`, async () => {
        const page = await open(width, theme);
        try {
          const m = await read(page);
          assert.equal(m.sidebar, false, `${width}px hides the sidebar`);
          assert.equal(m.rail, false, `${width}px hides the workspace rail, so the menu button is the only way into navigation`);
          assert.equal(m.menus, 1, `${width}px offers exactly one menu button`);
        } finally { await page.close(); }
      });
    }

    test(`at 1280px the rail and the sidebar carry navigation on their own (${theme}, Issue #1457)`, async () => {
      const page = await open(1280, theme);
      try {
        const m = await read(page);
        assert.equal(m.rail, true, 'the rail is on screen');
        assert.equal(m.sidebar, true, 'the sidebar is on screen');
        assert.equal(m.menus, 0, 'and no menu button competes with them');
      } finally { await page.close(); }
    });
  }

  test('the peek drawer carries the rail at 768px (Issue #1457)', async () => {
    const page = await open(768, 'light');
    try {
      await page.click('#main .nav-menu');
      await page.waitForFunction(() => document.querySelector('#app').classList.contains('nav-peek'));
      const m = await read(page);
      assert.equal(m.rail, true, 'the peek drawer brings the rail back');
      assert.equal(m.sidebar, true, 'with the sidebar beside it');
    } finally { await page.close(); }
  });
}
