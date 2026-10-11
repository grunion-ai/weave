import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage } from './lib/browser.mjs';

let notes;
const s = await launch('doc undo gesture', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  notes = weave.createTable({ space: 'Scratch', name: 'Note' });
});
if (s) {
  const { base, weave } = s;
  const settles = (page, want) => page.waitForFunction((w) =>
    window.__weaveEditors.values().next().value.getValue().trim() === w, want, { timeout: 10000 });
  const gesture = (page, inputType) => page.evaluate((t) => {
    const ev = new InputEvent('beforeinput', { inputType: t, bubbles: true, cancelable: true });
    document.querySelector('.vditor-ir [contenteditable="true"]').dispatchEvent(ev);
    return ev.defaultPrevented;
  }, inputType);

  test('the phone undo and redo gestures step through the document history (Issue #707)', async () => {
    const id = weave.createEntity(notes, { name: 'Undo case' }).id;
    const page = await phonePage(await phoneBrowser());
    try {
      await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.vditor-ir [contenteditable="true"]');
      await page.tap('.vditor-ir [contenteditable="true"]');
      await page.keyboard.type('first words');
      await settles(page, 'first words');
      await page.waitForTimeout(1200);
      await page.keyboard.type(' then more');
      await settles(page, 'first words then more');
      await page.waitForTimeout(1200);
      assert.equal(await gesture(page, 'historyUndo'), true, 'the browser\'s own undo is held back');
      await settles(page, 'first words');
      assert.equal(await gesture(page, 'historyRedo'), true, 'the browser\'s own redo is held back');
      await settles(page, 'first words then more');
      for (let i = 0; i < 60 && (weave.getDoc(id) ?? '').trim() !== 'first words then more'; i++) await new Promise((r) => setTimeout(r, 50));
      assert.equal((weave.getDoc(id) ?? '').trim(), 'first words then more');
    } finally { await page.close(); }
  });
}
