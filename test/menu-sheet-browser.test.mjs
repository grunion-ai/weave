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
  const engines = [['chromium 390x844', browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]];
  engines.push(['webkit iPhone 15', await engineOf('webkit'), IPHONE]);

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
            const phoneOnly = ['Report a problem'];
            assert.deepEqual(seen.labels.filter((l) => !phoneOnly.includes(l)), desktop.labels,
              'the desktop rows, in the desktop order');
            assert.deepEqual(seen.labels.filter((l) => phoneOnly.includes(l)),
              what === 'record' ? ['Report a problem'] : [],
              'plus the rows a phone has no other route to (Issue #1023)');
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

  const dragSheet = async (page, sel, dy) => {
    const box = await page.locator(`${sel} .sheet-grip`).boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i += 1) {
      await page.waitForTimeout(40);
      await page.mouse.move(x, y + (dy * i) / 6);
    }
    await page.mouse.up();
  };

  for (const [engine, b, profile] of engines) {
    test(`on a phone the record menu sheet's handle is a grabber that dismisses the sheet (${engine}, Issue #1383)`, async () => {
      const page = await open(b, profile, 'light', entity);
      try {
        await page.click('#main .view-header .dots-btn');
        await page.waitForSelector('.chip-pop.wv-menu-sheet .wv-menu-row');
        await settled(page.locator('.chip-pop.wv-menu-sheet'));
        const drawn = await page.evaluate(() => {
          const pop = document.querySelector('.chip-pop.wv-menu-sheet');
          const grip = pop.querySelector('.sheet-grip');
          return {
            pseudo: getComputedStyle(pop, '::before').content,
            grip: grip ? Math.round(grip.getBoundingClientRect().height) : null,
            first: pop.firstElementChild?.className ?? '',
            height: Math.round(pop.getBoundingClientRect().height),
          };
        });
        assert.equal(drawn.first, 'sheet-grip', "the sheet opens with the picker sheets' grabber at the top");
        assert.ok(drawn.grip >= 44, `the grabber is a real target, got ${drawn.grip}px tall`);
        assert.ok(['none', 'normal'].includes(drawn.pseudo), `and it is the only handle drawn, got ${drawn.pseudo}`);
        await dragSheet(page, '.chip-pop.wv-menu-sheet', Math.round(drawn.height * 0.5));
        await page.waitForSelector('.chip-pop.wv-menu', { state: 'detached', timeout: 5000 });
      } finally { await page.close(); }
    });
  }
}
