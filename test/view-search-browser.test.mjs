import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let jobs;
const named = {};
const s = await launch('view search', (weave) => {
  weave.createSpace({ name: 'Ops' });
  jobs = weave.createTable({ space: 'Ops', name: 'Job' });
  for (const name of ['Alpha launch', 'Beta launch', 'Gamma cleanup']) named[name] = weave.createEntity(jobs, { name });
  for (let i = 0; i < 20; i++) weave.createEntity(jobs, { name: `Filler row ${i}` });
});

if (s) {
  const { base, browser, weave } = s;
  const TOTAL = 23;
  const LAUNCH = () => [named['Alpha launch'].id, named['Beta launch'].id].sort();

  const reset = () => {
    for (const v of weave.tableView(jobs).views) if (v.name !== 'Standard') weave.tableView(`${jobs.id}/${v.id}`, { delete: true });
    weave.tableView(`${jobs.id}/Standard`, { search: '' });
  };
  const open = async (hash = `#/table/${jobs.id}`) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row, .table-search-empty');
    return page;
  };
  const shown = (page) => page.locator('.wv-grid tbody tr.entity-row').evaluateAll((rs) => rs.map((r) => r.dataset.eid).sort());
  const rowsAre = (page, ids) => page.waitForFunction((want) => {
    const got = [...document.querySelectorAll('.wv-grid tbody tr.entity-row')].map((r) => r.dataset.eid).sort();
    return JSON.stringify(got) === JSON.stringify(want);
  }, [...ids].sort());
  const rowCount = (page, n) => page.waitForFunction((want) => document.querySelectorAll('.wv-grid tbody tr.entity-row').length === want, n);
  const saved = (page) => page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes(`/tables/${jobs.id}/views/`));
  const search = async (page, text) => {
    const wrote = saved(page);
    await page.fill('.table-search-input', text);
    await wrote;
  };
  const views = async (page) => {
    if (!await page.locator('.table-view-popover').isVisible()) await page.click('.table-view-btn');
    await page.waitForSelector('.view-strip .view-row');
  };
  const tab = (page, name) => page.locator('.view-strip .view-row').filter({ has: page.locator('.view-name', { hasText: new RegExp(`^${name}$`) }) });

  test('typing saves the search on the view; a reload restores the box and the rows (Feature #307)', async () => {
    reset();
    const page = await open();
    try {
      await search(page, 'launch');
      await rowsAre(page, LAUNCH());
      assert.equal(weave.tableView(`${jobs.id}/Standard`).search, 'launch', 'the view holds the search');
      assert.deepEqual(weave.tableView(`${jobs.id}/Standard`).filters ?? {}, {}, 'the filter is untouched');
      await page.reload({ waitUntil: 'networkidle' });
      await rowsAre(page, LAUNCH());
      assert.equal(await page.inputValue('.table-search-input'), 'launch', 'the box shows the saved search');
      assert.deepEqual(await shown(page), weave.query(jobs, { search: 'launch' }).items.map((e) => e.id).sort(), 'the grid shows what the engine returns for it');
      assert.match(await page.textContent('.wv-loaded'), /2 rows found/);
    } finally { reset(); await page.close(); }
  });

  test('clearing the box writes an empty search, and a reload shows every row', async () => {
    reset();
    weave.tableView(`${jobs.id}/Standard`, { search: 'cleanup' });
    const page = await open();
    try {
      await rowsAre(page, [named['Gamma cleanup'].id]);
      assert.equal(await page.inputValue('.table-search-input'), 'cleanup');
      const wrote = saved(page);
      await page.press('.table-search-input', 'Escape');
      const body = (await wrote).request().postDataJSON();
      assert.deepEqual(body, { search: '' }, 'Escape writes an empty string');
      await rowCount(page, TOTAL);
      assert.equal(weave.tableView(`${jobs.id}/Standard`).search, undefined);
      await page.reload({ waitUntil: 'networkidle' });
      await rowCount(page, TOTAL);
      assert.equal(await page.inputValue('.table-search-input'), '');
    } finally { reset(); await page.close(); }
  });

  test('Duplicate copies the search into the new view, which opens searched', async () => {
    reset();
    weave.tableView(`${jobs.id}/Standard`, { search: 'launch' });
    const page = await open();
    try {
      await rowsAre(page, LAUNCH());
      await views(page);
      await tab(page, 'Standard').hover();
      await tab(page, 'Standard').locator('.view-dup-btn').click();
      const input = page.locator('.view-strip .view-name-input');
      await input.fill('Launches');
      await input.press('Enter');
      await page.waitForFunction(() => document.querySelector('.table-view-btn')?.textContent.includes('Launches'));
      assert.equal(weave.tableView(`${jobs.id}/Launches`).search, 'launch', 'the copy carries the search');
      await rowsAre(page, LAUNCH());
      assert.equal(await page.inputValue('.table-search-input'), 'launch');
    } finally { reset(); await page.close(); }
  });

  test('a view started from Blank has no search, and each view keeps its own', async () => {
    reset();
    weave.tableView(`${jobs.id}/Standard`, { search: 'launch' });
    const page = await open();
    try {
      await rowsAre(page, LAUNCH());
      await views(page);
      await page.click('.view-strip .view-add');
      await page.locator('.view-strip .view-name-input').press('Enter');
      await page.waitForFunction(() => document.querySelector('.table-view-btn')?.textContent.includes('View 2'));
      assert.equal(weave.tableView(`${jobs.id}/View 2`).search, undefined, 'Blank clears it');
      await rowCount(page, TOTAL);
      assert.equal(await page.inputValue('.table-search-input'), '');
      await search(page, 'cleanup');
      await rowsAre(page, [named['Gamma cleanup'].id]);
      assert.equal(weave.tableView(`${jobs.id}/View 2`).search, 'cleanup');
      assert.equal(weave.tableView(`${jobs.id}/Standard`).search, 'launch', 'the other view kept its search');
      await page.goto(`${base}/#/table/${jobs.id}/view/${weave.tableView(`${jobs.id}/Standard`).id}`, { waitUntil: 'networkidle' });
      await rowsAre(page, LAUNCH());
      assert.equal(await page.inputValue('.table-search-input'), 'launch');
    } finally { reset(); await page.close(); }
  });

  test('the raw Blank table searches for you alone and writes nothing', async () => {
    reset();
    const page = await open(`#/table/${jobs.id}/view/blank`);
    try {
      let patches = 0;
      page.on('request', (r) => { if (r.method() === 'PATCH') patches++; });
      await page.fill('.table-search-input', 'launch');
      await rowsAre(page, LAUNCH());
      await page.waitForLoadState('networkidle');
      assert.equal(patches, 0, 'no PATCH from the read-only Blank');
      assert.equal(await page.locator('#wv-toasts > :not(.visually-hidden)').count(), 0, 'and no read-only toast');
      assert.equal(weave.tableView(`${jobs.id}/Standard`).search, undefined);
    } finally { reset(); await page.close(); }
  });
}
