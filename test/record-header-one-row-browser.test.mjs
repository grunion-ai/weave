import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tasks, row;
const s = await launch('record header one row', (weave) => {
  weave.createSpace({ name: 'Backlog', icon: 'lucide:list-checks' });
  tasks = weave.createTable({ space: 'Backlog', name: 'Tasks', icon: 'lucide:square-check' });
  row = weave.createEntity(tasks, { name: 'AMEX CC Migration' });
});

if (s) {
  const { base, browser } = s;
  const settle = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  const read = (page, scope) => page.evaluate((scope) => {
    const rowEl = document.querySelector(`${scope} .view-header .crumb-row`);
    const path = rowEl.querySelector(':scope > .crumb-path');
    const acts = rowEl.querySelector(':scope > .crumb-actions');
    const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
    const seen = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
    const shown = [...acts.children].filter(seen);
    const slots = [...path.querySelectorAll(':scope > .crumb-slot')].filter(seen);
    const copy = path.querySelector('.crumb-copy');
    return {
      row: box(rowEl), path: box(path), acts: box(acts),
      buttons: shown.map((b) => ({ ...box(b), name: b.getAttribute('aria-label') ?? b.querySelector('button')?.getAttribute('aria-label') ?? b.className })),
      slots: slots.map(box),
      copy: seen(copy) ? box(copy) : null,
      pid: seen(path.querySelector('.crumb-cur .crumb-pid')) ? box(path.querySelector('.crumb-cur .crumb-pid')) : null,
      folded: !!path.querySelector('.crumb-more'),
      tight: rowEl.classList.contains('crumb-row-tight'),
      pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  }, scope);
  const oneRow = (m, at) => {
    const mid = (b) => (b.t + b.b) / 2;
    for (const b of m.buttons) {
      assert.ok(mid(b) > m.path.t && mid(b) < m.path.b, `${at}: "${b.name}" sits on the breadcrumb line, never under it: ${JSON.stringify({ button: b, path: m.path })}`);
    }
    assert.ok(m.path.r <= m.acts.l + 0.5, `${at}: breadcrumbs end before the toolbar starts: ${m.path.r} > ${m.acts.l}`);
    for (const sl of m.slots) assert.ok(sl.r <= m.path.r + 0.5 && sl.l >= m.path.l - 0.5, `${at}: no crumb is cut by the path edge: ${JSON.stringify({ sl, path: m.path })}`);
    assert.ok(m.copy && m.copy.w > 0 && m.copy.r <= m.path.r + 0.5, `${at}: the copy-permalink button stays whole: ${JSON.stringify(m.copy)}`);
    assert.ok(m.pid && m.pid.r <= m.path.r + 0.5, `${at}: the record number stays whole: ${JSON.stringify(m.pid)}`);
    assert.ok(m.pageScroll <= 0, `${at}: the page never scrolls sideways: ${m.pageScroll}px`);
    if (m.folded) assert.ok(m.tight, `${at}: the toolbar condenses before a crumb folds`);
  };

  test('the full-page record header keeps breadcrumbs and toolbar on one row from 320 to 1920 px (Feature #377)', async () => {
    const page = await browser.newPage({ viewport: { width: 1920, height: 900 } });
    try {
      await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main .view-header .crumb-cur');
      for (let width = 1920; width >= 320; width -= 16) {
        await page.setViewportSize({ width, height: 900 });
        await settle(page);
        oneRow(await read(page, '#main'), `${width}px`);
      }
    } finally { await page.close(); }
  });

  test('a wide record header shows every action and a tight one keeps fields, the menu and close (Feature #377)', async () => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    try {
      await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main .view-header .crumb-cur');
      await settle(page);
      const wide = await read(page, '#main');
      assert.equal(wide.tight, false, 'a wide header is not condensed');
      assert.ok(wide.buttons.some((b) => b.name === 'Activity'), `Activity shows when there is room: ${wide.buttons.map((b) => b.name)}`);
      let tight = null;
      for (let width = 1200; width >= 620 && !tight; width -= 20) {
        await page.setViewportSize({ width, height: 900 });
        await settle(page);
        const m = await read(page, '#main');
        if (m.tight) tight = m;
      }
      assert.ok(tight, 'the header condenses somewhere above the phone width');
      const names = tight.buttons.map((b) => b.name);
      assert.ok(!names.includes('Activity') && !names.some((n) => /^Collapse/.test(n)), `Activity and Collapse leave the row: ${names}`);
      assert.ok(names.includes('Show or hide fields'), `Show or hide fields stays: ${names}`);
      assert.ok(names.some((n) => /^Close/.test(n)), `Close stays: ${names}`);
      await page.click('#main .view-header .crumb-actions .dots-btn');
      const labels = await page.locator('.wv-menu-label').allTextContents();
      assert.ok(labels.some((l) => /Activity/.test(l)), `the menu offers Activity: ${labels}`);
      assert.ok(labels.some((l) => /Collapse/.test(l)), `the menu offers Collapse: ${labels}`);
      await page.locator('.wv-menu-label', { hasText: 'Activity' }).click();
      await page.waitForSelector('#main .activity-btn[aria-pressed="true"]', { state: 'attached' });
    } finally { await page.close(); }
  });

  test('a narrow docked record keeps its header on one row (Feature #377)', async () => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    try {
      await page.addInitScript(() => localStorage.setItem('wv-dock-width', '400'));
      await page.goto(`${base}/#/table/${tasks.id}?e=${row.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#dock .view-header .crumb-cur');
      for (const width of [1200, 1100, 1000, 960, 901]) {
        await page.setViewportSize({ width, height: 800 });
        await settle(page);
        oneRow(await read(page, '#dock'), `dock at ${width}px`);
      }
    } finally { await page.close(); }
  });
}
