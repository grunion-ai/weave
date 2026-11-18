import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';

let tasks, row, other;
const s = await launch('dock writes reach the table behind', (weave) => {
  weave.createSpace({ name: 'Work' });
  tasks = weave.createTable({ space: 'Work', name: 'Task' });
  weave.addField(tasks, { name: 'Owner', type: 'text' });
  row = weave.createEntity(tasks, { name: 'Call the vendor', Owner: 'Ada' });
  other = weave.createEntity(tasks, { name: 'Ship the order', Owner: 'Ada' });
});

if (s) {
  const { base, browser } = s;
  const text = (page, sel) => page.locator(sel).textContent().then((t) => (t ?? '').trim());
  const rowName = (page, id) => text(page, `tr[data-eid="${id}"] td.pid-cell .list-name`);
  const rowCell = (page, id, field) => text(page, `tr[data-eid="${id}"] td[data-field="${field}"]`);

  const dockedTable = async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`tr[data-eid="${row.id}"]`);
    await page.click(`tr[data-eid="${row.id}"] .open-link`);
    await page.waitForSelector(`#dock[data-eid="${row.id}"] .name-edit`);
    return page;
  };

  test('a rename in the dock renames the row in the table behind it (Issue #1519)', async () => {
    const page = await dockedTable();
    try {
      assert.equal(await rowName(page, row.id), 'Call the vendor');
      await page.click('#dock .name-edit');
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type('Call the supplier');
      await page.keyboard.press('Enter');
      assert.equal(
        await eventually(() => rowName(page, row.id), 'Call the supplier'),
        'Call the supplier',
        'the row behind the dock carries the new name with no reload',
      );
      assert.equal(await rowName(page, other.id), 'Ship the order', 'the other row stays put');
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  });

  test('a field saved in the dock shows in that row of the table behind it (Issue #1519)', async () => {
    const page = await dockedTable();
    try {
      await page.click('#dock .fieldrow[data-field="Owner"] .text-dressed');
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type('Grace');
      await page.keyboard.press('Enter');
      assert.equal(
        await eventually(() => rowCell(page, row.id, 'Owner').then((v) => v.includes('Grace')), true),
        true,
        'the Owner cell behind the dock shows the saved value with no reload',
      );
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  });

  test('text typed into the dock Description reaches that row of the table behind it (Issue #1519)', async () => {
    const page = await dockedTable();
    try {
      assert.equal(await rowCell(page, row.id, 'Description'), 'Add description…');
      const surface = page.locator('#dock .doc-section[data-doc-field="Description"] .vditor-ir [contenteditable="true"]');
      await surface.waitFor();
      await surface.click();
      await page.keyboard.type('Ring them back on Tuesday.');
      await page.evaluate(() => window.__weaveFlushDocSaves());
      assert.equal(
        await eventually(() => rowCell(page, row.id, 'Description').then((v) => v.includes('Ring them back on Tuesday.')), true),
        true,
        'the Description preview behind the dock shows the typed line with no reload',
      );
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  });
}
