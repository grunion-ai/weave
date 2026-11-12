import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let notes, row;

const s = await launch('collapsed doc sections', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  notes = weave.createTable({ space: 'Scratch', name: 'Note' });
  weave.addField(notes, { name: 'Notes', type: 'document' });
  row = weave.createEntity(notes, { name: 'Plan' });
  weave.setDoc(row.id, '# Plan\n\nFirst line of the plan.\n', 'Description');
  weave.setDoc(row.id, '# Notes\n\nHeld until the caret opens.\n', 'Notes');
});

if (s) {
  const { base, browser } = s;
  const collapse = (fields) => `(() => {
    for (const f of ${JSON.stringify(fields)}) localStorage.setItem('weave-doc-collapsed:${row.id}:' + f, '1');
  })()`;

  const openPage = async (collapsed) => {
    const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    await page.addInitScript(collapse(collapsed));
    return page;
  };

  test('a collapsed document field builds no editor until its caret opens (Issue #1684)', async () => {
    const page = await openPage(['Notes']);
    try {
      await page.goto(`${base}/#/entity/${row.id}`);
      await page.locator('section.doc-section[data-doc-field="Notes"]').waitFor({ state: 'attached' });
      await page.locator('.vditor-ir [contenteditable="true"]', { hasText: 'First line of the plan.' }).waitFor();
      assert.equal(await page.evaluate(() => globalThis.__weaveEditors.size), 1, 'only the open section built an editor');
      await page.locator('section.doc-section[data-doc-field="Notes"] .doc-caret').click();
      await page.locator('.vditor-ir [contenteditable="true"]', { hasText: 'Held until the caret opens.' }).waitFor();
      assert.equal(await page.evaluate(() => globalThis.__weaveEditors.size), 2, 'opening the caret built the held editor');
    } finally { await page.close(); }
  });

  test('a record whose document fields are all collapsed builds no editor at all (Issue #1684)', async () => {
    const page = await openPage(['Description', 'Notes']);
    try {
      await page.goto(`${base}/#/entity/${row.id}`);
      await page.locator('section.doc-section[data-doc-field="Notes"]').waitFor({ state: 'attached' });
      await page.waitForFunction(() => 'Vditor' in window);
      assert.equal(await page.locator('.vditor-ir').count(), 0, 'no editor chrome on a page of closed sections');
      assert.equal(await page.evaluate(() => globalThis.__weaveEditors.size), 0, 'no editor was built');
      await page.locator('section.doc-section[data-doc-field="Description"] .doc-caret').click();
      await page.locator('.vditor-ir [contenteditable="true"]', { hasText: 'First line of the plan.' }).waitFor();
      assert.equal(await page.evaluate(() => globalThis.__weaveEditors.size), 1, 'one caret builds one editor');
      assert.equal(await page.locator('section.doc-section[data-doc-field="Notes"] .vditor-ir').count(), 0, 'the still-closed section stays empty');
    } finally { await page.close(); }
  });

  test('a held section still stores the collapse choice it is reopened with (Issue #1684)', async () => {
    const page = await openPage(['Description', 'Notes']);
    const key = `weave-doc-collapsed:${row.id}:Notes`;
    try {
      await page.goto(`${base}/#/entity/${row.id}`);
      const caret = page.locator('section.doc-section[data-doc-field="Notes"] .doc-caret');
      await caret.click();
      await page.locator('.vditor-ir [contenteditable="true"]', { hasText: 'Held until the caret opens.' }).waitFor();
      assert.equal(await page.evaluate((k) => localStorage.getItem(k), key), '', 'opening cleared the stored collapse');
      await caret.click();
      assert.equal(await page.evaluate((k) => localStorage.getItem(k), key), '1', 'closing stored it again');
      assert.equal(await page.evaluate(() => globalThis.__weaveEditors.size), 1, 'the built editor is not rebuilt on the next open');
      await caret.click();
      assert.equal(await page.evaluate(() => globalThis.__weaveEditors.size), 1, 'reopening builds nothing a second time');
    } finally { await page.close(); }
  });
}
