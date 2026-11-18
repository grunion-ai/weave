import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { WIDTH } from './lib/viewports.mjs';

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
  const openMenu = async (page) => {
    await page.click('#main .nav-menu');
    await page.waitForFunction(() => document.querySelector('#app').classList.contains('nav-held'));
  };
  const focusIn = (page) => page.evaluate(() => {
    const a = document.activeElement;
    if (a?.matches('#main .nav-menu')) return 'menu';
    return a?.closest('#ws-rail, #sidebar') ? 'drawer' : (a?.id || a?.tagName || 'none');
  });

  {
    const theme = 'light';
    test(`the phone menu holds the page: focus goes in, Tab stays in, and Escape, the close button and a nav link give it back (${theme})`, async () => {
      const page = await open([390, 844], theme);
      try {
        assert.deepEqual(await state(page), CLOSED, 'the menu starts closed and the page free');
        await openMenu(page);
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

        await openMenu(page);
        assert.deepEqual(await state(page), HELD);
        await page.click('#nav-collapse');
        assert.deepEqual(await state(page), CLOSED, 'the close button closes it and frees the page');
        assert.equal(await focusIn(page), 'menu', 'focus returns to the menu button after the close button');

        await openMenu(page);
        await page.click('#sidebar a.nav-db:has-text("Feature")');
        await page.waitForFunction(() => document.querySelector('.view-title')?.value === 'Feature' || /Feature/.test(document.querySelector('#main .crumb')?.textContent ?? ''));
        assert.equal((await state(page)).open, false, 'following a nav link closes it');
        assert.equal((await state(page)).mainInert, false, 'and frees the page');
      } finally { await page.close(); }
    });
  }

  const railState = (page) => page.evaluate(() => {
    const rail = document.querySelector('#ws-rail');
    return { inert: rail.inert, seen: rail.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && rail.getBoundingClientRect().width > 0 };
  });
  test('the widest phone-format window opens the same full-screen menu as a phone, with the workspace rail live, and Esc gives the page back (Features #377, #379)', async () => {
    const page = await open([WIDTH.widestPhoneFormat, 844]);
    try {
      assert.deepEqual(await railState(page), { inert: false, seen: false }, 'the rail is off screen until the menu button opens the drawer');
      await openMenu(page);
      assert.deepEqual(await state(page), HELD);
      assert.deepEqual(await railState(page), { inert: false, seen: true }, 'the drawer draws the rail and the hold leaves it live, so its workspaces still take a click (Issue #1546)');
      assert.equal(await focusIn(page), 'drawer');
      await page.keyboard.press('Escape');
      assert.deepEqual(await state(page), CLOSED, 'Esc closes it and frees the page');
      assert.deepEqual(await railState(page), { inert: false, seen: false }, 'and the rail leaves the screen with the drawer');
      assert.equal(await focusIn(page), 'menu', 'focus returns to the menu button');
    } finally { await page.close(); }
  });

  test('with the menu open, Shift+Enter, ⌘Z and ? leave the held page alone', async () => {
    const page = await open([390, 844]);
    try {
      await openMenu(page);
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
      await openMenu(page);
      assert.equal((await state(page)).mainInert, true);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForFunction(() => !document.querySelector('#main').inert);
      assert.equal(await page.evaluate(() => document.querySelector('#app').classList.contains('nav-peek')), false, 'the menu closed');
      assert.equal(await page.evaluate(() => document.querySelector('#app').classList.contains('nav-held')), false, 'and the hold let go');
    } finally { await page.close(); }
  });

  const drawerMetrics = (page) => page.evaluate(() => {
    const edges = (node) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right) };
    };
    const one = (sel) => edges(document.querySelector(sel));
    const foot = document.querySelector('#sidebar .nav-foot');
    const newSpace = [...(foot?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim() === '+ New space');
    const header = document.querySelector('#sidebar .nav-space-row a.nav-space, #sidebar .nav-space-row button.nav-space');
    return {
      rules: { foot: one('#sidebar .nav-foot'), system: one('#sidebar .nav-system'), identity: one('#sidebar .nav-identity') },
      row: one('#sidebar .nav-space-row'),
      newSpace: newSpace ? { ...edges(newSpace), fontSize: getComputedStyle(newSpace).fontSize } : null,
      header: header ? { ...edges(header), fontSize: getComputedStyle(header).fontSize } : null,
    };
  });

  for (const theme of ['light', 'dark']) {
    test(`the phone drawer draws its dividers on the row inset and + New space at row size (Issue #1395, ${theme})`, async () => {
      const page = await open([402, 874], theme);
      try {
        await openMenu(page);
        const seen = await drawerMetrics(page);
        const shown = JSON.stringify(seen);
        for (const [name, rule] of Object.entries(seen.rules)) {
          assert.ok(rule, `the drawer draws the ${name} divider: ${shown}`);
          assert.equal(rule.left, seen.row.left, `the ${name} divider starts on the row inset: ${shown}`);
          assert.equal(rule.right, seen.row.right, `the ${name} divider ends on the row inset: ${shown}`);
        }
        assert.ok(seen.newSpace, `the drawer offers + New space: ${shown}`);
        assert.equal(seen.newSpace.left, seen.header.left, `+ New space starts where a space header starts: ${shown}`);
        assert.equal(seen.newSpace.fontSize, seen.header.fontSize, `+ New space is set at the space header size: ${shown}`);
      } finally { await page.close(); }
    });
  }

}
