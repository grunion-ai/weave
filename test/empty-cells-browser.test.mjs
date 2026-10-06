import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let items, empty;
const s = await launch('empty cells', (weave) => {
  weave.createSpace({ name: 'Ops' });
  const people = weave.createTable({ space: 'Ops', name: 'Person' });
  items = weave.createTable({ space: 'Ops', name: 'Item' });
  weave.addField(items, { name: 'Kind', type: 'select', config: { options: ['Bug', 'Chore'] } });
  weave.addField(items, { name: 'Tags', type: 'multiselect', config: { options: ['a', 'b'] } });
  weave.addField(items, { name: 'Due', type: 'date' });
  weave.addField(items, { name: 'Window', type: 'daterange' });
  weave.addField(items, { name: 'Owner note', type: 'text' });
  weave.addField(items, { name: 'Points', type: 'number' });
  weave.addField(items, { name: 'Link', type: 'url' });
  weave.addField(items, { name: 'Files', type: 'attachments' });
  weave.addRelation(items, { name: 'Owner', targetDb: people, cardinality: 'many-to-one', inverseName: 'Items' });
  weave.addField(items, { name: 'Owner name', type: 'lookup', config: { relationField: 'Owner', targetField: 'Name' } });
  empty = weave.createEntity(items, { name: 'Nothing set' });
});

if (s) {
  const { base, browser } = s;

  const marks = (page, rowId) => page.evaluate((id) => {
    const tr = document.querySelector(`.wv-grid tbody tr.entity-row[data-eid="${id}"]`);
    const shown = (node) => {
      for (let n = node; n && n !== tr; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      }
      return true;
    };
    const alpha = (c) => (c === 'transparent' ? 0 : Number((c.match(/rgba?\(([^)]+)\)/)?.[1] ?? '').split(',')[3] ?? 1));
    const out = {};
    for (const td of tr.querySelectorAll('td[data-field]')) {
      const field = td.dataset.field;
      if (field === 'Name') continue;
      const found = [];
      const walk = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
      for (let t = walk.nextNode(); t; t = walk.nextNode()) {
        const p = t.parentElement;
        if (t.textContent.trim() && shown(p) && alpha(getComputedStyle(p).color) > 0) found.push(`text:${t.textContent.trim()}`);
      }
      for (const inp of td.querySelectorAll('input[placeholder]')) {
        if (inp.placeholder && !inp.value && shown(inp) && alpha(getComputedStyle(inp, '::placeholder').color) > 0) found.push(`placeholder:${inp.placeholder}`);
      }
      for (const n of td.querySelectorAll('*')) {
        const cs = getComputedStyle(n);
        if (cs.borderTopStyle === 'dashed' && parseFloat(cs.borderTopWidth) > 0 && alpha(cs.borderTopColor) > 0 && shown(n)) found.push(`dashed:${n.className}`);
      }
      if (found.length) out[field] = found;
    }
    return out;
  }, rowId);

  const openGrid = async (theme) => {
    const page = await browser.newPage({ viewport: { width: 2200, height: 700 } });
    await page.goto(`${base}/#/table/${items.id}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector(`.wv-grid tbody tr.entity-row[data-eid="${empty.id}"]`);
    return page;
  };

  for (const theme of ['light', 'dark']) {
    test(`a row with every field empty shows nothing in its cells at rest (${theme})`, async () => {
      const page = await openGrid(theme);
      assert.deepEqual(await marks(page, empty.id), {}, 'no hint, dash or placeholder at rest');
      await page.close();
    });
  }

  test('the focused cell shows its hint', async () => {
    const page = await openGrid('light');
    const cell = (f) => page.locator(`.wv-grid tbody tr.entity-row[data-eid="${empty.id}"] td[data-field="${f}"]`);
    await cell('Due').locator('input').first().focus();
    assert.ok((await marks(page, empty.id)).Due?.some((m) => m.startsWith('placeholder:')), 'the date hint shows while editing');
    await cell('Kind').focus();
    const m = await marks(page, empty.id);
    assert.ok(m.Kind?.length, 'the select shows its empty chip on focus');
    assert.equal(m.Due, undefined, 'and the date cell it left is blank again');
    await page.close();
  });

  test('an invisible empty chip still opens its picker on a click', async () => {
    const page = await openGrid('light');
    await page.locator(`.wv-grid tbody tr.entity-row[data-eid="${empty.id}"] td[data-field="Kind"]`).click();
    await page.waitForSelector('.chip-pop');
    await page.close();
  });
}
