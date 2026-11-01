import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const para = (word, n) => Array.from({ length: n }, (_, i) => `${word} paragraph ${i + 1} with enough words on the line to read as prose and to fill the dock past its bottom edge.`).join('\n\n');

let deals, a, b;
const s = await launch('dock scroll top', (weave) => {
  weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deals' });
  weave.addField(deals, { name: 'Note', type: 'text' });
  a = weave.createEntity(deals, { name: 'Acme Working Capital', doc: para('Acme', 60) });
  b = weave.createEntity(deals, { name: 'Bluefin Renewal', doc: para('Bluefin', 60) });
});

if (s) {
  const { base, browser, weave } = s;

  const dockScroll = (page) => page.evaluate(() => {
    const d = document.querySelector('#dock');
    return { top: d.scrollTop, height: d.scrollHeight, client: d.clientHeight };
  });
  const dockedName = (page, name) => page.waitForFunction((n) => document.querySelector('#dock:not([hidden]) .name-edit')?.value === n, name);
  const scrollDockTo = async (page, y) => {
    await page.evaluate((to) => { document.querySelector('#dock').scrollTop = to; }, y);
    await page.waitForTimeout(150);
  };
  const openDockedA = async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.click(`tr[data-eid="${a.id}"] .open-link`);
    await dockedName(page, 'Acme Working Capital');
    await page.waitForSelector('#dock .entity-body');
    await page.waitForTimeout(300);
    return page;
  };

  test("another record opens at its own top, not the last record's offset (Issue #623)", async () => {
    const page = await openDockedA();
    await scrollDockTo(page, 100000);
    const before = await dockScroll(page);
    assert.ok(before.top > 100, `the first record scrolled: ${JSON.stringify(before)}`);

    await page.click(`tr[data-eid="${b.id}"] .open-link`);
    await dockedName(page, 'Bluefin Renewal');
    await page.waitForTimeout(400);
    const after = await dockScroll(page);
    assert.equal(after.top, 0, `the second record opens at its top: ${JSON.stringify(after)}`);

    const head = await page.evaluate(() => {
      const d = document.querySelector('#dock').getBoundingClientRect();
      const host = document.querySelector('#dock .dock-entity').getBoundingClientRect();
      const n = document.querySelector('#dock .name-edit').getBoundingClientRect();
      return { contentTopOffset: Math.round(host.top - d.top), nameWithin: n.top >= d.top - 1 && n.bottom <= d.bottom + 1 };
    });
    assert.equal(head.contentTopOffset, 0, `the record starts at the dock's top edge, nothing of it above the reader: ${JSON.stringify(head)}`);
    assert.ok(head.nameWithin, `the record's name reads inside the dock: ${JSON.stringify(head)}`);
    await page.close();
  });

  test('a redraw of the same record leaves the reader where they were (Issue #623)', async () => {
    const page = await openDockedA();
    const note = '#dock .fieldrow[data-field="Note"] input';
    await page.waitForSelector(note);
    await page.fill(note, 'ships Friday');
    await scrollDockTo(page, 700);
    const before = await dockScroll(page);
    assert.ok(before.top > 100, `the dock holds an offset before the edit commits: ${JSON.stringify(before)}`);

    await page.evaluate(() => document.activeElement?.blur());
    const stored = () => weave.readEntity(a.id).fields.Note;
    for (let i = 0; i < 60 && stored() !== 'ships Friday'; i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(stored(), 'ships Friday', 'the edit committed');
    await page.waitForTimeout(500);

    const after = await dockScroll(page);
    assert.ok(Math.abs(after.top - before.top) <= 2, `the same record's redraw held the offset: ${before.top} -> ${after.top}`);
    await page.close();
  });
}
