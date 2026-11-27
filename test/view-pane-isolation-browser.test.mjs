import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { seedTasks, resetTasks, useCover } from './lib/view-pane-tasks.mjs';
import { trackWrites, isolated, violations } from './lib/view-isolation.mjs';
import { human } from './lib/human.mjs';
import { paneOnLoad, tableDrawn } from './lib/view-pane.mjs';

const RULED = {
  'group-moves-sort': { by: 'Feature #340', what: 'a field added to Group leaves Sort, and the Sort section says so' },
  'manual-clears-sort': { by: 'Feature #352', what: 'the board footer Manual link sets Manual order, which is no Sort' },
  'shared-fields': { by: 'Feature #352', what: 'Board and Table read one Fields list per view, so a layout switch keeps the columns' },
  'escape-keeps-pane': { by: 'Feature #340', what: 'Escape does not close the View pane' },
  'first-view-opens': { by: 'Issue #443', what: 'a table reopens on its first view' },
  'hold-to-delete': { by: 'Feature #346', what: 'a view row deletes on a press and hold' },
};

const chip = (field, value) => `#view-pane .filter-group[aria-label="${field}"] .filter-chip:has(.filter-chip-label:text-is("${value}"))`;
const seg = (key) => `#view-pane [data-vp-key="${key}"]`;
const group = (i, act) => `#view-pane [data-vp-key="group:${i}:${act}"]`;
const sort = (i, act) => `#view-pane [data-vp-key="sort:${i}:${act}"]`;
const fieldBox = (name) => `#view-pane .table-field-row[data-field="${name}"] .eye-row`;
const preset = (name) => `#view-pane .board-preset:text-is("${name}")`;
const boardSeg = (row, label) => `#view-pane .${row} .seg-opt:text-is("${label}")`;
const fold = '#main tr.group-head .group-fold';
const pick = async (h, face, label) => { await h.click(face); await h.pick(label); };

