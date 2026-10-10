import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tasks, projects;
const s = await launch('header route', (weave) => {
  weave.createSpace({ name: 'Product' });
  projects = weave.createTable({ space: 'Product', name: 'Project' });
  tasks = weave.createTable({ space: 'Product', name: 'Task' });
  weave.addField(tasks, { name: 'Estimate', type: 'number' });
  weave.addRelation(tasks, { name: 'Project', targetDb: projects, cardinality: 'many-to-one', inverseName: 'Tasks' });
  weave.addField(tasks, { name: 'Project name', type: 'lookup', config: { relationField: 'Project', targetField: 'Name' } });
  weave.addField(tasks, { name: 'Double', type: 'formula', config: { expression: 'Estimate * 2' } });
  weave.addField(projects, { name: 'Total estimate', type: 'rollup', config: { relationField: 'Tasks', targetField: 'Estimate', aggregate: 'sum' } });
  const p = weave.createEntity(projects, { name: 'Launch' });
  weave.createEntity(tasks, { name: 'Brief', values: { Estimate: 3, Project: p.id } });
});

if (s) {
  const { base, browser } = s;
  const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const marks = (page) => page.locator('.wv-grid thead th.col-head').evaluateAll((ths) => Object.fromEntries(ths.map((th) => {
    const m = th.querySelector('.col-label .field-mark');
    return [th.dataset.col, m && { title: m.getAttribute('title'), icon: !!m.querySelector('svg, .ico') || m.textContent.trim() !== '', color: getComputedStyle(m).color }];
  })));
  async function grid(tableId, colorScheme) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 700 }, colorScheme });
    await page.goto(`${base}/#/table/${tableId}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await settle(page);
    return page;
  }

  for (const colorScheme of ['light', 'dark']) {
    test(`a relation, lookup, rollup and formula header each name where the value comes from (${colorScheme})`, async () => {
      const page = await grid(tasks.id, colorScheme);
      try {
        const m = await marks(page);
        assert.equal(m.Estimate, null, 'a plain field wears no mark');
        assert.equal(m.Project?.title, '→ Product/Project', 'the relation header names its target table');
        assert.ok(m.Project.icon, 'the relation header carries its own mark');
        assert.equal(m['Project name']?.title, '↳ Name via Project → Product/Project', 'the lookup names the field, the relation and the table');
        assert.equal(m.Double?.title, 'formula — computed from other values, not editable', 'the formula tooltip is unchanged');
        assert.equal(m.Project.color, m.Double.color, 'the relation mark spends no colour of its own');
        assert.equal((await page.locator('.wv-grid thead th.col-head[data-col="Project"] .col-label').textContent()).trim().startsWith('Project'), true);
      } finally {
        await page.close();
      }
      const other = await grid(projects.id, colorScheme);
      try {
        const m = await marks(other);
        assert.equal(m['Total estimate']?.title, 'Σ sum of Estimate via Tasks → Product/Task', 'the rollup names the aggregate, the field, the relation and the table');
        assert.equal(m.Tasks?.title, '→ Product/Task, many', 'the many side says so');
      } finally {
        await other.close();
      }
    });
  }
}
