import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const N = 500;
let cases, small, smallIds = [], ids = [];
const s = await launch('a cell commit patches in place', (weave) => {
  weave.createSpace({ name: 'Quality' });
  const suites = weave.createTable({ space: 'Quality', name: 'Suite' });
  small = weave.createTable({ space: 'Quality', name: 'Small' });
  weave.addField(small, { name: 'Note', type: 'text' });
  for (const [n, note] of [['b row', 'x'], ['a row', 'y'], ['c row', 'z']]) {
    smallIds.push(weave.createEntity(small, { name: n, values: { Note: note } }).id);
  }
  cases = weave.createTable({ space: 'Quality', name: 'Case' });
  weave.addField(cases, { name: 'Status', type: 'select', config: { options: ['pass', 'fail'] } });
  weave.addRelation(cases, { name: 'Suite', targetDb: suites, cardinality: 'many-to-one', inverseName: 'Cases' });
  weave.addRelation(cases, { name: 'Parent', targetDb: cases, cardinality: 'many-to-one', inverseName: 'Children' });
  weave.addField(cases, { name: 'Parent name', type: 'lookup', config: { relationField: 'Parent', targetField: 'Name' } });
  const st = weave.createEntity(suites, { name: 'engine' });
  for (let i = 0; i < N; i++) {
    ids.push(weave.createEntity(cases, { name: `case ${String(i).padStart(4, '0')}`, values: { Status: i % 2 ? 'pass' : 'fail', Suite: st.id } }).id);
  }
  weave.updateEntity(ids[1], { Parent: ids[0] });
});

