import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const TABLE_ROWS = ['Column stats…', 'Export CSV', 'Share…', 'New share page…', 'Row term (row)…', 'Delete table'];

const s = await launch('menu keyboard', (weave) => {
  weave.createSpace({ name: 'Product' });
  const tasks = weave.createTable({ space: 'Product', name: 'Task' });
  weave.createEntity(tasks, { name: 'First' });
  return { table: `#/table/${tasks.id}` };
});

if (s) {
  const { base, browser, table } = s;
  const open = async (theme) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${base}/${table}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main .crumb-actions .dots-btn');
    return page;
  };
  const focused = (page) => page.evaluate(() => {
    const a = document.activeElement;
    return { text: a?.querySelector?.('.wv-menu-label, .hold-label')?.textContent ?? a?.textContent?.trim() ?? '', role: a?.getAttribute?.('role') ?? null, trigger: !!a?.matches?.('#main .crumb-actions .dots-btn') };
  });
  const press = async (page, key) => { await page.keyboard.press(key); return (await focused(page)).text; };
  const menuOpen = (page) => page.locator('.chip-pop.wv-menu[role="menu"]').count();

  for (const theme of ['light', 'dark']) {
    test(`a ⋮ menu opens from the keyboard on its first row and walks with arrows, Home, End and typeahead (${theme}, Issue #763)`, async () => {
      const page = await open(theme);
      try {
        const trigger = page.locator('#main .crumb-actions .dots-btn');
        assert.equal(await trigger.getAttribute('aria-haspopup'), 'menu');
        await trigger.focus();
        await page.keyboard.press('Enter');
        await page.waitForSelector('.chip-pop.wv-menu[role="menu"]');
        assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
        const rows = await page.$$eval('.wv-menu .wv-menu-row', (rs) => rs.map((r) => [r.getAttribute('role'), r.querySelector('.wv-menu-label, .hold-label')?.textContent]));
        assert.deepEqual(rows.map((r) => r[1]), TABLE_ROWS, 'every current row, in today\'s order');
        assert.ok(rows.every((r) => r[0] === 'menuitem'), `every row is a menuitem: ${JSON.stringify(rows)}`);
        assert.deepEqual(await focused(page), { text: 'Column stats…', role: 'menuitem', trigger: false }, 'focus lands on the first row');
        assert.equal(await press(page, 'ArrowDown'), 'Export CSV');
        assert.equal(await press(page, 'ArrowUp'), 'Column stats…');
        assert.equal(await press(page, 'ArrowUp'), 'Delete table', 'ArrowUp from the first row wraps to the last');
        assert.equal(await press(page, 'ArrowDown'), 'Column stats…', 'and ArrowDown from the last wraps to the first');
        assert.equal(await press(page, 'End'), 'Delete table');
        assert.equal(await press(page, 'Home'), 'Column stats…');
        assert.equal(await press(page, 'n'), 'New share page…', 'a letter jumps to the next row it starts');
        await press(page, 'Home');
        assert.equal(await press(page, 'r'), 'Row term (row)…', 'an arrow or Home starts a fresh search');
        await press(page, 'End');
        assert.equal(await press(page, 's'), 'Share…', 'typeahead wraps past the end');
        const paint = await page.evaluate(() => {
          const pop = document.querySelector('.wv-menu');
          const lum = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0) / 255;
          return { theme: document.documentElement.dataset.bsTheme, bg: lum(getComputedStyle(pop).backgroundColor), ink: lum(getComputedStyle(pop.querySelector('.wv-menu-row')).color) };
        });
        assert.equal(paint.theme, theme);
        assert.ok(theme === 'light' ? paint.bg > 0.5 && paint.ink < 0.5 : paint.bg < 0.5 && paint.ink > 0.5, `${theme}: the menu paints its theme (${JSON.stringify(paint)})`);
        await page.keyboard.press('Escape');
        assert.equal(await menuOpen(page), 0, 'Escape closes the menu');
        assert.equal((await focused(page)).trigger, true, 'and hands focus back to the trigger');
        assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
        await page.keyboard.press('Enter');
        await page.waitForSelector('.chip-pop.wv-menu[role="menu"]');
        await page.keyboard.press('Tab');
        assert.equal(await menuOpen(page), 0, 'Tab closes it too');
        assert.equal((await focused(page)).trigger, true, 'leaving focus on the trigger');
      } finally { await page.close(); }
    });
  }

  test('Enter on a row runs it and closes the menu (Issue #763)', async () => {
    const page = await open('light');
    try {
      await page.locator('#main .crumb-actions .dots-btn').focus();
      await page.keyboard.press('Enter');
      await page.waitForSelector('.chip-pop.wv-menu[role="menu"]');
      await page.keyboard.press('s');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#modal, #tray-back, [role="dialog"]');
      assert.equal(await menuOpen(page), 0, 'the menu closed before the share dialog opened');
    } finally { await page.close(); }
  });

  test('the workspace tray menu opens at the pointer and takes the same keys (Issue #763)', async () => {
    const page = await open('dark');
    try {
      const chip = page.locator('#ws-list .ws-icon').first();
      const box = await chip.boundingBox();
      await chip.click({ button: 'right', position: { x: 6, y: 6 } });
      await page.waitForSelector('.chip-pop.wv-menu.ws-ctx[role="menu"]');
      const m = await page.locator('.wv-menu.ws-ctx').boundingBox();
      assert.ok(Math.abs(m.x - (box.x + 6)) <= 1 && Math.abs(m.y - (box.y + 6)) <= 1, `the menu opens at the pointer (${m.x},${m.y} vs ${box.x + 6},${box.y + 6})`);
      const labels = await page.$$eval('.wv-menu.ws-ctx .wv-menu-row', (rs) => rs.map((r) => r.querySelector('.wv-menu-label').textContent));
      assert.equal(labels[0], 'Update logo…');
      assert.equal((await focused(page)).text, labels[0], 'focus lands on its first row');
      assert.equal(await press(page, 'End'), labels.at(-1), 'End moves to the last row');
      assert.equal(await press(page, 'Home'), labels[0], 'Home back to the first');
      await page.keyboard.press('Escape');
      assert.equal(await menuOpen(page), 0);
    } finally { await page.close(); }
  });
}
