import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const SOURCE = 'Statement emailed by the issuer on the first of the month';

let table, row;
const s = await launch('cell ellipsis', (weave) => {
  weave.createSpace({ name: 'Travel' });
  table = weave.createTable({ space: 'Travel', name: 'Balance' });
  weave.addField(table, { name: 'Source', type: 'text' });
  weave.addField(table, { name: 'As of', type: 'date' });
  row = weave.createEntity(table, { name: SOURCE, values: { Source: SOURCE } });
  const v = weave.tableView(table.id).views[0];
  weave.tableView(`${table.id}/${v.id}`, { widths: { Source: 100, 'As of': 110 } });
});

if (s) {
  const { base, browser } = s;
  async function grid(colorScheme) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
    await page.goto(`${base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`tr[data-eid="${row.id}"] td[data-field="Source"] input`);
    await page.waitForTimeout(200);
    return page;
  }
  const cell = (field) => `tr[data-eid="${row.id}"] td[data-field="${field}"] input.inline-edit`;
  const readInput = (page, sel) => page.$eval(sel, (i) => ({
    value: i.value,
    cut: i.scrollWidth > i.clientWidth + 1,
    textOverflow: getComputedStyle(i).textOverflow,
    focused: document.activeElement === i,
  }));
  const readHint = (page, sel) => page.$eval(sel, (i) => ({
    placeholder: i.placeholder,
    color: getComputedStyle(i, '::placeholder').color,
    focused: document.activeElement === i,
  }));
  const transparent = (c) => c === 'transparent' || /rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)/.test(c);

  for (const colorScheme of ['light', 'dark']) {
    test(`a long text value ends in an ellipsis at rest, and clips again while it is edited (${colorScheme})`, async () => {
      const page = await grid(colorScheme);
      try {
        const rest = await readInput(page, cell('Source'));
        assert.equal(rest.value, SOURCE);
        assert.equal(rest.cut, true, 'the value really is longer than its 100px column');
        assert.equal(rest.textOverflow, 'ellipsis', 'at rest the cut is an ellipsis, not mid-letter');
        const name = await readInput(page, `tr[data-eid="${row.id}"] td.name-cell input.inline-edit`);
        assert.equal(name.textOverflow, 'ellipsis', 'the Name cell rests the same way');
        await page.$eval(cell('Source'), (i) => i.focus());
        const editing = await readInput(page, cell('Source'));
        assert.equal(editing.focused, true);
        assert.equal(editing.textOverflow, 'clip', 'focused, the input clips so the caret can scroll the whole value');
      } finally { await page.close(); }
    });

    test(`an empty date cell rests blank and shows its hint only on focus (${colorScheme})`, async () => {
      const page = await grid(colorScheme);
      try {
        const sel = `tr[data-eid="${row.id}"] td[data-field="As of"] input.date-text`;
        const rest = await readHint(page, sel);
        assert.ok(rest.placeholder, 'the date cell has a hint to hide');
        assert.ok(transparent(rest.color), `at rest the hint is not painted (got ${rest.color})`);
        await page.$eval(sel, (i) => i.focus());
        const focused = await readHint(page, sel);
        assert.equal(focused.focused, true);
        assert.ok(!transparent(focused.color), `focused, the hint shows (got ${focused.color})`);
      } finally { await page.close(); }
    });
  }
}
