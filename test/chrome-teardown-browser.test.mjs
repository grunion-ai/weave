import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tasks, notes;
const s = await launch('chrome teardown', (weave) => {
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
  const live = { observers: 0, header: 0, crumbs: 0, other: 0 };
  window.__wvObs = live;
  const kindOf = (node) => (node?.classList?.contains?.('view-header') ? 'header'
    : node?.classList?.contains?.('crumb-path') ? 'crumbs' : 'other');
  const bump = (kind, by) => { live[kind] += by; };
  window.ResizeObserver = class extends Real {
    observe(target, ...rest) {
      this.__wvSeen ??= new Set();
      if (!this.__wvLive) { this.__wvLive = true; live.observers += 1; }
      if (!this.__wvSeen.has(target)) { this.__wvSeen.add(target); bump(kindOf(target), 1); }
      return super.observe(target, ...rest);
    }
    unobserve(target, ...rest) {
      if (this.__wvSeen?.delete(target)) bump(kindOf(target), -1);
      return super.unobserve(target, ...rest);
    }
    disconnect() {
      if (this.__wvLive) { this.__wvLive = false; live.observers -= 1; }
      for (const target of this.__wvSeen ?? []) bump(kindOf(target), -1);
      this.__wvSeen?.clear();
      return super.disconnect();
    }
  };
};

if (s) {
  const { base, browser } = s;

  const openTable = async (id) => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.addInitScript(WATCH);
    await page.goto(`${base}/#/table/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.waitForTimeout(100);
    return page;
  };

  const drawTable = async (page, id) => {
    await page.evaluate((table) => showDatabase(table), id);
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.waitForTimeout(100);
  };

  const held = async (page) => page.evaluate(() => ({ ...window.__wvObs }));

  test('moving between two tables leaves no view header or breadcrumb observer behind (Issue #1805)', async () => {
    const page = await openTable(tasks.id);
    try {
      const before = await held(page);
      for (let i = 0; i < 4; i++) {
        await drawTable(page, notes.id);
        await drawTable(page, tasks.id);
      }
      assert.deepEqual(await held(page), before, 'eight chrome redraws hold exactly what one draw held');
    } finally { await page.close(); }
  });
}