const TABLE = [
  { id: 'filters: a select chip', section: 'filters', keys: ['filters'], act: (h) => h.click(chip('Workstream', 'Home')) },
  { id: 'filters: a workflow chip', section: 'filters', keys: ['filters'], act: (h) => h.click(chip('State', 'Done')) },
  { id: 'filters: a multiselect chip', section: 'filters', keys: ['filters'], act: (h) => h.click(chip('Tags', 'chore')) },
  { id: 'filters: Clear all', section: 'filters', keys: ['filters'], act: (h) => h.click('#view-pane .filter-clear') },
  { id: 'filters: Include deleted', section: 'filters', keys: ['deleted'], act: (h) => h.click('#view-pane label.vp-switch[data-deleted]') },
  { id: 'sort: add a level', section: 'sort', keys: ['sort'], act: async (h) => { await h.click('#view-pane .sort-add'); await h.pick('Captured'); } },
  { id: 'sort: direction', section: 'sort', keys: ['sort'], act: (h) => h.click(sort(0, 'dir:Newest to oldest')) },
  { id: 'sort: change a level field', section: 'sort', keys: ['sort'], act: (h) => pick(h, '#view-pane .sort-level:nth-child(1) .picker-face', 'Captured') },
  { id: 'sort: move a level up', section: 'sort', keys: ['sort'], act: (h) => h.click(sort(1, 'sort-up')) },
  { id: 'sort: move a level down', section: 'sort', keys: ['sort'], act: (h) => h.click(sort(0, 'sort-down')) },
  { id: 'sort: remove a level', section: 'sort', keys: ['sort'], act: (h) => h.click(sort(1, 'sort-remove')) },
  { id: 'group: date grain', section: 'group', keys: ['group'], seed: { Work: { group: [{ field: 'Workstream' }, { field: 'Captured' }, { field: 'Project' }] } }, act: (h) => pick(h, '#view-pane .group-grain .picker-face', 'By week') },
  { id: 'group: Chip heading', section: 'group', keys: ['group'], seed: { Work: { group: [{ field: 'Workstream' }, { field: 'Captured' }, { field: 'Project' }] } }, act: (h) => h.click('#view-pane .group-heading .seg-opt:text-is("Chip")') },
  { id: 'group: move a level down', section: 'group', keys: ['group'], seed: { Work: { group: [{ field: 'Workstream' }, { field: 'Captured' }, { field: 'Project' }] } }, act: (h) => h.click(group(0, 'group-down')) },
  { id: 'group: move a level up', section: 'group', keys: ['group'], seed: { Work: { group: [{ field: 'Workstream' }, { field: 'Captured' }, { field: 'Project' }] } }, act: (h) => h.click(group(2, 'group-up')) },
  { id: 'group: add a level', section: 'group', keys: ['group'], act: async (h) => { await h.click('#view-pane .group-add'); await h.pick('State'); } },
  { id: 'group: add a sorted field', section: 'group', keys: ['group'], ruled: ['group-moves-sort'], allow: ['sort'], act: async (h) => { await h.click('#view-pane .group-add'); await h.pick('Due'); } },
  { id: 'group: direction', section: 'group', keys: ['group'], act: (h) => h.click(group(0, 'dir:Reversed')) },
  { id: 'group: direction keeps folded groups', section: 'group', keys: ['group'], seed: { Work: { collapsed: ['Home', 'Startup'] } }, act: (h) => h.click(group(0, 'dir:Reversed')) },
  { id: 'group: change a level field', section: 'group', keys: ['group'], act: (h) => pick(h, '#view-pane .group-level:nth-child(1) .picker-face', 'Assignee') },
  { id: 'group: remove a level', section: 'group', keys: ['group'], act: (h) => h.click(group(0, 'group-remove')) },
  { id: 'group: Collapse all', section: 'group', keys: ['collapsed'], act: (h) => h.click('#view-pane .vp-collapse-all') },
  { id: 'group: Expand all', section: 'group', keys: ['collapsed'], seed: { Work: { collapsed: ['Home'] }, Triage: { collapsed: ['Home'] } }, act: (h) => h.click('#view-pane .vp-expand-all') },
  { id: 'group: fold one group in the grid', section: 'group', keys: ['collapsed'], act: (h) => h.click(fold) },
  { id: 'fields: hide a field', section: 'fields', keys: ['fields'], act: (h) => h.click(fieldBox('Due')) },
  { id: 'fields: show a hidden field', section: 'fields', keys: ['fields'], act: (h) => h.click(fieldBox('Spec')) },
  { id: 'fields: Show all', section: 'fields', keys: ['fields'], act: (h) => h.click('#view-pane .btn:text-is("Show all")') },
  { id: 'fields: Hide all', section: 'fields', keys: ['fields'], act: (h) => h.click('#view-pane .btn:text-is("Hide all")') },
  { id: 'display: density', section: 'display', keys: ['density'], act: (h) => h.click(seg('density:Comfortable')) },
  { id: 'display: layout Board', section: 'display', keys: ['layout'], ruled: ['shared-fields'], act: (h) => h.click(seg('layout:Board')) },
  { id: 'display: Rollups off', section: 'display', keys: ['rollups'], act: (h) => h.click('#view-pane label.vp-switch[data-rollups]') },
  { id: 'display: Subtotals', section: 'display', keys: ['subtotals'], act: (h) => h.click(seg('subtotals:Every level')) },
  { id: 'display: a per-column total', section: 'display', keys: [], todo: 'Issue #1910', act: (h) => h.click('#view-pane .vp-agg .foot-row') },
  { id: 'views: switch to another view', section: 'filters', keys: [], writes: false, act: async (h, page) => {
    await h.click('#view-pane .vp-view-pick');
    await h.click(page.locator('.view-strip .view-row').filter({ has: page.locator('.view-name', { hasText: /^Triage$/ }) }));
    await page.waitForFunction(() => document.querySelector('#view-pane .vp-view-name')?.textContent === 'Triage');
  } },
];

