import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let sessions, entries, journal;
const ROWS = [
  { name: 'sep-09', Created: '2026-09-09T09:51', Cache: 15829984, Window: { start: '2026-09-09', end: '2026-09-12' } },
  { name: 'oct-01', Created: '2026-10-01T00:05', Cache: 900, Window: { start: '2026-10-01', end: '2026-10-03' } },
  { name: 'sep-12', Created: '2026-09-12T07:32', Cache: 2048, Window: { start: '2026-09-09', end: '2026-09-30' } },
];
const s = await launch('a grid sorts by value, not costume', (weave) => {
  weave.createSpace({ name: 'Agent' });
  sessions = weave.createTable({ space: 'Agent', name: 'Session' });
  weave.addField(sessions, { name: 'Created', type: 'date', config: { format: 'long', time: true } });
  weave.addField(sessions, { name: 'Cache Read', type: 'number', config: { separator: true } });
  weave.addField(sessions, { name: 'Window', type: 'daterange', config: { format: 'long' } });
  for (const r of ROWS) weave.createEntity(sessions, { name: r.name, values: { Created: r.Created, 'Cache Read': r.Cache, Window: r.Window } });
  weave.updateTable(sessions, { sort: [{ field: 'Created', dir: 'desc' }] });
  entries = weave.createTable({ space: 'Agent', name: 'Entry' });
  weave.addField(entries, { name: 'Stage', type: 'select', config: { options: ['Now', 'Next', 'Later'] } });
  for (const [name, at] of [['middle', '2026-09-10T08:00:00.000Z'], ['oldest', '2026-09-01T08:00:00.000Z'], ['newest', '2026-09-12T08:00:00.000Z']]) {
    const e = weave.createEntity(entries, { name });
    weave.state.entities[e.id].createdAt = at;
  }
  weave.updateTable(entries, { systemFields: ['Created At', 'Activity'] });
  journal = weave.createTable({ space: 'Agent', name: 'Journal' });
  weave.addField(journal, { name: 'Note', type: 'text' });
  for (let i = 1; i <= 12; i++) {
    const e = weave.createEntity(journal, { name: `j${String(i).padStart(2, '0')}` });
    weave.state.entities[e.id].updatedAt = `2026-09-${String(20 - i).padStart(2, '0')}T08:00:00.000Z`;
  }
  weave.updateTable(journal, { systemFields: ['Modified At'], sort: [{ field: 'Modified At', dir: 'desc' }] });
});

