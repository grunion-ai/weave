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
      const read = (f) => { const td = tr.querySelector(`td[data-field="${f}"]`); return { marks: !!td.querySelector('.text-dressed :is(strong, em, code)'), text: td.querySelector('.text-dressed')?.textContent ?? null }; };
      return { syntax: read('Syntax'), note: read('Note') };
    }, row.id);
    assert.equal(cells.syntax.marks, false, 'the literal column draws no marks');
    assert.equal(cells.syntax.text, SYNTAX, 'it rests as the characters as typed (Issue #447)');
    assert.equal(cells.note.marks, true, 'the plain column still wears its marks');
    await page.close();
  });
}
