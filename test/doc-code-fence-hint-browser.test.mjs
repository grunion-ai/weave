import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let table;
const s = await launch('three backticks and Return open an untagged code block', (weave) => {
  weave.createSpace({ name: 'Work' });
  table = weave.createTable({ space: 'Work', name: 'Note' });
});

if (s) {
  const { browser, base, weave } = s;
  let n = 0;

  const open = async () => {
    const id = weave.createEntity(table, { name: `Row ${++n}`, doc: '' }).id;
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

  const hintOpen = (page) => page.locator('.doc-section[data-doc-field="Description"] .vditor-hint:not(.vditor-toolbar *)').evaluate((h) => h.style.display !== 'none' && h.querySelectorAll('button').length > 0);

  const fence = async (page, surface, info = '') => {
    await surface.click();
    await page.keyboard.type('```');
    for (let i = 0; i < 40 && !(await hintOpen(page)); i++) await page.waitForTimeout(25);
    assert.ok(await hintOpen(page), 'the language hint is open, as in the report');
    await page.keyboard.type(info);
  };

  test('Return with the language hint open and nothing chosen opens an untagged block (Issue #1892)', async () => {
    const { id, page, surface } = await open();
    try {
      await fence(page, surface);
      await page.keyboard.press('Enter');
      assert.equal(await hintOpen(page), false, 'the hint closes');
      await page.keyboard.type('X');
      const want = '```\nX\n```\n';
      assert.equal(await saved(page, surface, id, want), want);
    } finally { await page.close(); }
  });

  test('an arrow-key choice in the language hint still sets the tag (Issue #1892)', async () => {
    const { id, page, surface } = await open();
    try {
      await fence(page, surface);
      await page.keyboard.press('ArrowDown');
      const pick = await page.locator('.doc-section[data-doc-field="Description"] .vditor-hint:not(.vditor-toolbar *) .vditor-hint--current').textContent();
      await page.keyboard.press('Enter');
      await page.keyboard.type('X');
      const want = '```' + pick.trim() + '\nX\n```\n';
      assert.equal(await saved(page, surface, id, want), want);
    } finally { await page.close(); }
  });
}