if (s) {
  const { base, browser } = s;

  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.__seen = [];
    page.__body = new Map();
    page.on('request', (r) => {
      try {
        page.__seen.push(`${r.method()} ${new URL(r.url()).pathname}`);
        page.__body.set(`${r.method()} ${new URL(r.url()).pathname}`, r.postData() ?? '');
      } catch {}
    });
    await page.goto(`${base}/#/table/${cases.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    return page;
  };
  const arm = (page) => { page.__seen.length = 0; page.__body.clear(); };
  const seen = (page, re) => page.__seen.filter((r) => re.test(r));
  const commitLands = (page) => page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/api\/entities\//.test(r.url()));
  const settle = async (page, landed) => {
    await landed;
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  };
  const shape = (page) => page.evaluate(() => {
    const wrap = document.querySelector('.table-wrap');
    const box = wrap.classList.contains('wv-grid-scroll') ? wrap : document.scrollingElement;
    return { rows: document.querySelectorAll('.wv-grid tbody tr.entity-row').length, top: box.scrollTop };
  });

  test('a Name commit fires one PATCH and no table query, and leaves the grid standing', async () => {
    const page = await open();
    try {
      await page.evaluate(() => {
        const wrap = document.querySelector('.table-wrap');
        (wrap.classList.contains('wv-grid-scroll') ? wrap : document.scrollingElement).scrollTo({ top: 3000, behavior: 'instant' });
      });
      const target = await page.waitForFunction(() => {
        const wrap = document.querySelector('.table-wrap');
        const edge = Math.max(0, document.querySelector('.wv-grid thead th').getBoundingClientRect().bottom);
        const bottom = Math.min(innerHeight, wrap.getBoundingClientRect().bottom);
        const visible = [...document.querySelectorAll('.wv-grid tbody tr.entity-row')].filter(row => {
          const r = row.getBoundingClientRect();
          return Number(row.dataset.i) > 10 && r.top >= edge && r.bottom <= bottom;
        });
        return !document.querySelector('.wv-grid tbody tr.entity-row-pending') && visible[3]?.dataset.eid;
      }, null, { timeout: 8000 });
      const eid = await target.jsonValue();
      await target.dispose();
      await page.click(`tr[data-eid="${eid}"] td[data-field="Name"] input`);
      const before = await shape(page);
      assert.ok(before.rows > 0 && before.rows < 200, `${before.rows} rows drawn`);
      arm(page);
      await page.keyboard.type(' edited');
      const landed = commitLands(page);
      await page.keyboard.press('Tab');
      await settle(page, landed);

      assert.equal(seen(page, /^PATCH \/api\/entities\//).length, 1, `one PATCH: ${JSON.stringify(page.__seen)}`);
      assert.deepEqual(seen(page, /\/api\/tables\/.*\/query$/), [], `and no table query: ${JSON.stringify(page.__seen)}`);
      assert.deepEqual(seen(page, /^GET \/api\/entities\//), [], 'the PATCH answers with the fresh row; nothing re-reads it');

      const after = await shape(page);
      assert.equal(after.rows, before.rows, 'the same rows are drawn');
      assert.equal(after.top, before.top, 'at exactly the same scroll');

      const land = await page.evaluate(() => {
        const td = document.activeElement?.closest?.('tr[data-eid] > td');
        return { eid: td?.parentElement.dataset.eid ?? null, field: td?.dataset.field ?? null, tag: document.activeElement?.tagName };
      });
      assert.deepEqual(land, { eid, field: 'Description', tag: 'TD' }, `focus is where Tab put it: ${JSON.stringify(land)}`);

      const value = await page.evaluate((e) => document.querySelector(`tr[data-eid="${e}"] td[data-field="Name"] input`).value, eid);
      assert.match(value, / edited$/, 'and the cell shows what was committed');
    } finally { await page.close(); }
  });

  test('a row whose lookup reaches the edited one repaints, from one read', async () => {
    const page = await open();
    try {
      arm(page);
      await page.click(`tr[data-eid="${ids[0]}"] td[data-field="Name"] input`);
      await page.keyboard.type('!');
      const landed = commitLands(page);
      await page.keyboard.press('Tab');
      await page.waitForFunction(
        (e) => /!$/.test(document.querySelector(`tr[data-eid="${e}"] td[data-field="Parent name"]`)?.textContent ?? ''),
        ids[1], { timeout: 5000 },
      );
      await settle(page, landed);
      const reads = seen(page, /\/api\/tables\/.*\/query$/);
      assert.equal(reads.length, 1, `one read for the rows that went stale: ${JSON.stringify(page.__seen)}`);
      const body = JSON.parse(page.__body.get(reads[0]) || '{}');
      assert.deepEqual(body.where?.[0]?.slice(0, 2), ['id', 'in'], `the read names the rows: ${JSON.stringify(body)}`);
      assert.deepEqual([...body.where[0][2]].sort(), [ids[0], ids[1]].sort(), 'the edited row and the one that shows it');
      const rows = await page.evaluate(() => document.querySelectorAll('.wv-grid tbody tr.entity-row').length);
      assert.ok(rows > 0 && rows < 200, `${rows} rows drawn — the grid was not rebuilt whole`);
    } finally { await page.close(); }
  });

  test('an edit to the sorted column still re-reads the table, and the row moves', async () => {
    const page = await open();
    try {
      await page.evaluate((t) => fetch(`/api/tables/${t}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sort: [{ field: 'Name', dir: 'asc' }] }),
      }), cases.id);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      arm(page);
      await page.fill(`tr[data-eid="${ids[5]}"] td[data-field="Name"] input`, 'zzz last');
      const landed = commitLands(page);
      await page.keyboard.press('Tab');
      await settle(page, landed);
      assert.ok(seen(page, /\/api\/tables\/.*\/query$/).length >= 1, `the fallback re-read fired: ${JSON.stringify(page.__seen)}`);
      const stored = await page.evaluate(async (e) => (await (await fetch(`/api/entities/${e}`)).json()).name, ids[5]);
      assert.equal(stored, 'zzz last', 'and the value landed');
    } finally { await page.close(); }
  });

  test('a sort after an in-place commit still shows the committed value', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.__seen = []; page.__body = new Map();
    try {
      await page.goto(`${base}/#/table/${small.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector(`tr[data-eid="${smallIds[0]}"] td[data-field="Note"] input`);
      const landed = page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/api\/entities\//.test(r.url()));
      await page.fill(`tr[data-eid="${smallIds[0]}"] td[data-field="Note"] input`, 'patched');
      await page.keyboard.press('Tab');
      await landed;
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

      await page.click('.wv-grid thead button[aria-label="Configure field Name"]');
      await page.locator('.chip-pop .wv-menu-row', { hasText: 'A to Z' }).first().click();
      await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody tr.entity-row')[0]?.querySelector('td[data-field="Name"] input')?.value === 'a row', null, { timeout: 5000 });
      assert.equal(
        await page.inputValue(`tr[data-eid="${smallIds[0]}"] td[data-field="Note"] input`),
        'patched', 'the sorted redraw still shows the committed value');
    } finally { await page.close(); }
  });
}
