import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phonePage, phoneBrowser, eventually } from './lib/browser.mjs';
import { seedIssues, combinations, STANDARD_FIELDS, LIVE, LAYOUTS, ROLLUP_MODES, GROUPS, FILTERS, SORTS, HIDDEN } from './lib/view-pane-fixture.mjs';

let issue;
const s = await launch('the View pane over Issue', (weave) => { ({ issue } = seedIssues(weave)); });

const SAMPLE = [];
{
  const all = [...combinations()];
  let i = 0;
  for (const layout of LAYOUTS) for (const [rollups, subtotals] of ROLLUP_MODES) for (const group of GROUPS.slice(1)) {
    const fi = FILTERS[i % FILTERS.length], sort = SORTS[i % SORTS.length], hidden = HIDDEN[i % HIDDEN.length];
    i++;
    SAMPLE.push(all.find((c) => c.layout === layout && c.rollups === rollups && c.subtotals === subtotals && c.group === group && c.filters === fi.filters && c.deleted === fi.deleted && c.sort === sort && c.hidden === hidden));
  }
}
const EVERYTHING = {
  filters: { Severity: ['Low', 'High'] }, deleted: true, layout: 'table', rollups: true, subtotals: 'all', hidden: ['Severity'],
  sort: [{ field: 'Name', dir: 'asc' }, { field: 'Modified At', dir: 'desc' }, { field: 'Created At', dir: 'desc' }],
  group: [{ field: 'Area' }, { field: 'Severity' }, { field: 'Status', dir: 'desc' }, { field: 'Symptom' }, { field: 'Fixed in' }],
};

