import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let table;
const s = await launch('Tab nests and Shift+Tab un-nests list items in the document editor', (weave) => {
  weave.createSpace({ name: 'Work' });
  table = weave.createTable({ space: 'Work', name: 'Note' });
});

if (s) {
  const { browser, base, weave } = s;
  let n = 0;

  const open = async (doc = '') => {
    const id = weave.createEntity(table, { name: `Row ${++n}`, doc }).id;
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    const surface = page.locator('.doc-section[data-doc-field="Description"] .vditor-ir [contenteditable="true"]');
    await surface.waitFor();
    return { id, page, surface };
  };

  const saved = async (page, surface, id, want) => {
    await surface.evaluate((node) => node.blur());
    await page.evaluate(() => window.__weaveFlushDocSaves());
    for (let i = 0; i < 60 && (weave.getDoc(id, 'Description') ?? '') !== want; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return weave.getDoc(id, 'Description') ?? '';
  };

  const inEditor = (surface) => surface.evaluate((root) => root.contains(document.activeElement) || root === document.activeElement);

  test('Tab at the end of a list item nests it under the item above and keeps focus (Issue #1888)', async () => {
    const { id, page, surface } = await open();
    try {
      await surface.click();
      await page.keyboard.type('- alpha');
      await page.keyboard.press('Enter');
      await page.keyboard.type('beta');
      await page.keyboard.press('Tab');
      assert.ok(await inEditor(surface), 'focus stays in the editor after Tab');
      await page.keyboard.type('X');
      const want = '- alpha\n  - betaX\n';
      assert.equal(await saved(page, surface, id, want), want);
    } finally { await page.close(); }
  });

  test('Shift+Tab on a nested item moves it back out a level and keeps focus (Issue #1888)', async () => {
    const { id, page, surface } = await open('- alpha\n  - beta\n');
    try {
      await page.click('.doc-section[data-doc-field="Description"] .vditor-reset li li');
      await page.keyboard.press('End');
      await page.keyboard.press('Shift+Tab');
      assert.ok(await inEditor(surface), 'focus stays in the editor after Shift+Tab');
      await page.keyboard.type('Y');
      const want = '- alpha\n- betaY\n';
      assert.equal(await saved(page, surface, id, want), want);
    } finally { await page.close(); }
  });

  test('Tab in a plain paragraph types a tab character and keeps focus (Issue #1888)', async () => {
    const { id, page, surface } = await open();
    try {
      await surface.click();
      await page.keyboard.type('a');
      await page.keyboard.press('Tab');
      assert.ok(await inEditor(surface), 'focus stays in the editor after Tab');
      await page.keyboard.type('b');
      const want = 'a\tb\n';
      assert.equal(await saved(page, surface, id, want), want);
    } finally { await page.close(); }
  });

  test('Escape hands focus back so the next Tab leaves the editor (Issue #1888)', async () => {
    const { page, surface } = await open('Intro\n');
    try {
      await surface.click();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Tab');
      assert.equal(await inEditor(surface), false, 'Tab after Escape moves focus out of the document');
    } finally { await page.close(); }
  });
}
