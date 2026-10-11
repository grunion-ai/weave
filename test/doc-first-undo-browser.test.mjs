import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let notes;
const s = await launch('doc first undo', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  notes = weave.createTable({ space: 'Scratch', name: 'Note' });
});
if (s) {
  const { base, browser, weave } = s;
  const settles = (page, want) => page.waitForFunction((w) =>
    window.__weaveEditors.values().next().value.getValue().trim() === w, want, { timeout: 10000 });

  test('the first edit after opening a document can be undone (Issue #752)', async () => {
    const id = weave.createEntity(notes, { name: 'First undo', doc: 'Opening text.\n' }).id;
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.vditor-ir [contenteditable="true"]');
      await page.click('.vditor-ir .vditor-reset > p');
      await page.keyboard.press('End');
      await page.keyboard.type(' abc');
      await settles(page, 'Opening text. abc');
      await page.waitForTimeout(1200);
      await page.keyboard.press('ControlOrMeta+z');
      await settles(page, 'Opening text.');
      for (let i = 0; i < 60 && (weave.getDoc(id) ?? '').trim() !== 'Opening text.'; i++) await new Promise((r) => setTimeout(r, 50));
      assert.equal((weave.getDoc(id) ?? '').trim(), 'Opening text.');
    } finally { await page.close(); }
  });
}
