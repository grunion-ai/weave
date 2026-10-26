import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { openPane } from './lib/view-pane.mjs';
let jobs, row;
const s = await launch('view pane sits rightmost with gutter-width gaps', (weave) => {
  weave.createSpace({ name: 'Ops' });
  jobs = weave.createTable({ space: 'Ops', name: 'Job' });
  weave.addField(jobs, { name: 'Cost', type: 'number' });
  row = weave.createEntity(jobs, { name: 'A', values: { Cost: 1 } });
  weave.createEntity(jobs, { name: 'B', values: { Cost: 2 } });
});
if (s) {
  const { base, browser } = s;
  const GAP = 16;
  const box = (page, sel) => page.$eval(sel, (e) => { const b = e.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right) }; });
  const open = async (hash) => {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await openPane(page, 'filters');
    return page;
  };
  test('alone with the main panel the pane keeps the gutter gap (Feature #340)', async () => {
    const page = await open(`#/table/${jobs.id}`);
    try {
      const [main, pane] = await Promise.all([box(page, '#main'), box(page, '#view-pane')]);
      assert.equal(pane.left - main.right, GAP);
      assert.equal(await page.evaluate(() => innerWidth - document.querySelector('#view-pane').getBoundingClientRect().right), 8);
    } finally { await page.close(); }
  });
  test('with an entity docked the pane sits right of the entity pane, both gaps gutter-wide (Feature #340)', async () => {
    const page = await open(`#/table/${jobs.id}?e=${row.id}`);
    try {
      await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
      const [main, dock, pane] = await Promise.all([box(page, '#main'), box(page, '#dock'), box(page, '#view-pane')]);
      assert.ok(pane.left >= dock.right, `pane ${pane.left} starts after the entity pane ends ${dock.right}`);
      assert.equal(dock.left - main.right, GAP);
      assert.equal(pane.left - dock.right, GAP);
    } finally { await page.close(); }
  });
  test('with the context pane open too the view pane is still last (Feature #340)', async () => {
    const page = await open(`#/table/${jobs.id}?e=${row.id}`);
    try {
      await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
      await page.click('#dock .activity-btn');
      await page.waitForSelector('#side:not([hidden]) aside.wv-activity');
      const [dock, side, pane] = await Promise.all([box(page, '#dock'), box(page, '#side'), box(page, '#view-pane')]);
      assert.equal(side.left - dock.right, GAP);
      assert.ok(pane.left >= side.right, `pane ${pane.left} starts after the context pane ends ${side.right}`);
      assert.equal(pane.left - side.right, GAP);
    } finally { await page.close(); }
  });
}
