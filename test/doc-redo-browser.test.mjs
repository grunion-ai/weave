import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let notes;
const s = await launch('doc redo', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  notes = weave.createTable({ space: 'Scratch', name: 'Note' });
});
if (s) {
  const { base, browser, weave } = s;
  const value = (page) => page.evaluate(() => window.__weaveEditors.values().next().value.getValue());
  const settles = (page, want) => page.waitForFunction((w) =>
    window.__weaveEditors.values().next().value.getValue().trim() === w, want, { timeout: 10000 });

  for (const colorScheme of ['light', 'dark']) {
    test(`Mod+Shift+Z redoes what Mod+Z undid in a document, in ${colorScheme} (Issue #697)`, async () => {
      const id = weave.createEntity(notes, { name: 'Redo case' }).id;
      const page = await browser.newPage({ colorScheme });
      try {
        await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.vditor-ir [contenteditable="true"]');
        await page.click('.vditor-ir [contenteditable="true"]');
        await page.keyboard.type('first words');
        await settles(page, 'first words');
        await page.waitForTimeout(1200);
        await page.keyboard.type(' then more');
        await settles(page, 'first words then more');
        await page.waitForTimeout(1200);
        await page.keyboard.press('ControlOrMeta+z');
        await settles(page, 'first words');
        await page.keyboard.press('ControlOrMeta+Shift+z');
        await settles(page, 'first words then more');
        assert.equal((await value(page)).trim(), 'first words then more');
      } finally { await page.close(); }
    });
  }
}
