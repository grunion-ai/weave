export const BUDGET_FILE = 'test/view-pane-click-budget.json';

const chip = (field, value) => `#view-pane .filter-group[aria-label="${field}"] .filter-chip:has(.filter-chip-label:text-is("${value}"))`;
const acc = (section) => `#view-pane .vp-acc[data-section="${section}"]`;
const written = (page, test) => page.waitForFunction(test, null, { polling: 'raf' });

async function levels(h, page, kind, fields) {
  await h.click(acc(kind));
  for (const f of fields) {
    await h.click(`#view-pane .${kind}-add`);
    await h.pick(f);
    await page.waitForSelector(`#view-pane .${kind}-level[data-level="${f}"]`);
  }
}

export const GOALS = [
  {
    name: 'create a view',
    async run(page, h) {
      await h.click('#main .table-view-btn');
      await h.click('#view-pane .vp-view-pick');
      await h.click('#view-pane .view-add');
      await page.keyboard.type('This week');
      await page.keyboard.press('Enter');
      await written(page, () => document.querySelector('#view-pane .vp-view-name')?.textContent === 'This week');
    },
  },
  {
    name: 'filter one value',
    async run(page, h) {
      await h.click('#main .table-view-btn');
      await h.click(chip('Workstream', 'Home'));
      await written(page, () => document.querySelector('#main .table-view-btn .view-count')?.textContent === '1');
    },
  },
  {
    name: 'three sort levels',
    async run(page, h) {
      await h.click('#main .table-view-btn');
      await levels(h, page, 'sort', ['Due', 'Captured', 'Name']);
    },
  },
  {
    name: 'five group levels',
    async run(page, h) {
      await h.click('#main .table-view-btn');
      await levels(h, page, 'group', ['State', 'Workstream', 'Assignee', 'Visibility', 'Tags']);
    },
  },
  {
    name: 'kanban by State',
    async run(page, h) {
      await h.click('#main .table-view-btn');
      await levels(h, page, 'group', ['State']);
      await h.click(acc('display'));
      await h.click('#view-pane [data-vp-key="layout:Board"]');
      await page.waitForSelector('#view-pane .board-preset');
      await h.click('#view-pane .board-preset:text-is("Columns")');
      await written(page, () => document.querySelector('#view-pane .board-groups .seg-opt.on')?.textContent === 'Side by side' && document.querySelectorAll('#main .board-group-head').length === 5);
    },
  },
  {
    name: 'first rollup total',
    async run(page, h) {
      await h.click('#main .table-view-btn');
      await h.click(acc('display'));
      await h.click('#view-pane label.vp-switch[data-rollups]');
      await page.waitForSelector('#view-pane .vp-agg[data-col="Name"] .foot-row[data-agg="count"]');
      await h.click('#view-pane .vp-agg[data-col="Name"] .foot-row[data-agg="count"]');
      await page.waitForSelector('#main .foot-stat');
    },
  },
  {
    name: 'switch views',
    async run(page, h) {
      await h.click('#main .table-view-btn');
      await h.click('#view-pane .vp-view-pick');
      await h.click(page.locator('.view-strip .view-row').filter({ has: page.locator('.view-name', { hasText: /^Triage$/ }) }));
      await written(page, () => document.querySelector('#view-pane .vp-view-name')?.textContent === 'Triage');
    },
  },
  {
    name: 'reset a view',
    view: 'Work',
    async run(page, h) {
      await h.click('#main .table-view-btn');
      await h.click('#view-pane .view-reset');
      await written(page, () => !document.querySelector('#main tr.group-head'));
    },
  },
];
