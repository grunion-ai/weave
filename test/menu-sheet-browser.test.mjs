import test from 'node:test';
import assert from 'node:assert/strict';
import { engineOf, launch, phoneProfile, settled } from './lib/browser.mjs';

const IPHONE = phoneProfile()?.page ?? null;

const s = await launch('menu phone sheet', (weave) => {
  weave.createSpace({ name: 'Product' });
  const tasks = weave.createTable({ space: 'Product', name: 'Task' });
  const row = weave.createEntity(tasks, { name: 'Ship the sheet' });
  return { entity: `#/entity/${row.id}`, space: `#/space/${weave.getSpace('Product').id}` };
});

if (s) {
  const { base, browser, entity, space } = s;
  const engines = [['chromium 390x844', browser, { viewport: { width: 390, height: 844 } }]];
  const webkit = await engineOf('webkit');
  if (webkit && IPHONE) engines.push(['webkit iPhone 15', webkit, IPHONE]);

  const open = async (b, profile, theme, hash) => {
    const page = await b.newPage(profile);
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main .view-header .dots-btn');
    return page;
  };
  const read = async (page) => {
    await page.click('#main .view-header .dots-btn');
    await page.waitForSelector('.chip-pop.wv-menu[role="menu"]');
    await settled(page.locator('.chip-pop.wv-menu'));
    const seen = await page.evaluate(() => {
      const pop = document.querySelector('.chip-pop.wv-menu');
      const r = pop.getBoundingClientRect();
      const lum = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0) / 255;
      return {
        theme: document.documentElement.dataset.bsTheme,
        sheet: pop.classList.contains('wv-menu-sheet'),
        box: { left: r.left, right: r.right, bottom: r.bottom, top: r.top },
        vw: document.documentElement.clientWidth, vh: innerHeight,
        labels: [...pop.querySelectorAll('.wv-menu-row')].map((n) => n.querySelector('.wv-menu-label, .hold-label').textContent),
        heights: [...pop.querySelectorAll('.wv-menu-row')].map((n) => Math.round(n.getBoundingClientRect().height)),
        bg: lum(getComputedStyle(pop).backgroundColor),
        focused: document.activeElement?.closest?.('.wv-menu') === pop,
      };
    });
    await page.keyboard.press('Escape');
    await page.waitForSelector('.chip-pop.wv-menu', { state: 'detached' });
    return seen;
  };

  for (const [hash, what] of [[entity, 'record'], [space, 'space']]) {
    const desktop = await (async () => {
      const page = await open(browser, { viewport: { width: 1280, height: 844 } }, 'light', hash);
      try { return await read(page); } finally { await page.close(); }
    })();

    test(`on a desktop the ${what} menu is an anchored popover, not a sheet (Feature #296)`, () => {
      assert.equal(desktop.sheet, false);
      assert.ok(desktop.labels.length >= 1, `the ${what} menu has rows: ${desktop.labels}`);
      assert.ok(desktop.box.bottom < desktop.vh - 8, 'it hangs below its trigger');
    });

    for (const [engine, b, profile] of engines) {
      for (const theme of ['light', 'dark']) {
        test(`on a phone the ${what} menu is a bottom sheet with the desktop rows in the desktop order, 44px each (${engine}, ${theme}, Feature #296)`, async () => {
          const page = await open(b, profile, theme, hash);
          try {
            const seen = await read(page);
            assert.equal(seen.theme, theme);
            assert.equal(seen.sheet, true, 'the same menu() draws a sheet');
            assert.deepEqual(seen.labels, desktop.labels, 'same rows, same order as the desktop menu');
            assert.ok(seen.heights.every((h) => h >= 44), `every row is a 44px target: ${seen.heights}`);
            assert.ok(Math.abs(seen.box.bottom - seen.vh) <= 1, `pinned to the bottom edge (${seen.box.bottom} vs ${seen.vh})`);
            assert.ok(seen.box.left <= 0.5 && seen.box.right >= seen.vw - 0.5, 'full width');
            assert.ok(theme === 'light' ? seen.bg > 0.5 : seen.bg < 0.5, `${theme}: the sheet paints its theme (${seen.bg.toFixed(3)})`);
            assert.ok(seen.focused, 'focus moves into the sheet');
            assert.ok(seen.box.right - seen.box.left <= seen.vw + 0.5, 'and nothing overflows sideways');
          } finally { await page.close(); }
        });
      }
    }
  }
}
