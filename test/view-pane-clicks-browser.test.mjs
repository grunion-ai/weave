import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch } from './lib/browser.mjs';
import { seedTasks, resetTasks } from './lib/view-pane-tasks.mjs';
import { GOALS, BUDGET_FILE } from './lib/view-pane-goals.mjs';
import { countClicks, judge } from './lib/clicks.mjs';
import { tableDrawn } from './lib/view-pane.mjs';
import { human } from './lib/human.mjs';

const { clicks: budget } = JSON.parse(readFileSync(new URL('./view-pane-click-budget.json', import.meta.url), 'utf8'));

const s = await launch('View pane click budget', (w) => seedTasks(w));

if (s) {
  const { base, browser, weave, tasks } = s;
  for (const goal of GOALS) {
    test(`${goal.name}: real mouse clicks from a closed pane stay within the budget`, async (t) => {
      resetTasks(weave, tasks.id);
      const view = weave.tableView(tasks.id).views.find((v) => v.name === (goal.view ?? 'Standard'));
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      try {
        const clicks = await countClicks(page);
        await page.goto(`${base}/#/table/${tasks.id}/view/${view.id}`, { waitUntil: 'networkidle' });
        await tableDrawn(page);
        clicks.reset();
        await goal.run(page, human(page));
        t.diagnostic(`clicks ${goal.name} ${clicks.count} budget ${budget[goal.name] ?? 'none'}`);
        assert.equal(judge(goal.name, clicks.count, budget, BUDGET_FILE), null, judge(goal.name, clicks.count, budget, BUDGET_FILE) ?? '');
      } finally { await page.close(); }
    });
  }
}