const BOARD = [
  { id: 'filters: a select chip', section: 'filters', keys: ['filters'], act: (h) => h.click(chip('Workstream', 'Home')) },
  { id: 'filters: Include deleted', section: 'filters', keys: ['deleted'], act: (h) => h.click('#view-pane label.vp-switch[data-deleted]') },
  { id: 'filters: Clear all', section: 'filters', keys: ['filters'], act: (h) => h.click('#view-pane .filter-clear') },
  { id: 'sort: add a level', section: 'sort', keys: ['sort'], act: async (h) => { await h.click('#view-pane .sort-add'); await h.pick('Captured'); } },
  { id: 'sort: direction', section: 'sort', keys: ['sort'], act: (h) => h.click(sort(0, 'dir:Z to A')) },
  { id: 'sort: remove a level', section: 'sort', keys: ['sort'], act: (h) => h.click(sort(0, 'sort-remove')) },
  { id: 'group: add swimlanes', section: 'group', keys: ['group'], act: async (h) => { await h.click('#view-pane .group-add'); await h.pick('Workstream'); } },
  { id: 'group: direction', section: 'group', keys: ['group'], act: (h) => h.click(group(0, 'dir:Reversed')) },
  { id: 'group: remove a level', section: 'group', keys: ['group'], act: (h) => h.click(group(0, 'group-remove')) },
  { id: 'group: Collapse all', section: 'group', keys: ['collapsed'], act: (h) => h.click('#view-pane .vp-collapse-all') },
  { id: 'group: Expand all', section: 'group', keys: ['collapsed'], seed: { Kanban: { collapsed: ['Open'] } }, act: (h) => h.click('#view-pane .vp-expand-all') },
  { id: 'group: fold one column', section: 'group', keys: ['collapsed'], act: (h) => h.click('#main .board-group-head .list-fold') },
  { id: 'group: Hide empty groups', section: 'group', keys: ['hideEmpty'], act: (h) => h.click('#view-pane label.vp-switch[data-hide-empty]') },
  { id: 'fields: hide a field', section: 'fields', keys: ['fields'], act: (h) => h.click(fieldBox('Due')) },
  { id: 'fields: show a hidden field', section: 'fields', keys: ['fields'], act: (h) => h.click(fieldBox('Spec')) },
  { id: 'fields: Show all', section: 'fields', keys: ['fields'], act: (h) => h.click('#view-pane .btn:text-is("Show all")') },
  { id: 'display: layout Table', section: 'display', keys: ['layout'], ruled: ['shared-fields'], act: (h) => h.click(seg('layout:Table')) },
  { id: 'display: density', section: 'display', keys: ['density'], act: (h) => h.click(seg('density:Spacious')) },
  { id: 'display: Start from Columns', section: 'display', keys: ['groups', 'group'], todo: 'Issue #1908', act: (h) => h.click(preset('Columns')) },
  { id: 'display: Start from Gallery', section: 'display', keys: ['groups', 'picture'], act: (h) => h.click(preset('Gallery')) },
  { id: 'display: Groups stacked', section: 'display', keys: ['groups'], act: (h) => h.click(boardSeg('board-groups', 'Stacked')) },
  { id: 'display: Picture', section: 'display', keys: ['picture'], act: (h) => h.click(boardSeg('board-picture', 'Small')) },
  { id: 'display: Fit', section: 'display', keys: ['fit'], cover: true, seed: { Kanban: { picture: 'small' } }, act: (h) => h.click(boardSeg('board-fit', 'Original')) },
  { id: 'display: Card shape', section: 'display', keys: ['frame'], cover: true, seed: { Kanban: { picture: 'small' } }, act: (h) => h.click(boardSeg('board-frame', '1:1')) },
  { id: 'display: Uneven cards', section: 'display', keys: ['flow'], cover: true, seed: { Kanban: { picture: 'small', fit: 'original' } }, act: (h) => h.click(boardSeg('board-flow', 'Rows')) },
  { id: 'board footer: Manual', section: 'sort', keys: ['sort'], ruled: ['manual-clears-sort'], act: (h) => h.click('#main .board-manual') },
];

const s = await launch('every View pane control changes only its own setting', (w) => seedTasks(w));

if (s) {
  const { base, browser, weave, tasks } = s;
  const run = async (layout, c) => {
    resetTasks(weave, tasks.id);
    if (c.cover) useCover(weave, tasks.id, true);
    for (const [name, patch] of Object.entries(c.seed ?? {})) weave.tableView(`${tasks.id}/${name}`, patch);
    const view = layout === 'board' ? 'Kanban' : 'Work';
    const id = weave.tableView(tasks.id).views.find((v) => v.name === view).id;
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await trackWrites(page);
      await paneOnLoad(page, c.section);
      await page.goto(`${base}/#/table/${tasks.id}/view/${id}`, { waitUntil: 'networkidle' });
      await tableDrawn(page);
      await page.waitForSelector(`#view-pane #vp-body-${c.section}`);
      const h = human(page);
      const { diff } = await isolated(page, { base, tableId: tasks.id, act: () => c.act(h, page), writes: c.writes !== false });
      assert.deepEqual(violations(diff, { view, keys: c.keys, allow: c.allow }), []);
    } finally { await page.close(); }
  };
  test('every ruled coupling names the Feature or Issue that ruled it, and every case cites a ruled one by name', () => {
    for (const [k, r] of Object.entries(RULED)) assert.match(r.by, /^(Feature|Issue) #\d+$/, k);
    for (const c of [...TABLE, ...BOARD]) for (const r of c.ruled ?? []) assert.ok(RULED[r], `${c.id} cites ${r}`);
    for (const c of [...TABLE, ...BOARD]) if (c.allow?.length) assert.ok(c.ruled?.length, `${c.id}: an allowed extra key needs a ruling`);
  });

  for (const [layout, cases] of [['table', TABLE], ['board', BOARD]]) {
    for (const c of cases) {
      test(`${layout} · ${c.id} changes only ${c.keys.join(' and ') || 'nothing stored'}${c.todo ? ` (${c.todo})` : ''}`, c.todo ? { todo: c.todo } : {}, () => run(layout, c));
    }
  }
}
