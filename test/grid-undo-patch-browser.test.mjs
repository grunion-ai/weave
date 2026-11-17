import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';

let plain, sorted, rowA, hotA;

const s = await launch('an undo patches the rows it changed instead of rebuilding the grid', (weave) => {
  weave.createSpace({ name: 'Ops' });
  plain = weave.createTable({ space: 'Ops', name: 'Task' });
  weave.addField(plain, { name: 'Note', type: 'text' });
  rowA = weave.createEntity(plain, { name: 'Alpha', values: { Note: 'a0' } });
  weave.createEntity(plain, { name: 'Beta', values: { Note: 'b0' } });
  sorted = weave.createTable({ space: 'Ops', name: 'Ranked' });
  weave.addField(sorted, { name: 'Note', type: 'text' });
  hotA = weave.createEntity(sorted, { name: 'Gamma', values: { Note: 'g0' } });
  weave.createEntity(sorted, { name: 'Delta', values: { Note: 'd0' } });
  weave.tableView(`${sorted.id}/Standard`, { sort: [{ field: 'Note', dir: 'asc' }] });
});

if (s) {
  const { base, browser, weave } = s;
  const cell = (id, f) => `tr[data-eid="${id}"] td[data-field="${f}"]`;
  const stored = (id, f) => weave.readEntity(id).fields[f] ?? null;

  async function open(table, id, f) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.queries = [];
    page.on('request', (r) => {
      const { pathname } = new URL(r.url());
      if (r.method() === 'POST' && pathname.endsWith('/query')) page.queries.push(JSON.parse(r.postData() || '{}'));
    });
    await page.goto(`${base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`${cell(id, f)} .text-dressed`);
    return page;
  }

  const mark = (page, id) => page.evaluate((eid) => {
    document.querySelector('#main .table-wrap').__wvMark = 'wrap';
    document.querySelector(`tr[data-eid="${eid}"]`).__wvMark = 'row';
  }, id);

  const marks = (page, id) => page.evaluate((eid) => ({
    wrap: document.querySelector('#main .table-wrap')?.__wvMark ?? null,
    row: document.querySelector(`tr[data-eid="${eid}"]`)?.__wvMark ?? null,
  }), id);

  async function edit(page, id, f, text) {
    await page.click(`${cell(id, f)} .text-dressed`);
    await page.fill(`${cell(id, f)} input`, text);
    await page.keyboard.press('Tab');
    assert.equal(await eventually(() => stored(id, f), text), text, `${f} saved as ${text}`);
  }

  async function undo(page, id, was) {
    page.queries.length = 0;
    await page.keyboard.press('Meta+z');
    assert.equal(await eventually(() => stored(id, 'Note'), was), was, 'the undo put the value back');
    await page.waitForFunction(
      ([eid, v]) => document.querySelector(`tr[data-eid="${eid}"] td[data-field="Note"]`)?.textContent.includes(v),
      [id, was],
    );
  }

  test('an undone cell edit keeps the grid and the row it painted (Issue #1693)', async () => {
    const page = await open(plain, rowA.id, 'Note');
    await edit(page, rowA.id, 'Note', 'a1');
    await mark(page, rowA.id);
    await undo(page, rowA.id, 'a0');
    assert.deepEqual(await marks(page, rowA.id), { wrap: 'wrap', row: 'row' },
      'the undo patched the row in place: neither the table-wrap nor the row node was replaced');
    assert.deepEqual(page.queries, [{ where: [['id', 'in', [rowA.id]]], limit: -1 }],
      `the undo read only the row it changed, got ${JSON.stringify(page.queries)}`);
    await page.close();
  });

  test('an undone edit on a sorted field still rebuilds, since the row may move (Issue #1693)', async () => {
    const page = await open(sorted, hotA.id, 'Note');
    await edit(page, hotA.id, 'Note', 'a-first');
    await mark(page, hotA.id);
    await undo(page, hotA.id, 'g0');
    const kept = await marks(page, hotA.id);
    assert.equal(kept.wrap, null, 'a sorted view rebuilds, because patching cannot re-place the row');
    assert.ok(page.queries.some((q) => q.sort?.length), `the rebuild re-read the page, got ${JSON.stringify(page.queries)}`);
    await page.close();
  });

}
