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
  for (let i = 0; i < 500; i++) weave.createEntity(jobs, { name: `Filler row ${i}`, values: { Status: 'Open' } });
});

if (s) {
  const { base, browser, weave } = s;
  const TOTAL = 503;

  const open = async () => {
    weave.tableView(`${jobs.id}/${weave.tableView(jobs).views[0].name}`, { search: '' });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${base}/#/table/${jobs.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    return page;
  };
  const shown = (page) => page.locator('.wv-grid tbody tr.entity-row').evaluateAll((rs) => rs.map((r) => r.dataset.eid).sort());
  const rowsAre = (page, ids) => page.waitForFunction((want) => {
    const got = [...document.querySelectorAll('.wv-grid tbody tr.entity-row')].map((r) => r.dataset.eid).sort();
    return JSON.stringify(got) === JSON.stringify(want);
  }, [...ids].sort());
  const typeSearch = async (page, text) => {
    await page.fill('.table-search-input', text);
  };

  test('typing narrows the grid across every page, and only the view\'s search is written', async () => {
    const page = await open();
    try {
      const patches = [];
      page.on('request', (r) => { if (r.method() === 'PATCH' && r.url().includes(`/tables/${jobs.id}`)) patches.push(r.postDataJSON()); });
      assert.match(await page.textContent('.wv-loaded'), /200 of 503 loaded/, 'the grid opens paged');
      await typeSearch(page, 'launch');
      await rowsAre(page, [named['Alpha launch'].id, named['Beta launch'].id]);
      const server = weave.query(jobs, { search: 'launch' }).items.map((e) => e.id).sort();
      assert.deepEqual(await shown(page), server, 'the grid shows what the engine returns');
      assert.match(await page.textContent('.wv-loaded'), /2 rows found/, 'the foot counts the matches');
      assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('table-search-input')), true, 'the caret stays in the box');
      await page.waitForLoadState('networkidle');
      assert.ok(patches.length && patches.every((p) => JSON.stringify(Object.keys(p)) === '["search"]'), 'each PATCH carries the search alone');
      assert.equal(weave.tableView(jobs).views[0].search, 'launch', 'the view holds the search (Feature #307)');
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
      assert.match(await page.textContent('.table-search-empty'), /No rows match/);
      assert.equal((await shown(page)).length, 0);
      await page.click('.table-search-empty .table-search-clear');
      await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody tr.entity-row').length > 3);
      assert.equal(await page.inputValue('.table-search-input'), '', 'the box is cleared');
      assert.equal(await page.locator('.table-search-empty').count(), 0);
      assert.match(await page.textContent('.wv-loaded'), /of 503 loaded/, 'the whole table is back');
    } finally { await page.close(); }
  });

  test('Esc clears and keeps the search available', async () => {
    const page = await open();
    try {
      await typeSearch(page, 'cleanup');
      await rowsAre(page, [named['Gamma cleanup'].id]);
      await page.press('.table-search-input', 'Escape');
      await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody tr.entity-row').length > 3);
      assert.equal(await page.isVisible('.table-search-input'), true, 'the search remains available');
      assert.equal(await page.inputValue('.table-search-input'), '', 'Escape cleared the query');
    } finally { await page.close(); }
  });

  test('/ from the grid opens the box, and no cell starts editing', async () => {
    const page = await open();
    try {
      const controls = () => page.locator('.wv-grid tbody td input, .wv-grid tbody td textarea').count();
      await page.locator('.wv-grid tbody tr.entity-row td[tabindex="0"]').first().focus();
      const before = await controls();
      await page.keyboard.press('/');
      await page.waitForFunction(() => document.activeElement?.classList.contains('table-search-input'));
      assert.equal(await page.inputValue('.table-search-input'), '', '/ typed nothing into the box');
      assert.equal(await controls(), before, '/ opened no cell editor');
      await page.press('.table-search-input', 'Escape');
      assert.equal(await page.isVisible('.table-search-input'), true);
    } finally { await page.close(); }
  });

  test('⌘F and Ctrl-F on a focused cell are left to the browser find bar (Issue #822)', async () => {
    const page = await open();
    try {
      await page.evaluate(() => {
        window.wvFindKeys = [];
        window.addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'f') window.wvFindKeys.push(e); }, true);
      });
      for (const key of ['Meta+f', 'Control+f']) {
        const cell = page.locator('.wv-grid tbody tr.entity-row td[tabindex="0"]').first();
        await cell.focus();
        await page.keyboard.press(key);
        const seen = await page.evaluate(() => {
          const e = window.wvFindKeys.pop();
          return { prevented: e?.defaultPrevented, search: document.activeElement?.classList.contains('table-search-input') };
        });
        assert.equal(seen.prevented, false, `${key} reaches the browser`);
        assert.equal(seen.search, false, `${key} leaves the table search alone`);
        assert.equal(await cell.evaluate((td) => td === document.activeElement), true, `${key} keeps the cell focused`);
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

  test('+ New during a search clears the search and shows the new row', async () => {
    const page = await open();
    try {
      await typeSearch(page, 'cleanup');
      await rowsAre(page, [named['Gamma cleanup'].id]);
      await page.click('.add-entity-btn');
      await page.waitForFunction((n) => /of (\d+) loaded/.exec(document.querySelector('.wv-loaded')?.textContent ?? '')?.[1] === String(n), TOTAL + 1);
      assert.equal(await page.inputValue('.table-search-input'), '', 'the search cleared');
      assert.equal(await page.isVisible('.table-search-input'), true, 'the search remains available');
      const created = weave.query(jobs, {}).items.find((e) => !e.name);
      assert.ok(created, 'the row was made');
      await page.waitForFunction((id) => document.activeElement?.closest?.('tr.entity-row')?.dataset.eid === id, created.id);
    } finally { await page.close(); }
  });
  test('the toolbar search icon draws no border of its own while the search box keeps its border', async () => {
    const page = await open();
    try {
      const ring = () => page.evaluate(() => {
        const btn = getComputedStyle(document.querySelector('.crumb-actions .table-search-btn'));
        const box = getComputedStyle(document.querySelector('.crumb-actions .table-search'));
        return { btn: [btn.borderTopWidth, btn.boxShadow, btn.backgroundColor], box: box.borderTopWidth };
      });
      const bare = ['0px', 'none', 'rgba(0, 0, 0, 0)'];
      assert.deepEqual(await ring(), { btn: bare, box: '1px' }, 'at rest');
      await page.hover('.crumb-actions .table-search-btn');
      assert.deepEqual(await ring(), { btn: bare, box: '1px' }, 'on hover');
      await page.focus('.crumb-actions .table-search-btn');
      assert.deepEqual(await ring(), { btn: bare, box: '1px' }, 'on focus');
    } finally { await page.close(); }
  });
}
