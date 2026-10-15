import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const LONG = 'A detailed explanation of the field and the choices available to the reader. '.repeat(24);
const s = await launch('description info', (w) => {
  w.createSpace({ name: 'Work' });
  const table = w.createTable({ space: 'Work', name: 'Task', description: LONG });
  const field = w.addField(table, { name: 'Stage', type: 'text', config: { description: LONG } });
  w.addField(table, { name: 'Short', type: 'text', config: { description: 'A short note.' } });
  w.addField(table, { name: 'Plain', type: 'text' });
  const row = w.createEntity(table, { name: 'First' });
  const empty = w.createTable({ space: 'Work', name: 'Empty' });
  return { table, field, row, empty };
});

if (s) {
  const { base, browser, table, row, empty } = s;
  for (const theme of ['light', 'dark']) for (const width of [1400, 390]) {
    test(`descriptions open, fold and persist with keyboard and pointer (${theme}, ${width}, Feature #302)`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
      try {
        await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
        assert.equal(await page.locator('html').getAttribute('data-bs-theme'), theme);
        const field = page.locator('.fieldrow[data-field="Stage"]');
        const icon = field.locator('.desc-info');
        const note = field.locator('.fieldrow-note');
        assert.equal(await icon.count(), 1);
        assert.equal(await note.isVisible(), false);
        assert.equal(await page.locator('.fieldrow[data-field="Plain"] .desc-info').count(), 0);
        assert.equal(await field.locator('.fieldrow-label').getAttribute('title'), 'Edit field');
        await icon.click();
        assert.equal(await note.isVisible(), true);
        assert.equal(await icon.getAttribute('aria-expanded'), 'true');
        assert.equal(await icon.getAttribute('aria-label'), 'Hide Stage description');
        assert.equal(await page.locator('textarea.field-desc').count(), 0);
        await note.getByRole('button', { name: 'Show more' }).waitFor();
        const folded = await note.locator('.desc-clamp').evaluate((n) => ({ height: n.clientHeight, line: parseFloat(getComputedStyle(n).lineHeight) }));
        assert.ok(folded.height <= folded.line * 3 + 1);
        await note.getByRole('button', { name: 'Show more' }).click();
        assert.equal(await note.getByRole('button', { name: 'Show less' }).count(), 1);
        await icon.focus();
        await page.keyboard.press('Space');
        assert.equal(await note.isVisible(), false);
        await page.keyboard.press('Enter');
        assert.equal(await note.isVisible(), true);
        const bounds = await note.boundingBox();
        const ib = await icon.boundingBox();
        assert.ok(ib.width >= 24 && ib.height >= 24);
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
        await page.reload({ waitUntil: 'networkidle' });
        assert.equal(await note.isVisible(), true);
        await page.locator('.fieldrow[data-field="Short"] .desc-info').click();
        assert.equal(await page.locator('.fieldrow[data-field="Short"] .view-desc-more').count(), 0);
        await page.goto(`${base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
        const tableIcon = page.locator('.view-title-row .desc-info');
        assert.equal(await page.locator('.view-desc').isVisible(), false);
        await tableIcon.click();
        await page.locator('.view-desc-more').waitFor();
        const measure = await page.locator('.view-desc-body').evaluate((n) => ({ height: n.clientHeight, line: parseFloat(getComputedStyle(n).lineHeight) }));
        assert.ok(measure.height <= measure.line * 3 + 1);
        await page.locator('.view-desc-more').click();
        assert.equal(await page.locator('.view-desc-more').textContent(), 'Show less');
        await page.locator('.view-desc-more').click();
        await page.reload({ waitUntil: 'networkidle' });
        assert.equal(await page.locator('.view-desc').isVisible(), true);
        await page.locator('.view-desc-body').click();
        await page.locator('.view-desc-edit').waitFor();
        assert.equal(await page.locator('.view-desc-edit').inputValue(), LONG);
      } finally { await page.close(); }
    });
  }
  test('empty table descriptions are added from the table menu (Feature #302)', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/#/table/${empty.id}`, { waitUntil: 'networkidle' });
      assert.equal(await page.locator('.view-title-row .desc-info').count(), 0);
      assert.equal(await page.locator('.view-desc-empty').count(), 0);
      await page.locator('.dots-btn[title="Table actions"]').click();
      await page.getByRole('menuitem', { name: 'Add description…', exact: true }).click();
      await page.locator('.view-desc-edit').fill('Added from the menu.');
      await page.locator('.view-desc-edit').press('Tab');
      await page.locator('.view-title-row .desc-info').waitFor();
    } finally { await page.close(); }
  });
  test('unavailable description storage leaves notes closed and usable (Feature #302)', async () => {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      const read = Storage.prototype.getItem;
      Storage.prototype.getItem = function (key) { if (key.startsWith('wv.desc.')) throw Error('Unavailable'); return read.call(this, key); };
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) { if (key.startsWith('wv.desc.')) throw Error('Unavailable'); return write.call(this, key, value); };
    });
    try {
      await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
      const note = page.locator('.fieldrow[data-field="Stage"] .fieldrow-note');
      assert.equal(await note.isVisible(), false);
      await page.locator('.fieldrow[data-field="Stage"] .desc-info').click();
      assert.equal(await note.isVisible(), true);
    } finally { await page.close(); }
  });
}
