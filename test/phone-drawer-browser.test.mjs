import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let issues;
const s = await launch('phone drawer hold', (weave) => {
  weave.createSpace({ name: 'Development' });
  issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.createTable({ space: 'Development', name: 'Feature' });
  for (let i = 0; i < 4; i += 1) weave.createEntity(issues, { name: `Finding ${i}` });
});

if (s) {
  const { base, browser } = s;

  const open = async ([width, height], theme = 'light') => {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/#/table/${issues.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.waitForSelector('#main .nav-menu');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
    return page;
  };
  const state = (page) => page.evaluate(() => ({
    open: document.querySelector('#app').classList.contains('nav-peek'),
    expanded: document.querySelector('#main .nav-menu')?.getAttribute('aria-expanded') ?? null,
    mainInert: document.querySelector('#main').inert,
  }));
  const CLOSED = { open: false, expanded: 'false', mainInert: false };
  const HELD = { open: true, expanded: 'true', mainInert: true };
  const focusIn = (page) => page.evaluate(() => {
    const a = document.activeElement;
    if (a?.matches('#main .nav-menu')) return 'menu';
    return a?.closest('#ws-rail, #sidebar') ? 'drawer' : (a?.id || a?.tagName || 'none');
  });

  for (const theme of ['light', 'dark']) {
    test(`the phone menu holds the page: focus goes in, Tab stays in, and Escape, the close button and a nav link give it back (${theme})`, async () => {
      const page = await open([390, 844], theme);
      try {
        assert.deepEqual(await state(page), CLOSED, 'the menu starts closed and the page free');
        await page.click('#main .nav-menu');
        assert.deepEqual(await state(page), HELD, 'the menu is open, the button says so and the page behind is inert');
        assert.equal(await focusIn(page), 'drawer', 'focus moves into the menu');
        for (let i = 0; i < 30; i += 1) {
          await page.keyboard.press('Tab');
          assert.equal(await focusIn(page), 'drawer', `Tab ${i + 1} stays inside the menu`);
        }
        await page.keyboard.press('Shift+Tab');
        assert.equal(await focusIn(page), 'drawer', 'Shift+Tab stays inside the menu');

        await page.keyboard.press('Escape');
        assert.deepEqual(await state(page), CLOSED, 'Escape closes it and frees the page');
        assert.equal(await focusIn(page), 'menu', 'focus returns to the menu button');

        await page.click('#main .nav-menu');
        assert.deepEqual(await state(page), HELD);
        await page.click('#nav-collapse');
        assert.deepEqual(await state(page), CLOSED, 'the close button closes it and frees the page');
        assert.equal(await focusIn(page), 'menu', 'focus returns to the menu button after the close button');

        await page.click('#main .nav-menu');
        await page.click('#sidebar a.nav-db:has-text("Feature")');
        await page.waitForFunction(() => document.querySelector('.view-title')?.value === 'Feature' || /Feature/.test(document.querySelector('#main .crumb')?.textContent ?? ''));
        assert.equal((await state(page)).open, false, 'following a nav link closes it');
        assert.equal((await state(page)).mainInert, false, 'and frees the page');
      } finally { await page.close(); }
    });
  }

  test('between 600 and 900px the drawer holds the rail beside it too, and the scrim gives the page back', async () => {
    const page = await open([700, 844]);
    try {
      await page.click('#main .nav-menu');
      assert.deepEqual(await state(page), HELD);
      assert.equal(await page.evaluate(() => document.querySelector('#ws-rail').inert), true, 'the rail outside the drawer is held');
      assert.equal(await focusIn(page), 'drawer');
      await page.mouse.click(680, 500);
      assert.deepEqual(await state(page), CLOSED, 'a tap on the scrim closes it and frees the page');
      assert.equal(await page.evaluate(() => document.querySelector('#ws-rail').inert), false, 'the rail is live again');
      assert.equal(await focusIn(page), 'menu', 'focus returns to the menu button');
    } finally { await page.close(); }
  });

  test('with the menu open, Shift+Enter, ⌘Z and ? leave the held page alone', async () => {
    const page = await open([390, 844]);
    try {
      await page.click('#main .nav-menu');
      assert.equal((await state(page)).mainInert, true);
      await page.evaluate(() => {
        window.__keys = [];
        window.__writes = [];
        const f = window.fetch;
        window.fetch = (u, o = {}) => {
          if ((o.method ?? 'GET') !== 'GET') window.__writes.push(`${o.method} ${u}`);
          return f(u, o);
        };
        addEventListener('keydown', (e) => { if (!['Shift', 'Control', 'Meta', 'Alt'].includes(e.key)) window.__keys.push(`${e.key}:${e.defaultPrevented}`); });
        const side = document.querySelector('#sidebar');
        side.tabIndex = -1;
        side.focus();
      });
      const rowsBefore = await page.$$eval('.wv-grid tbody tr.entity-row', (t) => t.length);
      await page.keyboard.press('Shift+Enter');
      await page.keyboard.press('Control+z');
      await page.keyboard.press('Meta+z');
      await page.keyboard.press('?');
      const seen = await page.evaluate(() => ({ keys: window.__keys, writes: window.__writes, sheet: !!document.querySelector('#modal-back') }));
      assert.deepEqual(seen, { keys: ['Enter:false', 'z:false', 'z:false', '?:false'], writes: [], sheet: false },
        'no handler behind the menu took a key, nothing was written and the key sheet did not open');
      assert.equal(await page.$$eval('.wv-grid tbody tr.entity-row', (t) => t.length), rowsBefore, 'the grid behind has the rows it had');
      assert.equal((await state(page)).open, true, 'and the menu is still open');
    } finally { await page.close(); }
  });

  test('a menu left open when the window grows to a desktop width closes and frees the page', async () => {
    const page = await open([390, 844]);
    try {
      await page.click('#main .nav-menu');
      assert.equal((await state(page)).mainInert, true);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForFunction(() => !document.querySelector('#main').inert);
      assert.equal(await page.evaluate(() => document.querySelector('#app').classList.contains('nav-peek')), false, 'the menu closed');
      assert.equal(await page.evaluate(() => document.querySelector('#app').classList.contains('nav-held')), false, 'and the hold let go');
    } finally { await page.close(); }
  });
}