if (s) {
  const { base, browser, weave } = s;
  const open = async () => {
    for (const t of Object.values(weave.state.tables)) if (!t.system) for (const v of t.tableViews ?? []) if (v.deleted) weave.tableView(`${t.id}/${v.id}`, { deleted: false });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${base}/#/table/${sessions.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    return page;
  };
  const order = (page) => page.$$eval('.wv-grid tbody tr.entity-row td.name-cell', (tds) => tds.map((td) => td.querySelector('input')?.value ?? td.textContent.trim()));
  const stopPaging = async (page) => {
    await page.click('.eye-btn');
    await page.waitForSelector('.chip-pop .eye-row');
    const read = page.waitForResponse((r) => r.url().includes('/trash'));
    await page.locator('.chip-pop .eye-row', { hasText: 'Deleted' }).first().click();
    await read;
    await page.waitForLoadState('networkidle');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.chip-pop', { state: 'detached' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
  };

  test('a date column reads newest first, whichever half does the sorting', async () => {
    const page = await open();
    const cells = await page.$$eval('.wv-grid tbody tr.entity-row td[data-field="Created"] input', (ins) => ins.map((i) => i.value));
    assert.ok(cells.every((c) => /^(Sep|Oct) \d+, 2026/.test(c)), `the cells wear the long format: ${cells.join(' | ')}`);
    assert.deepEqual(await order(page), ['oct-01', 'sep-12', 'sep-09'], 'paged: the server orders page one');
    await stopPaging(page);
    assert.deepEqual(await order(page), ['oct-01', 'sep-12', 'sep-09'], 'whole table: app.js orders it the same way');
    await page.close();
  });

  test('a number column sorts through its separators when the grid sorts itself', async () => {
    const page = await open();
    await stopPaging(page);
    await page.locator('.wv-grid thead th', { hasText: 'Cache Read' }).locator('.field-menu').click();
    await page.locator('.chip-pop .wv-menu-row', { hasText: 'Smallest to largest' }).first().click();
    await page.waitForFunction(() => document.querySelector('.wv-grid tbody tr.entity-row td.name-cell input')?.value === 'oct-01');
    assert.deepEqual(await order(page), ['oct-01', 'sep-12', 'sep-09'], '900 < 2,048 < 15,829,984');
    await page.close();
  });

  test('a daterange column reads earliest span first, whichever half does the sorting (Issue #287)', async () => {
    const page = await open();
    const cells = await page.$$eval('.wv-grid tbody tr.entity-row td[data-field="Window"] input', (ins) => ins.map((i) => i.value));
    assert.ok(cells.every((c) => / – /.test(c)), `the cells wear the painted span: ${cells.join(' | ')}`);
    await page.locator('.wv-grid thead th', { hasText: 'Window' }).locator('.field-menu').click();
    await page.locator('.chip-pop .wv-menu-row', { hasText: 'Oldest to newest' }).first().click();
    await page.waitForFunction(() => document.querySelector('.wv-grid tbody tr.entity-row td.name-cell input')?.value === 'sep-09');
    assert.deepEqual(await order(page), ['sep-09', 'sep-12', 'oct-01'], 'paged: the server orders page one');
    await page.close();
  });

  test('the grid sorts a daterange itself the same way the server does (Issue #287)', async () => {
    const page = await open();
    await stopPaging(page);
    await page.locator('.wv-grid thead th', { hasText: 'Window' }).locator('.field-menu').click();
    await page.locator('.chip-pop .wv-menu-row', { hasText: 'Oldest to newest' }).first().click();
    await page.waitForFunction(() => document.querySelector('.wv-grid tbody tr.entity-row td.name-cell input')?.value === 'sep-09');
    assert.deepEqual(await order(page), ['sep-09', 'sep-12', 'oct-01'], 'Sep 9–12 < Sep 9–30 < Oct 1–3');
    await page.close();
  });

  const openEntries = async (theme) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${base}/#/table/${entries.id}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    return page;
  };
  const menuOf = async (page, th) => {
    await th.hover();
    const btn = th.locator('.field-menu');
    await page.waitForFunction((b) => getComputedStyle(b).opacity === '1', await btn.elementHandle());
    const ink = await btn.evaluate((b) => [getComputedStyle(b).color, getComputedStyle(b.closest('th')).backgroundColor]);
    assert.notEqual(ink[0], ink[1], `the ⋮ does not vanish into its header: ${ink.join(' on ')}`);
    await btn.click();
    await page.waitForSelector('.chip-pop .wv-menu-row');
    return page.locator('.chip-pop');
  };
  const labels = (pop) => pop.locator('.wv-menu-label').allTextContents();

  for (const theme of ['light', 'dark']) {
    test(`${theme}: Created At sorts from its own ⋮, worded as dates (Issues #254, #273)`, async () => {
      const page = await openEntries(theme);
      try {
        assert.deepEqual(await order(page), ['middle', 'oldest', 'newest'], 'unsorted, the rows stand in the order they were made');
        const head = page.locator('.wv-grid thead th.sys-head', { hasText: 'Created At' });
        let pop = await menuOf(page, head);
        assert.equal((await pop.locator('.wv-menu-title').textContent()).trim(), 'Created At');
        assert.equal((await pop.locator('.wv-menu-kind').textContent()).trim(), 'system');
        assert.deepEqual(await labels(pop), ['Oldest to newest', 'Newest to oldest']);
        await pop.locator('.wv-menu-row', { hasText: 'Newest to oldest' }).click();
        await page.waitForFunction(() => document.querySelector('.wv-grid tbody tr.entity-row td.name-cell input')?.value === 'newest');
        assert.deepEqual(await order(page), ['newest', 'middle', 'oldest'], 'paged: the server orders by the stamp');
        assert.equal(await head.locator('.wv-icon-xs').count(), 1, 'the header wears the sort arrow');
        assert.deepEqual(s.weave.describeSchema().flatMap((sp) => sp.tables).find((x) => x.id === entries.id).sort, [{ field: 'Created At', dir: 'desc' }], 'the direction stored is still desc (on the default view, Feature #229)');
        await page.reload({ waitUntil: 'networkidle' });
        await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
        await page.waitForSelector('.wv-grid tbody tr.entity-row');
        assert.deepEqual(await order(page), ['newest', 'middle', 'oldest'], 'stored, so a reload keeps it');
        pop = await menuOf(page, page.locator('.wv-grid thead th.sys-head', { hasText: 'Created At' }));
        assert.equal(await pop.locator('.wv-menu-row', { hasText: 'Newest to oldest' }).locator('.chip-pop-check').count(), 1);
        assert.deepEqual(await labels(pop), ['Oldest to newest', 'Newest to oldest', 'Clear sort']);
        await pop.locator('.wv-menu-row', { hasText: 'Clear sort' }).click();
        await page.waitForFunction(() => document.querySelector('.wv-grid tbody tr.entity-row td.name-cell input')?.value === 'middle');
      } finally { await page.close(); }
    });
  }

  test('the grid sorts a system column itself the way the server does, and # reads as a number', async () => {
    const page = await openEntries('light');
    try {
      await stopPaging(page);
      let pop = await menuOf(page, page.locator('.wv-grid thead th.sys-head', { hasText: 'Created At' }));
      await pop.locator('.wv-menu-row', { hasText: 'Oldest to newest' }).click();
      await page.waitForFunction(() => document.querySelector('.wv-grid tbody tr.entity-row td.name-cell input')?.value === 'oldest');
      assert.deepEqual(await order(page), ['oldest', 'middle', 'newest'], 'whole table: app.js orders by the stamp too');
      assert.equal(await page.locator('.wv-grid thead th.sys-head', { hasText: 'Activity' }).locator('.field-menu').count(), 0);
      pop = await menuOf(page, page.locator('.wv-grid thead th.pid-head'));
      assert.equal((await pop.locator('.wv-menu-title').textContent()).trim(), '#');
      assert.deepEqual(await labels(pop), ['Smallest to largest', 'Largest to smallest']);
      await pop.locator('.wv-menu-row', { hasText: 'Largest to smallest' }).click();
      await page.waitForFunction(() => document.querySelector('.wv-grid tbody tr.entity-row td.name-cell input')?.value === 'newest');
      assert.deepEqual(await order(page), ['newest', 'oldest', 'middle'], '#3, #2, #1');
      pop = await menuOf(page, page.locator('.wv-grid thead th.col-head', { hasText: 'Stage' }));
      const words = await labels(pop);
      assert.ok(words.includes('Option order') && words.includes('Reverse option order'), words.join(' | '));
      assert.ok(!words.some((w) => /Sort ascending|Sort descending/.test(w)), 'no type-blind wording left');
    } finally { await page.close(); }
  });

  test('an edit deep in a Modified At sort lifts the row to the top without a reload', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${journal.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      const before = await order(page);
      assert.equal(before[0], 'j01', 'newest first');
      assert.equal(before.at(-1), 'j12', 'the oldest row is last');
      const last = await page.$$eval('.wv-grid tbody tr.entity-row', (trs) => trs.at(-1).dataset.eid);
      const landed = page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/api\/entities\//.test(r.url()));
      await page.fill(`tr[data-eid="${last}"] td[data-field="Note"] input`, 'touched');
      await page.keyboard.press('Tab');
      await landed;
      await page.waitForFunction(() => document.querySelector('.wv-grid tbody tr.entity-row td.name-cell input')?.value === 'j12', null, { timeout: 5000 })
        .catch(() => {});
      assert.deepEqual((await order(page)).slice(0, 2), ['j12', 'j01'], 'the edited row leads, as the server orders it');
    } finally { await page.close(); }
  });
}
