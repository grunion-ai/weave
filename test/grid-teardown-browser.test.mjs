import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tasks, notes;
const s = await launch('grid teardown', (weave) => {
  weave.createSpace({ name: 'Product' });
  tasks = weave.createTable({ space: 'Product', name: 'Task' });
  weave.addField(tasks, { name: 'Note', type: 'text' });
  for (let i = 0; i < 8; i++) weave.createEntity(tasks, { name: `Task ${i}`, values: { Note: `note ${i}` } });
  notes = weave.createTable({ space: 'Product', name: 'Memo' });
  weave.addField(notes, { name: 'Body', type: 'text' });
  for (let i = 0; i < 4; i++) weave.createEntity(notes, { name: `Memo ${i}`, values: { Body: `body ${i}` } });
});

const WATCH = () => {
  const Real = window.ResizeObserver;
  const live = { grids: 0, doc: {} };
  window.__wvLive = live;
  const onGrid = (node) => !!node?.classList?.contains?.('table-wrap');
  window.ResizeObserver = class extends Real {
    observe(target, ...rest) {
      if (!this.__wvOn) { this.__wvOn = true; this.__wvGrid = onGrid(target); if (this.__wvGrid) live.grids += 1; }
      return super.observe(target, ...rest);
    }
    disconnect() {
      if (this.__wvOn) { this.__wvOn = false; if (this.__wvGrid) live.grids -= 1; }
      return super.disconnect();
    }
  };
  const count = (type, by) => { live.doc[type] = (live.doc[type] ?? 0) + by; };
  const add = document.addEventListener.bind(document);
  const drop = document.removeEventListener.bind(document);
  document.addEventListener = (type, fn, opts) => {
    count(type, 1);
    const signal = opts && typeof opts === 'object' ? opts.signal : null;
    if (signal) signal.addEventListener('abort', () => count(type, -1), { once: true });
    return add(type, fn, opts);
  };
  document.removeEventListener = (type, fn, opts) => {
    count(type, -1);
    return drop(type, fn, opts);
  };
};

if (s) {
  const { base, browser } = s;

  const openGrid = async (id) => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.addInitScript(WATCH);
    await page.goto(`${base}/#/table/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    return page;
  };

  const drawTable = async (page, id) => {
    await page.evaluate((table) => showDatabase(table), id);
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.waitForTimeout(100);
  };

  const held = async (page) => page.evaluate(() => ({
    grids: window.__wvLive.grids,
    scroll: window.__wvLive.doc.scroll ?? 0,
    copy: window.__wvLive.doc.copy ?? 0,
    paste: window.__wvLive.doc.paste ?? 0,
  }));

  test('a redraw of the same table leaves no observer or document listener behind (Issue #1701)', async () => {
    const page = await openGrid(tasks.id);
    try {
      const before = await held(page);
      for (let i = 0; i < 4; i++) await drawTable(page, tasks.id);
      assert.deepEqual(await held(page), before, 'four redraws hold exactly what one draw held');
    } finally { await page.close(); }
  });

  test('moving to another table and back leaves no observer or document listener behind (Issue #1701)', async () => {
    const page = await openGrid(tasks.id);
    try {
      const before = await held(page);
      await drawTable(page, notes.id);
      assert.deepEqual(await held(page), before, 'the table it left is torn down');
      await drawTable(page, tasks.id);
      assert.deepEqual(await held(page), before, 'and so is the one it came back from');
    } finally { await page.close(); }
  });
}