if (s) {
  const { base, browser, weave } = s;
  const write = (c) => {
    weave.tableView(`${issue.id}/Standard`, { group: null, sort: [] });
    return weave.tableView(`${issue.id}/Standard`, {
      fields: STANDARD_FIELDS.filter((n) => !c.hidden.includes(n)), filters: c.filters, deleted: c.deleted, group: c.group, sort: c.sort,
      layout: c.layout === 'list' ? 'list' : null, rollups: c.rollups, subtotals: c.subtotals, collapsed: null, density: 'compact',
    });
  };
  const open = async (theme = 'light', { height = 5000 } = {}) => {
    const page = await browser.newPage({ viewport: { width: 1440, height }, colorScheme: theme });
    await page.goto(`${base}/#/table/${issue.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main :is(.wv-grid, .wv-list)');
    return page;
  };
  const api = (view) => weave.query(issue.id, { view: view.id, relations: 'chip', ...(view.group?.length ? {} : { includeDeleted: !!view.deleted }) });

  test('desktop toolbar: Search, View with its filter badge, the table menu; View opens a pane beside the table', async () => {
    write({ filters: { Severity: ['High'], Area: ['Grid', 'Nav'] }, deleted: true, sort: [], group: [], layout: 'table', rollups: false, subtotals: 'all', hidden: [] });
    const page = await open('light', { height: 900 });
    try {
      const shown = await page.$$eval('#main .crumb-actions > *', (ns) => ns.filter((n) => n.offsetParent).map((n) => n.className));
      assert.equal(shown.length, 3, `Search, View and Share show beside the crumbs: ${shown}`);
      assert.match(shown[0], /table-search/);
      assert.match(shown[1], /table-view-btn/);
      assert.equal(await page.locator('#main .crumb-row .dots-btn[title="Table actions"]').isVisible(), true, 'and the table menu');
      for (const gone of ['table-density-btn', 'eye-btn', 'table-filter-btn', 'table-sort-btn', 'table-group-btn']) assert.ok(!shown.some((c) => c.includes(gone)), gone);
      assert.equal(await page.textContent('#main .table-view-btn .view-count'), '4', 'three filter values and Include deleted');
      assert.equal(await page.locator('#main .filter-pill, #main .view-pills').count(), 0, 'no filter pills under the title');
      const wide = await page.$eval('#main', (n) => n.getBoundingClientRect().width);
      await page.click('#main .table-view-btn');
      await page.waitForSelector('#view-pane:not([hidden]) .vp-acc');
      assert.equal(await page.getAttribute('#main .table-view-btn', 'aria-expanded'), 'true');
      const narrow = await page.$eval('#main', (n) => n.getBoundingClientRect().width);
      assert.ok(narrow < wide - 250, `the pane takes room beside the table (${wide} → ${narrow})`);
      const [main, pane] = await page.$$eval('#main, #view-pane', (ns) => ns.map((n) => getComputedStyle(n).backgroundColor));
      assert.equal(pane, main, 'the pane wears the panel surface');
      const heads = await page.$$eval('#view-pane .vp-acc', (bs) => bs.map((b) => [b.dataset.section, b.querySelector('.vp-name').textContent, b.getAttribute('aria-expanded')]));
      assert.deepEqual(heads.map((h) => h[1]), ['Filters', 'Sort', 'Group', 'Fields', 'Display']);
      assert.equal(heads.filter((h) => h[2] === 'true').length, 1, 'one section open at a time');
      assert.equal(await page.locator('#view-pane .vp-acc[data-section="filters"].changed').count(), 1, 'Filters turns blue: it differs from the default');
      assert.equal(await page.locator('#view-pane .vp-acc[data-section="group"].changed').count(), 0);
      assert.ok(await page.locator('#view-pane [data-deleted] input[role="switch"]').isChecked(), 'Include deleted is a switch in Filters');
      await page.click('#view-pane .vp-acc[data-section="group"]');
      assert.equal(await page.getAttribute('#view-pane .vp-acc[data-section="filters"]', 'aria-expanded'), 'false');
      assert.equal(await page.locator('#view-pane select').count(), 0, 'no native selects');
      await page.click('#view-pane .vp-close');
      await page.waitForSelector('#view-pane', { state: 'hidden' });
      assert.equal(await eventually(() => page.$eval('#main', (n) => Math.round(n.getBoundingClientRect().width)), Math.round(wide)), Math.round(wide), 'closing gives the table the full width');
    } finally { await page.close(); }
  });

  test('the pane writes the rules: grouping a sorted field moves it out of Sort and the Sort section says so', async () => {
    write({ filters: {}, deleted: false, sort: [{ field: 'Severity', dir: 'desc' }, { field: 'Name', dir: 'asc' }], group: [], layout: 'table', rollups: false, subtotals: 'all', hidden: [] });
    const page = await open('light', { height: 900 });
    try {
      await page.click('#main .table-view-btn');
      await page.click('#view-pane .vp-acc[data-section="group"]');
      await page.click('#view-pane .group-add');
      await page.locator('.picker-pop .picker-row').filter({ has: page.locator('.picker-label', { hasText: /^Severity$/ }) }).first().click();
      await page.waitForSelector('#main tr.group-head');
      await page.waitForSelector('#view-pane .vp-note');
      assert.match(await page.textContent('#view-pane .vp-note'), /Severity now orders the groups, so it left Sort/);
      assert.deepEqual(weave.tableView(`${issue.id}/Standard`).sort, [{ field: 'Name', dir: 'asc' }]);
      await page.click('#view-pane .vp-acc[data-section="fields"]');
      assert.equal(await page.textContent('#view-pane .table-field-row[data-field="Severity"] .vp-tag'), 'Group 1');
      assert.equal(await page.textContent('#view-pane .table-field-row[data-field="Name"] .vp-tag'), 'Sort 1');
    } finally { await page.close(); }
  });

  for (const theme of ['light', 'dark']) {
    test(`everything at once (${theme}): 5-level group, 3-level sort, filters and deleted rows; every Σ cell is the API's`, async () => {
      const view = write(EVERYTHING);
      const q = api(view);
      const page = await open(theme);
      try {
        await page.waitForSelector('#main tr.group-sum.grand');
        const dom = await page.$$eval('#main tbody tr', (trs) => trs.map((t) => ({
          kind: t.classList.contains('group-head') ? 'head' : t.classList.contains('group-sum') ? 'sum' : t.classList.contains('entity-row') ? 'row' : 'other',
          key: t.dataset.key ?? t.dataset.sum ?? null, deleted: t.classList.contains('row-deleted'),
          strike: t.classList.contains('row-deleted') ? getComputedStyle(t.querySelector('td .wv-cb')).textDecorationLine : null,
          cells: Object.fromEntries([...t.querySelectorAll('td.group-sum-cell')].map((td) => [td.dataset.col, [...td.querySelectorAll('.foot-val')].map((v) => v.textContent)])),
          text: t.textContent,
        })));
        const heads = dom.filter((d) => d.kind === 'head');
        assert.equal(heads.length, q.groups.length, 'one header per group the API returns');
        assert.deepEqual(heads.map((h) => h.key), q.groups.map((g) => g.path.map((p) => p.value).join(' › ')), 'in display order');
        const sums = dom.filter((d) => d.kind === 'sum' && d.key !== 'all');
        assert.equal(sums.length, q.groups.length, 'Every level: one subtotal per group');
        for (const row of [...sums, dom.find((d) => d.key === 'all')]) {
          const g = row.key === 'all' ? q.groupTotal : q.groups.find((x) => x.path.map((p) => p.value).join(' › ') === row.key);
          for (const r of g.rollups) {
            if (!view.fields.includes(r.field)) continue;
            assert.ok(row.cells[r.field]?.includes(r.display ?? '—'), `${row.key} ${r.field} ${r.aggregate}: grid ${row.cells[r.field]} vs API ${r.display}`);
          }
          assert.match(row.text, new RegExp(`· ${g.count} issues?`));
        }
        assert.equal(dom.find((d) => d.key === 'all').text.includes(`All · ${q.groupTotal.count} issue`), true);
        const deleted = dom.filter((d) => d.kind === 'row' && d.deleted);
        assert.ok(deleted.length > 0 && deleted.every((d) => d.strike === 'line-through'), 'deleted rows show struck through');
        assert.ok(heads.some((h) => h.text.includes('Severity')), 'the hidden grouped field keeps its headers');
        assert.match(await page.textContent('#main thead'), /Name.*1/, 'the sort levels mark their columns');
      } finally { await page.close(); }
    });
  }

  test('collapsing keeps the header and its subtotal; Collapse all gives a summary table; new group fields expand again', async () => {
    write({ ...EVERYTHING, group: [{ field: 'Area' }, { field: 'Severity' }], filters: {}, deleted: false, hidden: [] });
    const page = await open('light');
    try {
      const first = await page.$eval('#main tr.group-head', (t) => t.dataset.key);
      const before = await page.locator('#main tr.entity-row').count();
      await page.click(`#main tr.group-head[data-key="${first}"] .group-fold`);
      await page.waitForFunction((n) => document.querySelectorAll('#main tr.entity-row').length < n, before);
      assert.equal(await page.locator(`#main tr.group-sum[data-sum="${first}"]`).count(), 1, 'the collapsed group keeps its subtotal');
      await eventually(() => weave.tableView(`${issue.id}/Standard`).collapsed ?? [], [first]);
      await page.click('#main .table-view-btn');
      await page.click('#view-pane .vp-acc[data-section="group"]');
      await page.click('#view-pane .vp-collapse-all');
      await page.waitForFunction(() => !document.querySelector('#main tr.entity-row'));
      assert.equal(await page.locator('#main tr.group-head.lv-0').count(), await page.locator('#main tr.group-sum.lv-0').count(), 'a summary table');
      weave.tableView(`${issue.id}/Standard`, { group: ['Status'] });
      assert.equal(weave.tableView(`${issue.id}/Standard`).collapsed, undefined, 'new group fields expand every group');
    } finally { await page.close(); }
  });

  test(`the combination sample in both layouts draws what the API returns (${SAMPLE.length} setups)`, async () => {
    const page = await open('light');
    try {
      for (const c of SAMPLE) {
        const view = write(c);
        const q = api(view);
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForSelector('#main :is(.wv-grid, .wv-list)', { state: 'attached' });
        const ctx = JSON.stringify({ f: c.filters, d: c.deleted, g: c.group.map((x) => x.field), la: c.layout, ro: c.rollups, su: c.subtotals });
        if (c.layout === 'list') {
          const got = await page.$$eval('#main .wv-list', ([l]) => ({
            rows: l.querySelectorAll('.list-row:not(.ghost)').length,
            heads: l.querySelectorAll('.list-group:not(.list-completed)').length,
            sums: l.querySelectorAll('.list-sum').length,
            grand: l.querySelector('.list-sum.grand')?.textContent ?? null,
          }));
          assert.equal(got.heads, c.group.length ? q.groups.length : 0, `list headers ${ctx}`);
          if (c.rollups) assert.match(got.grand, new RegExp(`All · ${q.groupTotal?.count ?? LIVE.length} issue`), `list grand ${ctx}`);
          else assert.equal(got.sums, 0, ctx);
        } else {
          const got = await page.$$eval('#main tbody', ([tb]) => ({
            heads: tb.querySelectorAll('tr.group-head').length, sums: tb.querySelectorAll('tr.group-sum:not(.grand)').length,
            grand: tb.querySelectorAll('tr.group-sum.grand').length,
          }));
          assert.equal(got.heads, q.groups.length, `table headers ${ctx}`);
          const want = c.rollups ? q.groups.filter((g) => c.subtotals === 'all' || (c.subtotals === 'top' && g.path.length === 1)).length : 0;
          assert.equal(got.sums, want, `table subtotals ${ctx}`);
          assert.equal(got.grand, c.rollups ? 1 : 0, ctx);
        }
      }
    } finally { await page.close(); }
  });

  test('phone keeps its one table menu and gains the Sort and Group levels', async () => {
    write({ ...EVERYTHING, filters: {}, deleted: false, hidden: [] });
    const pb = await phoneBrowser();
    if (!pb) return;
    const page = await phonePage(pb);
    try {
      await page.goto(`${base}/#/table/${issue.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main .table-tools-btn');
      assert.equal(await page.locator('#view-pane').isVisible(), false, 'no pane on a phone');
      await page.click('#main .table-tools-btn');
      await page.click('#main .crumb-actions .table-sort-btn');
      await page.waitForSelector('.table-sort-popover .sort-level');
      assert.equal(await page.locator('.table-sort-popover .sort-level').count(), 3);
      await page.keyboard.press('Escape');
      await page.waitForSelector('.table-sort-popover', { state: 'detached' });
      if (!await page.locator('#main .crumb-actions .table-group-btn').isVisible()) await page.click('#main .table-tools-btn');
      await page.click('#main .crumb-actions .table-group-btn');
      await page.waitForSelector('.table-group-popover .group-level');
      assert.equal(await page.locator('.table-group-popover .group-level').count(), 5);
      assert.equal(await page.locator('.table-group-popover .vp-limit').textContent(), '5 of 5 group levels in use.');
    } finally { await page.close(); }
  });
}
