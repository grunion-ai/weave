import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { seedTasks, resetTasks } from './lib/view-pane-tasks.mjs';
import { trackWrites, quiet, writesSoFar } from './lib/view-isolation.mjs';
import { paneOnLoad, tableDrawn } from './lib/view-pane.mjs';

const s = await launch('the View pane keeps keyboard focus across its redraws', (w) => seedTasks(w));

const CASES = [
  { what: 'the Rollups switch', section: 'display', target: '#view-pane label.vp-switch[data-rollups] input', key: 'Space' },
  { what: 'Collapse all', section: 'group', target: '#view-pane .vp-collapse-all', key: 'Enter' },
  { what: 'Expand all', section: 'group', target: '#view-pane .vp-expand-all', key: 'Enter' },
  { what: 'a Fields checkbox', section: 'fields', target: '#view-pane .table-field-row[data-field="Due"] input', key: 'Space' },
  { what: 'Hide empty groups on a board', view: 'Kanban', section: 'group', target: '#view-pane label.vp-switch[data-hide-empty] input', key: 'Space' },
  { what: 'the board Groups control', view: 'Kanban', section: 'display', target: '#view-pane .board-groups .seg-opt:text-is("Stacked")', key: 'Enter' },
  { what: 'the Columns preset', view: 'Kanban', section: 'display', target: '#view-pane .board-preset:text-is("Columns")', key: 'Enter' },
  { what: 'a filter chip', section: 'filters', target: '#view-pane .filter-group[aria-label="Workstream"] .filter-chip:has(.filter-chip-label:text-is("Home")) input', key: 'Space' },
];

if (s) {
  const { base, browser, weave, tasks } = s;
  for (const c of CASES) {
    test(`${c.what}: after the save redraws the pane, focus is back on the control (Issue #1922)`, async () => {
      resetTasks(weave, tasks.id);
      const id = weave.tableView(tasks.id).views.find((v) => v.name === (c.view ?? 'Work')).id;
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      try {
        await trackWrites(page);
        await paneOnLoad(page, c.section);
        await page.goto(`${base}/#/table/${tasks.id}/view/${id}`, { waitUntil: 'networkidle' });
        await tableDrawn(page);
        await page.locator(c.target).first().focus();
        const n = await writesSoFar(page);
        await page.keyboard.press(c.key);
        await quiet(page, { after: n });
        const same = await page.evaluate(() => {
          const at = document.activeElement;
          return { body: at === document.body, inPane: !!at?.closest('#view-pane'), tag: `${at?.tagName.toLowerCase()}.${[...(at?.classList ?? [])].join('.')}` };
        });
        assert.equal(same.body, false, 'focus is not dropped to the page body');
        assert.ok(same.inPane, `focus stays in the pane: ${same.tag}`);
        assert.equal(await page.locator(c.target).first().evaluate((n) => n === document.activeElement), true, `focus is on ${c.what}, not ${same.tag}`);
      } finally { await page.close(); }
    });
  }
}
