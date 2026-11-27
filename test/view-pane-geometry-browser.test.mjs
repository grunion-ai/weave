import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { seedTasks, resetTasks, spacesTable, useCover } from './lib/view-pane-tasks.mjs';
import { tableDrawn, paneOnLoad } from './lib/view-pane.mjs';
import { covering } from './lib/human.mjs';

const ONE_ROW = 64;

const s = await launch('View pane results: group heads, totals, empty views, covered controls', (w) => seedTasks(w));

if (s) {
  const { base, browser, weave, tasks } = s;
  const open = async (name, patch = {}, { height = 900, section = null, count = false } = {}) => {
    resetTasks(weave, tasks.id);
    if (count) weave.addField(spacesTable(weave).id, { name: 'Tasks · count', type: 'rollup', config: { via: tasks.id, aggregate: 'count' } });
    weave.tableView(`${tasks.id}/${name}`, patch);
    const id = weave.tableView(tasks.id).views.find((v) => v.name === name).id;
    const page = await browser.newPage({ viewport: { width: 1440, height } });
    if (section) await paneOnLoad(page, section);
    await page.goto(`${base}/#/table/${tasks.id}/view/${id}`, { waitUntil: 'networkidle' });
    await tableDrawn(page);
    if (section) await page.waitForSelector(`#view-pane #vp-body-${section}`);
    return page;
  };
  const shown = (view, where = null) => weave.query(tasks.id, { view, ...(where ? { where } : {}) }).items.filter((e) => !e.deletedAt).length;

  const HEADS = [
    ['a select', [{ field: 'Workstream' }]],
    ['a workflow', [{ field: 'State' }]],
    ['a multiselect', [{ field: 'Tags' }]],
    ['a date', [{ field: 'Captured', grain: 'week' }]],
    ['a relation with the Label heading', [{ field: 'Project', heading: 'label' }]],
    ['a relation with the Chip heading', [{ field: 'Project', heading: 'chip' }]],
  ];
  for (const [what, group, todo] of HEADS) {
    test(`a group head for ${what} stays one row tall${todo ? ` (${todo})` : ''}`, todo ? { todo } : {}, async () => {
      const page = await open('Standard', { group });
      try {
        await page.waitForSelector('#main tr.group-head');
        const heights = await page.locator('#main tr.group-head').evaluateAll((rows) => rows.map((r) => Math.round(r.getBoundingClientRect().height)));
        assert.ok(heights.length > 1, 'the view draws its groups');
        assert.ok(Math.max(...heights) <= ONE_ROW, `tallest group head is ${Math.max(...heights)} px, one row is ${ONE_ROW}`);
      } finally { await page.close(); }
    });
  }

  const footCount = (page, sel) => page.locator(sel).first().evaluate((n) => Number(n.textContent.replace(/[^\d]/g, '')));
  const TOTALS = [
    ['an ungrouped filtered view', 'Standard', { filters: { Workstream: ['Home', 'Startup'] }, rollups: true }],
    ['an ungrouped view whose filter matches nothing', 'Standard', { filters: { Assignee: ['Guest'] }, rollups: true }],
    ['a grouped filtered view', 'Work', { subtotals: 'top' }],
    ['a grouped view whose filter matches nothing', 'Work', { filters: { Assignee: ['Guest'] } }],
  ];
  for (const [what, name, patch, todo] of TOTALS) {
    test(`the total row of ${what} counts the rows the view shows${todo ? ` (${todo})` : ''}`, todo ? { todo } : {}, async () => {
      const page = await open(name, patch, { height: 4000, count: true });
      try {
        const grouped = !!weave.tableView(`${tasks.id}/${name}`).group;
        const cell = grouped ? '#main tr.group-sum.grand td[data-col="Name"] .foot-val' : '#main tr.wv-foot td.foot-cell[data-col="Name"] .foot-val';
        await page.waitForSelector(cell);
        const want = shown(weave.tableView(`${tasks.id}/${name}`).id);
        assert.equal(await page.locator('#main tr.entity-row').count(), want, 'the grid draws every row the view holds');
        assert.equal(await footCount(page, cell), want);
      } finally { await page.close(); }
    });
  }

  for (const layout of ['table', 'board']) {
    test(`a ${layout} whose filter matches nothing says so (Issue #1913)`, { todo: 'Issue #1913' }, async () => {
      const page = await open('Standard', { filters: { Assignee: ['Guest'] }, layout: layout === 'board' ? 'board' : null });
      try {
        await page.waitForSelector(layout === 'board' ? '#main .board-wrap' : '#main .wv-grid');
        const text = await page.locator('#main').innerText();
        assert.match(text, /No tasks match/i);
        assert.doesNotMatch(text, /Drop a card here/);
      } finally { await page.close(); }
    });
  }

  for (const [view, layout] of [['Work', 'table'], ['Kanban', 'board']]) {
    for (const section of ['filters', 'sort', 'group', 'fields', 'display']) {
      test(`on a ${layout}, no ${section} control is covered at its centre or either end`, async () => {
        const page = await open(view, {}, { section });
        try {
          assert.deepEqual(await covering(page, `#vp-body-${section} :is(button, label, .seg-opt, input:not(.wv-toggle-input))`), []);
        } finally { await page.close(); }
      });
    }
  }

  test('a board offers no control it ignores: no Σ Rollups, and no Fit or Card shape without a picture field (Issue #1916)', async () => {
    const page = await open('Kanban', { picture: 'small', rollups: true }, { section: 'display' });
    try {
      for (const sel of ['label.vp-switch[data-rollups]', '.vp-subtotals', '.vp-aggs', '.board-fit', '.board-frame', '.board-flow']) {
        assert.equal(await page.locator(`#view-pane #vp-body-display ${sel}`).count(), 0, `${sel} is not offered on this board`);
      }
      assert.match(await page.locator('#view-pane #vp-body-display').innerText(), /Σ Rollups show in the Table layout/);
    } finally { await page.close(); }
  });

  test('a board with a cover field offers Fit, and a group level past the lanes says it groups the Table only (Issue #1916)', async () => {
    resetTasks(weave, tasks.id);
    useCover(weave, tasks.id, true);
    weave.tableView(`${tasks.id}/Kanban`, { picture: 'small', group: [{ field: 'State' }, { field: 'Workstream' }, { field: 'Assignee' }] });
    const id = weave.tableView(tasks.id).views.find((v) => v.name === 'Kanban').id;
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await paneOnLoad(page, 'display');
      await page.goto(`${base}/#/table/${tasks.id}/view/${id}`, { waitUntil: 'networkidle' });
      await tableDrawn(page);
      await page.waitForSelector('#view-pane #vp-body-display .board-fit');
      await page.locator('#view-pane .vp-acc[data-section="group"]').click();
      await page.waitForSelector('#view-pane #vp-body-group');
      assert.match(await page.locator('#view-pane #vp-body-group').innerText(), /Level 3 and deeper group the Table layout only/);
    } finally { await page.close(); }
  });

  test('opening a lower section in a short window brings its header into view (Issue #1923)', async () => {
    resetTasks(weave, tasks.id);
    const work = weave.tableView(tasks.id).views.find((v) => v.name === 'Work').id;
    const page = await browser.newPage({ viewport: { width: 1440, height: 600 } });
    try {
      await paneOnLoad(page, 'filters');
      await page.goto(`${base}/#/table/${tasks.id}/view/${work}`, { waitUntil: 'networkidle' });
      await tableDrawn(page);
      await page.waitForSelector('#view-pane #vp-body-filters');
      const scroll = page.locator('#view-pane .vp-scroll');
      await page.locator('#view-pane .vp-acc[data-section="display"]').scrollIntoViewIfNeeded();
      await page.locator('#view-pane .vp-acc[data-section="display"]').click();
      await page.waitForSelector('#view-pane #vp-body-display .vp-agg');
      const [head, box] = await Promise.all([
        page.locator('#view-pane .vp-acc[data-section="display"]').evaluate((n) => n.getBoundingClientRect().toJSON()),
        scroll.evaluate((n) => n.getBoundingClientRect().toJSON()),
      ]);
      assert.ok(head.top >= box.top - 1 && head.bottom <= box.bottom + 1, `the Display header sits at ${Math.round(head.top)}..${Math.round(head.bottom)} in a pane showing ${Math.round(box.top)}..${Math.round(box.bottom)}`);
    } finally { await page.close(); }
  });

  test('the Report a problem button overlaps no View pane button (Issue #1926)', async () => {
    const page = await open('Work', {}, { section: 'filters' });
    try {
      const overlaps = await page.evaluate(() => {
        const fab = document.querySelector('.bug-fab')?.getBoundingClientRect() ?? new DOMRect();
        return [...document.querySelectorAll('#view-pane button')].flatMap((b) => {
          const r = b.getBoundingClientRect();
          const w = Math.min(r.right, fab.right) - Math.max(r.left, fab.left), h = Math.min(r.bottom, fab.bottom) - Math.max(r.top, fab.top);
          return w > 0 && h > 0 ? [`${b.textContent.trim() || b.getAttribute('aria-label')}: ${Math.round(w)}x${Math.round(h)} px`] : [];
        });
      });
      assert.deepEqual(overlaps, []);
    } finally { await page.close(); }
  });
}
