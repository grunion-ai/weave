import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const BUDGET_MS = 600;

let task;
const s = await launch('bulk state change settles', (weave) => {
  weave.createSpace({ name: 'Product' });
  weave.createSpace({ name: 'People' });
  const person = weave.createTable({ space: 'People', name: 'Person' });
  const project = weave.createTable({ space: 'Product', name: 'Project' });
  task = weave.createTable({ space: 'Product', name: 'Task' });
  weave.addField(task, { name: 'State', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true }, { name: 'In Progress', category: 'in-progress' },
    { name: 'Review', category: 'in-progress' }, { name: 'Done', category: 'done' }, { name: 'Canceled', category: 'canceled' }] } });
  weave.addField(task, { name: 'Due', type: 'date' });
  weave.addField(task, { name: 'Priority', type: 'select', config: { options: ['P0', 'P1', 'P2', 'P3'] } });
  weave.addField(task, { name: 'Tags', type: 'multiselect', config: { options: ['a', 'b'] } });
  weave.addRelation(task, { name: 'Project', targetDb: project, cardinality: 'many-to-one', inverseName: 'Tasks' });
  weave.addField(task, { name: 'Spec', type: 'document' });
  weave.addRelation(task, { name: 'Assignee', targetDb: person, cardinality: 'many-to-one', inverseName: 'Tasks' });
  weave.addField(task, { name: 'Workstream', type: 'select', config: { options: ['Work', 'Home'] } });
  weave.addField(task, { name: 'Fibery', type: 'url' });
  const people = Array.from({ length: 8 }, (_, i) => weave.createEntity(person, { name: `Person ${i}` }));
  const projects = Array.from({ length: 20 }, (_, i) => weave.createEntity(project, { name: `Project ${i}` }));
  for (let t = 0; t < 12; t++) {
    const other = weave.createTable({ space: 'Product', name: `Other ${t}` });
    for (let i = 0; i < 175; i++) weave.createEntity(other, { name: `row ${t}.${i}`, doc: 'Body text. '.repeat(30) });
  }
  for (let i = 0; i < 104; i++) {
    weave.createEntity(task, {
      name: `Task ${i}`,
      values: { Priority: `P${i % 4}`, Tags: ['a'], Project: projects[i % 20].id, Assignee: people[i % 8].id, Workstream: 'Work', Fibery: `https://example.com/${i}` },
      doc: 'Task description paragraph. '.repeat(20),
    });
  }
  weave.updateTable(task, { hiddenFields: ['Priority', 'Project', 'Spec', 'Assignee', 'Workstream'], filters: { State: ['Open'] } });
});

if (s) {
  const { base, browser } = s;

  test('Set a field… → State → Done on eight rows is one write and one read, settled inside the budget', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${task.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      const boxes = page.locator('.wv-grid tbody .sel-box');
      for (let i = 0; i < 8; i++) await boxes.nth(i).check();
      const picked = await page.evaluate(() =>
        [...document.querySelectorAll('.wv-grid tbody .sel-box:checked')].map((b) => b.closest('tr').dataset.eid));
      assert.equal(picked.length, 8);
      await page.locator('.sel-puck .sel-act[aria-label="Set a field…"]').click();
      await page.locator('.picker-pop .picker-row', { hasText: 'State' }).first().click();
      await page.waitForSelector('.picker-pop .picker-search:focus');

      const calls = [];
      page.on('request', (r) => { if (r.url().includes('/api/')) calls.push(`${r.method()} ${new URL(r.url()).pathname}`); });
      await page.evaluate((ids) => {
        window.__settle = { click: null, done: null };
        addEventListener('click', (e) => {
          if (window.__settle.click == null && e.target.closest('.picker-pop')) window.__settle.click = performance.now();
        }, true);
        const check = () => {
          const gone = ids.every((id) => !document.querySelector(`.wv-grid tbody tr.entity-row[data-eid="${id}"]`));
          const said = /Set 8 /.test(document.querySelector('#wv-toasts')?.textContent ?? '');
          if (window.__settle.click != null && gone && said) window.__settle.done = performance.now();
          else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      }, picked);

      await page.locator('.picker-pop .picker-row', { hasText: 'Done' }).first().click();
      await page.waitForFunction(() => window.__settle.done != null, null, { timeout: 15000 });
      const ms = await page.evaluate(() => window.__settle.done - window.__settle.click);
      await page.waitForLoadState('networkidle');

      const bulk = calls.filter((c) => c.endsWith('/api/bulk'));
      const reads = calls.filter((c) => /\/api\/tables\/[^/]+\/query$/.test(c));
      assert.deepEqual(bulk, ['POST /api/bulk'], `one bulk write for eight rows, not one per row: ${calls.join(', ')}`);
      assert.equal(reads.length, 1, `one page re-read after the write: ${calls.join(', ')}`);
      assert.deepEqual(calls.filter((c) => !bulk.includes(c) && !reads.includes(c)), [],
        'no schema reload, no per-row PATCH, no trash read');
      assert.ok(ms < BUDGET_MS, `settled in ${Math.round(ms)} ms; the budget is ${BUDGET_MS} ms`);

      const done = await page.evaluate(async (t) => {
        const r = await fetch(`/api/tables/${t}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ where: [['State', '=', 'Done']] }) });
        return (await r.json()).total;
      }, task.id);
      assert.equal(done, 8);
    } finally { await page.close(); }
  });
}
