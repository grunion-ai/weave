import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let table;
const s = await launch('slash divider puts the caret below the rule', (weave) => {
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

  const hintOpen = (page) => page.locator('.doc-section[data-doc-field="Description"] .vditor-hint:not(.vditor-toolbar *)').evaluate((h) => h.style.display !== 'none' && h.querySelectorAll('button').length > 0);

  const pickDivider = async (page) => {
    await page.keyboard.type('/divider');
    for (let i = 0; i < 40 && !(await hintOpen(page)); i++) await page.waitForTimeout(25);
    assert.ok(await hintOpen(page), 'the slash menu is open');
    const first = await page.locator('.doc-section[data-doc-field="Description"] .vditor-hint:not(.vditor-toolbar *) .vditor-hint--current').textContent();
    assert.match(first, /Divider/);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !!document.querySelector('.doc-section[data-doc-field="Description"] .vditor-ir hr'), null, { timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(100);
  };

  test('slash divider on an empty line then typing lands below the rule (Issue #1891)', async () => {
    const { id, page, surface } = await open();
    try {
      await surface.click();
      await pickDivider(page);
      await page.keyboard.type('X');
      const want = '---\n\nX\n';
      assert.equal(await saved(page, surface, id, want), want);
    } finally { await page.close(); }
  });

  test('slash divider under a paragraph keeps the paragraph above and the caret below (Issue #1891)', async () => {
    const { id, page, surface } = await open('Intro');
    try {
      await surface.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await pickDivider(page);
      await page.keyboard.type('X');
      const want = 'Intro\n\n---\n\nX\n';
      assert.equal(await saved(page, surface, id, want), want);
    } finally { await page.close(); }
  });
}
