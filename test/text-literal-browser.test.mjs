/* A literal text field paints its characters (Issue #86), in a real grid.
   Playwright is NOT a dependency of weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const SYNTAX = '**…** · *…* · `code`';
let table, row;
const s = await launch('literal text', (weave) => {
  weave.createSpace({ name: 'Showcase' });
  table = weave.createTable({ space: 'Showcase', name: 'Formatting' });
  weave.addField(table, { name: 'Syntax', type: 'text', config: { literal: true } });
  weave.addField(table, { name: 'Note', type: 'text' });
  row = weave.createEntity(table, { name: 'Marks', values: { Syntax: SYNTAX, Note: SYNTAX } });
});

if (s) {
  const { base, browser } = s;
  test('a literal column shows the syntax; a plain column dresses the same value', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`tr[data-eid="${row.id}"]`);
    const cells = await page.evaluate((id) => {
      const tr = document.querySelector(`tr[data-eid="${id}"]`);
      const read = (f) => { const td = tr.querySelector(`td[data-field="${f}"]`); return { dressed: !!td.querySelector('.text-dressed'), input: td.querySelector('input')?.value ?? null, text: td.textContent.trim() }; };
      return { syntax: read('Syntax'), note: read('Note') };
    }, row.id);
    assert.equal(cells.syntax.dressed, false, 'the literal column is not dressed');
    assert.equal(cells.syntax.input, SYNTAX, 'its box holds the characters as typed');
    assert.equal(cells.note.dressed, true, 'the plain column still wears its marks');
    await page.close();
  });
}
