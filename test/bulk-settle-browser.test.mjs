/* A bulk state change on eight rows settles in a few hundred milliseconds
   (Issue #426). Kyle, on uno's Task table in Safari, v0.4.43: "very slow
   change state of 8 records". The report's trace put every request of that
   session at seconds, /api/health included (3.3 s), and the bulk write never
   came back inside the 87 s it covers, so the time was the server's queue.
   Measured on the same shape on a quiet server, at v0.4.43 and v0.4.51, the
   whole gesture settles in 44 to 174 ms: one POST /api/bulk (18 ms on a copy
   of uno's own Task table) and one page read.

   This suite holds that shape so the slowness cannot come back from the
   client side: the gesture is ONE bulk write and ONE page re-read (never a
   write per row, never a schema reload, never a read of every page), and the
   eight rows leave the Open-filtered grid, toast said, inside the budget.
   The table is uno's Task, field for field: a five-state workflow, three
   documents, two relations, the Standard view's six columns and its State =
   Open filter, 104 rows, in a workspace of about 2,300 rows.

   Playwright is NOT a dependency of weave (house rule: zero runtime deps);
   the suite skips when it is absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

// Click to settled, measured inside the page. Idle it is under 200 ms; the
// rest is room for a loaded gate, where scripts/test.mjs also retries once.
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
  // The rest of the workspace's weight: twelve more tables, 2,100 rows.
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

      // From here on, every request the gesture costs, and the page's own clock.
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

      // And it landed: the eight are Done, the grid's Open filter let them go.
      const done = await page.evaluate(async (t) => {
        const r = await fetch(`/api/tables/${t}/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ where: [['State', '=', 'Done']] }) });
        return (await r.json()).total;
      }, task.id);
      assert.equal(done, 8);
    } finally { await page.close(); }
  });
}
