import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { closePane, openPane } from './lib/view-pane.mjs';

let tasks;
const s = await launch('bug fab beside panels', (weave) => {
  weave.createSpace({ name: 'Work' });
  tasks = weave.createTable({ space: 'Work', name: 'Task' });
  for (let i = 0; i < 6; i++) weave.createEntity(tasks, { name: `Task ${i}` });
});

if (s) {
  const { base, browser } = s;
  const settle = (page) => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  const read = (page, pane) => page.evaluate((sel) => {
    const box = (n) => { const r = n.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
    const fab = document.querySelector('.bug-fab');
    const panel = document.querySelector(sel);
    return { fab: fab.getClientRects().length ? box(fab) : null, panel: panel && !panel.hidden ? box(panel) : null, vw: innerWidth };
  }, pane);
  const apart = (a, b) => !a || !b || a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
  const open = async (width) => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main tr.entity-row');
    await page.waitForSelector('.bug-fab');
    return page;
  };

  for (const width of [1440, 1024]) {
    test(`at ${width} px the Report a problem button stays clear of the open View panel, and Clear all takes every click (Issue #1861)`, async () => {
      const page = await open(width);
      try {
        await openPane(page);
        await settle(page);
        const m = await read(page, '#view-pane');
        assert.ok(m.panel, 'the View panel is open');
        assert.ok(apart(m.fab, m.panel), `the bug button sits outside the View panel: ${JSON.stringify(m)}`);
        const clear = await page.locator('#view-pane .vp-foot button', { hasText: 'Clear all' }).evaluate((b) => {
          const r = b.getBoundingClientRect();
          const at = document.elementFromPoint(r.right - 4, r.bottom - 4);
          return b.contains(at);
        });
        assert.ok(clear, 'the bottom right corner of Clear all answers to Clear all');
        await closePane(page);
        await settle(page);
        const back = await read(page, '#view-pane');
        assert.equal(back.fab && Math.round(back.vw - back.fab.right), 18, `with the panel closed the bug button returns to its corner: ${JSON.stringify(back)}`);
      } finally { await page.close(); }
    });
  }

  test('the Report a problem button stays clear of the open Share panel (Issue #1861)', async () => {
    const page = await open(1440);
    try {
      await page.click('#main .table-share-btn');
      await page.waitForSelector('#share-pane:not([hidden]) .share-add');
      await settle(page);
      const m = await read(page, '#share-pane');
      assert.ok(apart(m.fab, m.panel), `the bug button sits outside the Share panel: ${JSON.stringify(m)}`);
    } finally { await page.close(); }
  });
}
