import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';

let tasks, first;
const ROWS = 240;

const s = await launch('clip marks walk only the rows that changed', (weave) => {
  weave.createSpace({ name: 'Ops' });
  tasks = weave.createTable({ space: 'Ops', name: 'Task' });
  weave.addField(tasks, { name: 'Note', type: 'text' });
  weave.addField(tasks, { name: 'Tags', type: 'multiselect', config: { options: ['alpha', 'beta', 'gamma'] } });
  for (let i = 0; i < ROWS; i++) {
    const row = weave.createEntity(tasks, { name: `Row ${String(i).padStart(3, '0')}`, values: { Note: `n${i}`, Tags: ['alpha', 'beta'] } });
    first ??= row;
  }
});

if (s) {
  const { base, browser, weave } = s;
  const cell = (id, f) => `tr[data-eid="${id}"] td[data-field="${f}"]`;

  async function open() {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`${cell(first.id, 'Note')} .text-dressed`);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    return page;
  }

  const spy = (page) => page.evaluate(() => {
    const seen = new Map();
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth');
    Object.defineProperty(Element.prototype, 'scrollWidth', {
      configurable: true,
      get() {
        if (/markClippedCells/.test(new Error().stack)) {
          const eid = this.closest?.('tr[data-eid]')?.dataset.eid;
          if (eid) seen.set(eid, (seen.get(eid) ?? 0) + 1);
        }
        return desc.get.call(this);
      },
    });
    window.__clipReads = () => Object.fromEntries(seen);
    window.__clipReset = () => seen.clear();
  });
  const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const reads = (page) => page.evaluate(() => window.__clipReads());

  test('a single cell commit re-marks only the row it changed (Issue #1697)', async () => {
    const page = await open();
    try {
      await spy(page);
      await page.click(`${cell(first.id, 'Note')} .text-dressed`);
      await page.fill(`${cell(first.id, 'Note')} input`, 'n0 edited');
      await page.keyboard.press('Tab');
      assert.equal(await eventually(() => weave.readEntity(first.id).fields.Note, 'n0 edited'), 'n0 edited');
      await page.waitForFunction((sel) => document.querySelector(sel)?.textContent.includes('n0 edited'), `${cell(first.id, 'Note')}`);
      await frames(page);
      const touched = await reads(page);
      assert.ok(touched[first.id] > 0, `the edited row was re-marked, got ${JSON.stringify(touched)}`);
      const others = Object.keys(touched).filter((id) => id !== first.id);
      assert.deepEqual(others, [], `no other row was walked, got ${others.length} rows`);
    } finally { await page.close(); }
  });

  test('a scroll marks the rows it brought in, not the rows already drawn (Issue #1697)', async () => {
    const page = await open();
    try {
      const before = new Set(await page.evaluate(() => [...document.querySelectorAll('.wv-grid tbody tr.entity-row')].map((tr) => tr.dataset.eid)));
      await spy(page);
      await page.mouse.move(700, 500);
      await page.mouse.wheel(0, 3000);
      await page.waitForFunction((ids) => [...document.querySelectorAll('.wv-grid tbody tr.entity-row')].some((tr) => !ids.includes(tr.dataset.eid)), [...before]);
      await frames(page);
      await frames(page);
      const touched = await reads(page);
      const after = await page.evaluate(() => [...document.querySelectorAll('.wv-grid tbody tr.entity-row')].map((tr) => tr.dataset.eid));
      const fresh = after.filter((id) => !before.has(id));
      assert.ok(fresh.length > 0, 'the scroll drew new rows');
      for (const id of fresh) assert.ok(touched[id] > 0, `new row ${id} was marked`);
      const stayed = Object.keys(touched).filter((id) => before.has(id));
      assert.deepEqual(stayed, [], `rows already drawn were not walked again, got ${stayed.length}`);
    } finally { await page.close(); }
  });
}
