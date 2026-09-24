/* Table search in the toolbar (Feature #228). A magnifier beside the
   table's controls opens a search box that narrows the grid as you type,
   with the ⌘K matcher scoped to this table: name, publicId (#143), text
   fields. The rows come from the server (`search` on the table query), so a
   paged table narrows across every page, not only the one loaded. It is
   transient view state: it composes with the saved filter and is never
   written to the table. Esc clears and collapses; / or ⌘F from the grid
   opens it; Enter on a single match opens that row; a miss says so and
   offers a clear.
   Playwright is NOT a dependency of weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let jobs;
const named = {};
const s = await launch('table search', (weave) => {
  weave.createSpace({ name: 'Ops' });
  jobs = weave.createTable({ space: 'Ops', name: 'Job' });
  weave.addField(jobs, { name: 'Notes', type: 'text' });
  weave.addField(jobs, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'Done', category: 'done' }] } });
  for (const [name, Notes, Status] of [
    ['Alpha launch', 'kickoff call', 'Open'],
    ['Beta launch', 'quarterly plan', 'Done'],
    ['Gamma cleanup', '', 'Open'],
  ]) named[name] = weave.createEntity(jobs, { name, values: { Notes, Status } });
  // Past one page (200), so the search has to come from the server.
  for (let i = 0; i < 500; i++) weave.createEntity(jobs, { name: `Filler row ${i}`, values: { Status: 'Open' } });
});

if (s) {
  const { base, browser, weave } = s;
  const TOTAL = 503;

  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${base}/#/table/${jobs.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    return page;
  };
  const shown = (page) => page.$$eval('.wv-grid tbody tr.entity-row', (rs) => rs.map((r) => r.dataset.eid).sort());
  const rowsAre = (page, ids) => page.waitForFunction((want) => {
    const got = [...document.querySelectorAll('.wv-grid tbody tr.entity-row')].map((r) => r.dataset.eid).sort();
    return JSON.stringify(got) === JSON.stringify(want);
  }, [...ids].sort());
  const typeSearch = async (page, text) => {
    await page.click('.table-search-btn');
    await page.fill('.table-search-input', text);
  };

  test('typing narrows the grid across every page, and the table is never written', async () => {
    const page = await open();
    try {
      let patches = 0;
      page.on('request', (r) => { if (r.method() === 'PATCH' && r.url().includes(`/tables/${jobs.id}`)) patches++; });
      assert.match(await page.textContent('.wv-loaded'), /200 of 503 loaded/, 'the grid opens paged');
      await typeSearch(page, 'launch');
      await rowsAre(page, [named['Alpha launch'].id, named['Beta launch'].id]);
      const server = weave.query(jobs, { search: 'launch' }).items.map((e) => e.id).sort();
      assert.deepEqual(await shown(page), server, 'the grid shows what the engine returns');
      assert.match(await page.textContent('.wv-loaded'), /2 records found/, 'the foot counts the matches');
      assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('table-search-input')), true, 'the caret stays in the box');
      await page.waitForLoadState('networkidle');
      assert.equal(patches, 0, 'no PATCH: the search is not saved');
      assert.deepEqual(weave.tableView(jobs).views[0].filters ?? {}, {}, 'the saved filter is untouched');
    } finally { await page.close(); }
  });

  test('a text-field value and a publicId both match', async () => {
    const page = await open();
    try {
      await typeSearch(page, 'kickoff');
      await rowsAre(page, [named['Alpha launch'].id]);
      await page.fill('.table-search-input', `#${named['Gamma cleanup'].publicId}`);
      await rowsAre(page, [named['Gamma cleanup'].id]);
    } finally { await page.close(); }
  });

  test('Enter on a single match opens that row', async () => {
    const page = await open();
    try {
      await typeSearch(page, `#${named['Beta launch'].publicId}`);
      await rowsAre(page, [named['Beta launch'].id]);
      await page.press('.table-search-input', 'Enter');
      await page.waitForSelector('#dock:not([hidden]) .name-edit');
      assert.equal(await page.inputValue('#dock .name-edit'), 'Beta launch');
    } finally { await page.close(); }
  });

  test('a miss says so, and its clear button restores every row', async () => {
    const page = await open();
    try {
      await typeSearch(page, 'zzzz nothing');
      await page.waitForSelector('.table-search-empty');
      assert.match(await page.textContent('.table-search-empty'), /No records match/);
      assert.equal((await shown(page)).length, 0);
      await page.click('.table-search-empty .table-search-clear');
      await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody tr.entity-row').length > 3);
      assert.equal(await page.inputValue('.table-search-input'), '', 'the box is cleared');
      assert.equal(await page.locator('.table-search-empty').count(), 0);
      assert.match(await page.textContent('.wv-loaded'), /of 503 loaded/, 'the whole table is back');
    } finally { await page.close(); }
  });

  test('Esc clears and collapses', async () => {
    const page = await open();
    try {
      await typeSearch(page, 'cleanup');
      await rowsAre(page, [named['Gamma cleanup'].id]);
      await page.press('.table-search-input', 'Escape');
      await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody tr.entity-row').length > 3);
      assert.equal(await page.isVisible('.table-search-input'), false, 'the box collapsed');
      assert.equal(await page.isVisible('.table-search-btn'), true, 'the magnifier is back');
    } finally { await page.close(); }
  });

  test('/ and ⌘F from the grid open the box, and no cell starts editing', async () => {
    const page = await open();
    try {
      const controls = () => page.locator('.wv-grid tbody td input, .wv-grid tbody td textarea').count();
      for (const key of ['/', 'ControlOrMeta+f']) {
        await page.locator('.wv-grid tbody tr.entity-row td[tabindex="0"]').first().focus();
        const before = await controls();
        await page.keyboard.press(key);
        await page.waitForFunction(() => document.activeElement?.classList.contains('table-search-input'));
        assert.equal(await page.inputValue('.table-search-input'), '', `${key} typed nothing into the box`);
        assert.equal(await controls(), before, `${key} opened no cell editor`);
        await page.press('.table-search-input', 'Escape');
        await page.waitForSelector('.table-search-input', { state: 'hidden' });
      }
    } finally { await page.close(); }
  });

  test('the search narrows the saved filter and leaves it in place', async () => {
    weave.updateTable(jobs, { filters: { Status: ['Open'] } });
    const page = await open();
    try {
      await typeSearch(page, 'launch');
      await rowsAre(page, [named['Alpha launch'].id]);
      await page.press('.table-search-input', 'Escape');
      await page.waitForFunction((n) => /of (\d+) loaded/.exec(document.querySelector('.wv-loaded')?.textContent ?? '')?.[1] === String(n), TOTAL - 1);
      assert.deepEqual(weave.tableView(jobs).views[0].filters, { Status: ['Open'] }, 'the saved filter is still the saved filter');
    } finally {
      weave.updateTable(jobs, { filters: {} });
      await page.close();
    }
  });

  // Last: it adds a row. A new row matches no search, so + New clears the
  // search first and the row lands where the reader can see it (Issue #341).
  test('+ New during a search clears the search and shows the new row', async () => {
    const page = await open();
    try {
      await typeSearch(page, 'cleanup');
      await rowsAre(page, [named['Gamma cleanup'].id]);
      await page.click('.add-entity-btn');
      await page.waitForFunction((n) => /of (\d+) loaded/.exec(document.querySelector('.wv-loaded')?.textContent ?? '')?.[1] === String(n), TOTAL + 1);
      assert.equal(await page.isVisible('.table-search-input'), false, 'the search stepped aside');
      const created = weave.query(jobs, {}).items.find((e) => !e.name);
      assert.ok(created, 'the row was made');
      await page.waitForFunction((id) => document.activeElement?.closest?.('tr.entity-row')?.dataset.eid === id, created.id);
    } finally { await page.close(); }
  });
}
