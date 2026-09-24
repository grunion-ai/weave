/* The view strip (Feature #229, Kyle's ruling 2026-09-23): tabs under the
   table title, the default starred and first, Blank last. A change to the
   filter, the sort or the columns autosaves into the view on screen; Blank
   is read-only; "Save as view" duplicates; + makes a new view from Blank.
   Every write here is the tableView verb an agent calls — the assertions
   read the engine back, not the DOM alone. Issue #341 rides along: + New on
   a filtered view makes a row the grid can show.
   Playwright is NOT a dependency of weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let jobs;
const s = await launch('table view strip', (weave) => {
  weave.createSpace({ name: 'Ops' });
  jobs = weave.createTable({ space: 'Ops', name: 'Job' });
  weave.addField(jobs, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'Doing', category: 'in-progress' },
    { name: 'Done', category: 'done' }] } });
  weave.addField(jobs, { name: 'Owner', type: 'text' });
  for (const [name, Status] of [['A', 'Open'], ['B', 'Doing'], ['C', 'Done'], ['D', 'Open']]) {
    weave.createEntity(jobs, { name, values: { Status } });
  }
});

if (s) {
  const { base, browser, weave } = s;
  const reset = () => {
    for (const v of weave.tableView(jobs).views) if (!v.blank && v.name !== 'Default') weave.tableView(`${jobs.id}/${v.id}`, { delete: true });
    weave.tableView(`${jobs.id}/Default`, { default: true, filters: {}, sort: [], fields: ['Name', 'Description', 'Status', 'Owner'] });
  };
  const open = async (hash = `#/table/${jobs.id}`, theme = 'light') => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, colorScheme: theme });
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.view-strip .view-tab');
    return page;
  };
  const tabs = (page) => page.$$eval('.view-strip .view-tab', (ts) => ts.map((t) => ({
    name: t.textContent.replace('★', '').trim(), active: t.classList.contains('active'), star: !!t.querySelector('.view-star'),
  })));
  const rows = (page) => page.$$eval('.wv-grid tbody tr.entity-row', (rs) => rs.length);
  const heads = (page) => page.$$eval('.wv-grid thead th .col-label', (hs) => hs.map((h) => h.textContent.trim()));

  test('the strip sits under the title: the default starred and open, Blank last, then +', async () => {
    reset();
    const page = await open();
    try {
      assert.deepEqual(await tabs(page), [
        { name: 'Default', active: true, star: true },
        { name: 'Blank', active: false, star: false },
      ]);
      assert.equal(await page.locator('.view-strip .view-add').count(), 1, 'the + makes a view');
      const order = await page.evaluate(() => {
        const title = document.querySelector('#main h1, #main .page-title, #main h2');
        const strip = document.querySelector('.view-strip');
        const grid = document.querySelector('.wv-grid');
        return [!!(title.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING), !!(strip.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING)];
      });
      assert.deepEqual(order, [true, true], 'title, then strip, then grid');
    } finally { await page.close(); }
  });

  test('a filter chip autosaves into the view on screen, through the view verb', async () => {
    reset();
    weave.tableView(`${jobs.id}/Mine`, { fields: ['Name', 'Status'] });
    const mine = weave.tableView(`${jobs.id}/Mine`);
    const page = await open(`#/table/${jobs.id}/view/${mine.id}`);
    try {
      const patched = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(`/tables/${jobs.id}/views/`));
      await page.click('.filter-strip .filter-chip:text-is("Done")');
      await patched;
      await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody tr.entity-row').length === 1);
      assert.deepEqual(weave.tableView(`${jobs.id}/Mine`).filters, { Status: ['Done'] }, 'saved into Mine');
      assert.equal(weave.tableView(`${jobs.id}/Default`).filters, undefined, 'the default did not move');
      assert.deepEqual(await heads(page), ['Name', 'Status'], "the grid shows Mine's columns, in Mine's order");
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.view-tab.active');
      assert.equal((await tabs(page)).find((t) => t.active).name, 'Mine', 'the permalink reopens the view');
      assert.equal(await rows(page), 1);
    } finally { reset(); await page.close(); }
  });

  test('Blank is the raw table and read-only: a chip click says so and saves nothing', async () => {
    reset();
    weave.tableView(`${jobs.id}/Default`, { filters: { Status: ['Open'] }, hide: ['Owner'] });
    const page = await open(`#/table/${jobs.id}/view/blank`);
    try {
      assert.equal(await rows(page), 4, 'every row');
      assert.ok((await heads(page)).includes('Owner'), 'every field');
      await page.click('.filter-strip .filter-chip:text-is("Done")');
      await page.waitForFunction(() => /read-only/.test(document.body.textContent));
      await page.waitForLoadState('networkidle');
      assert.equal(await page.locator('.filter-strip .filter-chip.on').count(), 0, 'the chip did not turn on');
      assert.deepEqual(weave.tableView(`${jobs.id}/Default`).filters, { Status: ['Open'] }, 'nothing moved');
    } finally { reset(); await page.close(); }
  });

  test('Save as view duplicates the view on screen and opens the copy', async () => {
    reset();
    weave.tableView(`${jobs.id}/Default`, { filters: { Status: ['Open'] } });
    const page = await open();
    try {
      await page.click('.view-strip .dots-btn');
      await page.click('.view-strip .dropdown-item:text-is("Save as view…")');
      await page.fill('#modal input[name=name]', 'Open copy');
      await page.click('#modal button[type=submit]');
      await page.waitForFunction(() => document.querySelector('.view-tab.active')?.textContent.includes('Open copy'));
      const copy = weave.tableView(`${jobs.id}/Open copy`);
      assert.deepEqual(copy.filters, { Status: ['Open'] }, 'the copy carries the filter');
      assert.ok(new RegExp(`/view/${copy.id}$`).test(await page.evaluate(() => location.hash)), 'the URL names the copy');
      assert.equal(await rows(page), 2);
    } finally { reset(); await page.close(); }
  });

  test('+ makes a view from Blank; Make default stars it and the bare table route opens it', async () => {
    reset();
    const page = await open();
    try {
      await page.click('.view-strip .view-add');
      await page.fill('#modal input[name=name]', 'Fresh');
      await page.click('#modal button[type=submit]');
      await page.waitForFunction(() => document.querySelector('.view-tab.active')?.textContent.includes('Fresh'));
      assert.deepEqual(weave.tableView(`${jobs.id}/Fresh`).fields, ['Name', 'Description', 'Status', 'Owner']);
      await page.click('.view-strip .dots-btn');
      await page.click('.view-strip .dropdown-item:text-is("Make default")');
      await page.waitForFunction(() => document.querySelector('.view-tab')?.textContent.includes('Fresh'));
      assert.deepEqual((await tabs(page)).map((t) => [t.name, t.star]), [['Fresh', true], ['Default', false], ['Blank', false]]);
      await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
      await page.goto(`${base}/#/table/${jobs.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.view-tab.active');
      assert.equal((await tabs(page)).find((t) => t.active).name, 'Fresh', 'the default opens with the table');
    } finally { reset(); await page.close(); }
  });

  test('hiding a column with the eye hides it in this view only', async () => {
    reset();
    weave.tableView(`${jobs.id}/Narrow`, { from: 'Default' });
    const page = await open(`#/table/${jobs.id}/view/${weave.tableView(`${jobs.id}/Narrow`).id}`);
    try {
      await page.click('.eye-btn');
      await page.click('.chip-pop .eye-row:has(.eye-label:text-is("Owner"))');
      await page.waitForFunction(() => ![...document.querySelectorAll('.wv-grid thead .col-label')].some((h) => h.textContent.trim() === 'Owner'));
      assert.ok(!weave.tableView(`${jobs.id}/Narrow`).fields.includes('Owner'));
      assert.ok(weave.tableView(`${jobs.id}/Default`).fields.includes('Owner'), 'the default still shows it');
    } finally { reset(); await page.close(); }
  });

  test('+ New on a filtered view makes a row the grid can show (Issue #341)', async () => {
    reset();
    weave.tableView(`${jobs.id}/Default`, { filters: { Status: ['Done'] } });
    const page = await open();
    try {
      assert.equal(await rows(page), 1);
      const before = weave.query(jobs).total;
      await page.click('.wv-grid tr.add-entity-row .add-entity-btn');
      await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody tr.entity-row').length === 2);
      assert.equal(weave.query(jobs).total, before + 1);
      const made = weave.query(jobs).items.find((e) => !['A', 'B', 'C', 'D'].includes(e.name));
      assert.equal(made.fields.Status, 'Done', 'the new row starts inside the filter');
    } finally {
      for (const e of weave.query(jobs).items) if (!['A', 'B', 'C', 'D'].includes(e.name)) weave.deleteEntity(e.id, { hard: true });
      reset(); await page.close();
    }
  });

  test('both themes: the active tab is marked by an underline the theme can see', async () => {
    reset();
    for (const theme of ['light', 'dark']) {
      const page = await open(`#/table/${jobs.id}`, theme);
      try {
        await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
        const { line, bg, color } = await page.$eval('.view-tab.active', (a) => {
          const cs = getComputedStyle(a);
          return { line: cs.borderBottomColor, bg: getComputedStyle(document.body).backgroundColor, color: cs.color };
        });
        assert.notEqual(line, 'rgba(0, 0, 0, 0)', `${theme}: the underline is drawn`);
        assert.notEqual(line, bg, `${theme}: and it is not the page colour`);
        assert.notEqual(color, bg, `${theme}: the label reads`);
      } finally { await page.close(); }
    }
  });
}
