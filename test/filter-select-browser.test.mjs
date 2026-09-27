/* The Filters popover offers single-select and multi-select fields beside
   workflow and toggle fields, with the same option picking (Issue #319),
   and its footer reads "X of N <row term plural>" (Issue #448; Kyle,
   2026-09-27). Options in one field widen the match (OR), fields narrow it
   (AND), a multi-select row matches on any chosen option. X counts the rows
   left after the filters and the search, N every undeleted row; the plural
   stays even at 1. The count is one node, updated in place and announced
   politely, with Clear all on its right. Playwright is NOT a dependency of
   weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let bugs;
const s = await launch('select filters and the count', (weave) => {
  weave.createSpace({ name: 'Dev' });
  bugs = weave.createTable({ space: 'Dev', name: 'Issue' });
  weave.updateTable(bugs, { noun: 'bug' });
  weave.addField(bugs, { name: 'Status', type: 'workflow', config: { states: [{ name: 'Open', category: 'not-started', default: true }, { name: 'Fixed', category: 'done' }] } });
  weave.addField(bugs, { name: 'Severity', type: 'select', config: { options: [{ name: 'Low' }, { name: 'Medium', hue: 'amber' }, { name: 'High', hue: 'red' }] } });
  weave.addField(bugs, { name: 'Symptom', type: 'multiselect', config: { options: [{ name: 'Slow' }, { name: 'Error' }, { name: 'Wrong data' }] } });
  for (const [name, Status, Severity, Symptom] of [
    ['Alpha', 'Open', 'High', ['Slow', 'Error']],
    ['Bravo', 'Open', 'Low', ['Wrong data']],
    ['Charlie', 'Fixed', 'High', ['Error']],
    ['Delta', 'Open', 'Medium', []],
    ['Echo', 'Open', null, ['Slow']],
  ]) weave.createEntity(bugs, { name, values: { Status, ...(Severity ? { Severity } : {}), Symptom } });
  const gone = weave.createEntity(bugs, { name: 'Gone', values: { Severity: 'High' } });
  weave.deleteEntity(gone.id);
});

if (s) {
  const { base, browser, weave } = s;
  const view = () => weave.tableView(bugs).views[0];
  const reset = () => weave.tableView(`${bugs.id}/${view().id}`, { filters: {}, sort: [] });
  const rows = (page) => page.$$eval('.wv-grid tbody tr.entity-row', (rs) => rs.length);
  const total = (page) => page.locator('.table-filter-popover .filter-total');
  const box = (page, group, name) => page.locator(`.table-filter-popover .filter-group[aria-label="${group}"]`).getByRole('checkbox', { name, exact: true });
  const settled = async (page, text) => {
    await page.waitForFunction((t) => document.querySelector('.table-filter-popover .filter-total')?.textContent === t && !document.querySelector('#main [aria-busy="true"]'), text, { timeout: 10000 });
  };
  const open = async (theme = 'light') => {
    reset();
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, colorScheme: theme });
    await page.goto(`${base}/#/table/${bugs.id}`, { waitUntil: 'networkidle' });
    await page.click('.table-filter-btn');
    await page.waitForSelector('.table-filter-popover .filter-total');
    return page;
  };

  for (const theme of ['light', 'dark']) {
    test(`select and multi-select fields filter beside workflow, OR within a field and AND across; the footer counts (${theme})`, async () => {
      const page = await open(theme);
      try {
        const groups = await page.$$eval('.table-filter-popover .filter-group', (gs) => gs.map((g) => [g.getAttribute('aria-label'), g.querySelector('.filter-type')?.textContent]));
        assert.deepEqual(groups, [['Status', 'Workflow'], ['Severity', 'Single select'], ['Symptom', 'Multi select']]);
        assert.equal(await box(page, 'Severity', 'High').getAttribute('class'), 'form-check-input', 'the same checkbox as every other');
        const node = await total(page).elementHandle();
        assert.equal(await total(page).getAttribute('aria-live'), 'polite');
        await settled(page, '5 of 5 bugs');
        const foot = await page.$eval('.table-filter-popover .filter-footer', (f) => [...f.children].map((c) => c.className));
        assert.match(foot[0], /filter-total/, 'the count on the left');
        assert.match(foot.at(-1), /filter-clear/, 'Clear all on the right');
        assert.equal(await page.locator('.table-filter-popover .filter-clear').isDisabled(), true);

        await box(page, 'Severity', 'High').check();
        await settled(page, '2 of 5 bugs');
        assert.equal(await rows(page), 2, 'the grid agrees');
        assert.deepEqual(view().filters, { Severity: ['High'] }, 'saved into the view');
        assert.equal(await page.locator('.table-filter-popover .filter-clear').isDisabled(), false);

        await box(page, 'Severity', 'Low').check();
        await settled(page, '3 of 5 bugs');
        assert.equal(await rows(page), 3, 'options in one field widen the match');

        await box(page, 'Symptom', 'Slow').check();
        await settled(page, '1 of 5 bugs');
        assert.equal(await rows(page), 1, 'fields narrow it; the plural stays at 1');

        await box(page, 'Symptom', 'Wrong data').check();
        await settled(page, '2 of 5 bugs');
        assert.equal(await rows(page), 2, 'a multi-select row matches on any chosen option');
        assert.deepEqual(view().filters, { Severity: ['High', 'Low'], Symptom: ['Slow', 'Wrong data'] });
        assert.equal(await node.evaluate((n) => n.isConnected), true, 'the count is updated in place, never redrawn');

        await page.locator('.table-filter-popover .filter-clear').click();
        await settled(page, '5 of 5 bugs');
        assert.deepEqual(view().filters ?? {}, {});
        assert.equal(await box(page, 'Severity', 'High').isChecked(), false);
      } finally { await page.close(); reset(); }
    });
  }

  test('the count reads after the search too, and never counts deleted rows', async () => {
    const page = await open();
    try {
      await box(page, 'Status', 'Open').check();
      await settled(page, '4 of 5 bugs');
      await page.keyboard.press('Escape');
      await page.fill('.table-search-input', 'Alpha');
      await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody tr.entity-row').length === 1);
      await page.click('.table-filter-btn');
      await settled(page, '1 of 5 bugs');
      // Deleted rows shown in the grid still leave N alone.
      await page.keyboard.press('Escape');
      await page.fill('.table-search-input', '');
      weave.tableView(`${bugs.id}/${view().id}`, { deleted: true });
      await page.reload({ waitUntil: 'networkidle' });
      await page.click('.table-filter-btn');
      await settled(page, '4 of 5 bugs');
    } finally { await page.close(); weave.tableView(`${bugs.id}/${view().id}`, { deleted: false }); reset(); }
  });

  test('a select filter seeds a new row inside it (Issue #341)', async () => {
    weave.tableView(`${bugs.id}/${view().id}`, { filters: { Severity: ['Medium'] } });
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    try {
      await page.goto(`${base}/#/table/${bugs.id}`, { waitUntil: 'networkidle' });
      assert.equal(await rows(page), 1);
      await page.click('.wv-grid tr.add-entity-row .add-entity-btn');
      await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody tr.entity-row').length === 2);
      const made = weave.query(bugs, { where: [['Severity', 'in', ['Medium']]] }).items;
      assert.equal(made.length, 2, 'the new row starts inside the filter');
    } finally {
      for (const e of weave.query(bugs).items) if (!['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].includes(e.name)) weave.deleteEntity(e.id, { hard: true });
      reset(); await page.close();
    }
  });
}
