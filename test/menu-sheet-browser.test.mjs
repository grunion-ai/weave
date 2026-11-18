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
            const phoneOnly = ['Report a problem', 'Activity', 'Share (Beta)', 'Collapse beside the table'];
            assert.deepEqual(seen.labels.filter((l) => !phoneOnly.includes(l)), desktop.labels.filter((l) => l !== 'Dock beside table'),
              'the desktop rows, in the desktop order; the desktop pose row reads Collapse beside the table on a phone');
            assert.deepEqual(seen.labels.filter((l) => phoneOnly.includes(l)),
              what === 'record' ? ['Activity', 'Share (Beta)', 'Collapse beside the table', 'Report a problem'] : [],
              'plus the rows a condensed phone header sheds (Feature #377) and the row a phone has no other route to (Issue #1023)');
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

  const sheetFocus = (page) => page.evaluate(() => {
    const pop = document.querySelector('.chip-pop.wv-menu-sheet');
    const rows = [...pop.querySelectorAll('.wv-menu-row')];
    const a = document.activeElement;
    return {
      coarse: matchMedia('(hover: none) and (pointer: coarse)').matches,
      inSheet: a?.closest?.('.wv-menu') === pop,
      onRow: rows.indexOf(a),
      ring: rows.filter((r) => r.matches(':focus-visible')).length,
      fills: [...new Set(rows.map((r) => getComputedStyle(r).backgroundColor))],
      popOutline: getComputedStyle(pop).outlineStyle,
      labels: rows.map((r) => r.querySelector('.wv-menu-label')?.textContent ?? ''),
    };
  });

  for (const [engine, b, profile] of engines) {
    test(`a tapped record menu sheet opens with no row drawn as chosen, and the arrows still reach the first (${engine}, Issue #1389)`, async () => {
      const page = await open(b, profile, 'light', entity);
      try {
        await page.click('#main .view-header .dots-btn');
        await page.waitForSelector('.chip-pop.wv-menu-sheet .wv-menu-row');
        await settled(page.locator('.chip-pop.wv-menu-sheet'));
        const seen = await sheetFocus(page);
        assert.equal(seen.coarse, true, 'the profile is a coarse pointer, which is what the rule keys on');
        assert.equal(seen.onRow, -1, `a tap leaves no row focused, so none reads as chosen (got "${seen.labels[seen.onRow]}")`);
        assert.equal(seen.ring, 0, 'and none carries the keyboard ring');
        assert.deepEqual(seen.fills, ['rgba(0, 0, 0, 0)'], `every row keeps the sheet's own background: ${seen.fills}`);
        assert.ok(seen.inSheet, 'focus rests in the sheet itself, so Escape and the arrow keys keep working');
        assert.equal(seen.popOutline, 'none', 'and the sheet draws no ring of its own');
        await page.keyboard.press('ArrowDown');
        const walked = await sheetFocus(page);
        assert.equal(walked.onRow, 0, 'ArrowDown from the tapped sheet reaches the first row');
        assert.equal(walked.ring, 1, 'and that row carries the ring, because a key moved it');
        await page.keyboard.press('Escape');
        await page.waitForSelector('.chip-pop.wv-menu', { state: 'detached' });
      } finally { await page.close(); }
    });

    test(`a record menu sheet opened with Enter still lands on its first row (${engine}, Issue #1389)`, async () => {
      const page = await open(b, profile, 'light', entity);
      try {
        await page.locator('#main .view-header .dots-btn').focus();
        await page.keyboard.press('Enter');
        await page.waitForSelector('.chip-pop.wv-menu-sheet .wv-menu-row');
        await settled(page.locator('.chip-pop.wv-menu-sheet'));
        const seen = await sheetFocus(page);
        assert.equal(seen.onRow, 0, 'a keyboard open keeps the first-row affordance');
        assert.equal(seen.ring, 1, 'drawn as keyboard focus');
        await page.keyboard.press('Escape');
        await page.waitForSelector('.chip-pop.wv-menu', { state: 'detached' });
      } finally { await page.close(); }
    });
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
