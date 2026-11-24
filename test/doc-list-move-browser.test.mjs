import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let table;
const s = await launch('Ctrl+Cmd+Up and Down move a list item past its sibling in the document editor', (weave) => {
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

  const item = (page, text) => page.locator('.doc-section[data-doc-field="Description"] .vditor-reset li', { hasText: text }).first();

  test('Ctrl+Cmd+Up moves the typed item above its sibling and the caret stays in it (Issue #1893)', async () => {
    const { id, page, surface } = await open();
    try {
      await surface.click();
      await page.keyboard.type('- alpha');
      await page.keyboard.press('Enter');
      await page.keyboard.type('beta');
      await page.keyboard.press('Control+Meta+ArrowUp');
      await page.keyboard.type('X');
      const want = '- betaX\n- alpha\n';
      assert.equal(await saved(page, surface, id, want), want);
    } finally { await page.close(); }
  });

  test('Ctrl+Cmd+Down moves an item below its sibling and keeps the caret offset (Issue #1893)', async () => {
    const { id, page, surface } = await open('- alpha\n- beta\n- gamma\n');
    try {
      await item(page, 'alpha').click();
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Control+Meta+ArrowDown');
      await page.keyboard.type('X');
      const want = '- beta\n- alXpha\n- gamma\n';
      assert.equal(await saved(page, surface, id, want), want);
    } finally { await page.close(); }
  });

  test('Ctrl+Cmd+Up on the first item leaves the list unchanged and selects nothing (Issue #1893)', async () => {
    const { id, page, surface } = await open('- alpha\n- beta\n');
    try {
      await item(page, 'alpha').click();
      await page.keyboard.press('End');
      await page.keyboard.press('Control+Meta+ArrowUp');
      await page.keyboard.type('X');
      const want = '- alphaX\n- beta\n';
      assert.equal(await saved(page, surface, id, want), want);
    } finally { await page.close(); }
  });

  test('Ctrl+Cmd+Down on the last item leaves the list unchanged (Issue #1893)', async () => {
    const { id, page, surface } = await open('- alpha\n- beta\n');
    try {
      await item(page, 'beta').click();
      await page.keyboard.press('End');
      await page.keyboard.press('Control+Meta+ArrowDown');
      await page.keyboard.type('X');
      const want = '- alpha\n- betaX\n';
      assert.equal(await saved(page, surface, id, want), want);
    } finally { await page.close(); }
  });

  test('a moved item in a numbered list keeps the numbering in order (Issue #1893)', async () => {
    const { id, page, surface } = await open('1. alpha\n2. beta\n');
    try {
      await item(page, 'beta').click();
      await page.keyboard.press('End');
      await page.keyboard.press('Control+Meta+ArrowUp');
      await page.keyboard.type('X');
      const want = '1. betaX\n2. alpha\n';
      assert.equal(await saved(page, surface, id, want), want);
    } finally { await page.close(); }
  });

  test('a moved item carries its nested items with it (Issue #1893)', async () => {
    const { id, page, surface } = await open('- alpha\n  - child\n- beta\n');
    try {
      await item(page, 'beta').click();
      await page.keyboard.press('End');
      await page.keyboard.press('Control+Meta+ArrowUp');
      await page.keyboard.type('X');
      const want = '- betaX\n- alpha\n  - child\n';
      assert.equal(await saved(page, surface, id, want), want);
    } finally { await page.close(); }
  });

  test('Ctrl+Alt+Up moves the item too, for keyboards without Cmd (Issue #1893)', async () => {
    const { id, page, surface } = await open('- alpha\n- beta\n');
    try {
      await item(page, 'beta').click();
      await page.keyboard.press('End');
      await page.keyboard.press('Control+Alt+ArrowUp');
      await page.keyboard.type('X');
      const want = '- betaX\n- alpha\n';
      assert.equal(await saved(page, surface, id, want), want);
    } finally { await page.close(); }
  });

  test('Cmd+Z after a move puts the item back (Issue #1893)', async () => {
    const { id, page, surface } = await open('- alpha\n- beta\n');
    try {
      await item(page, 'beta').click();
      await page.keyboard.press('End');
      await page.keyboard.press('Control+Meta+ArrowUp');
      await page.waitForTimeout(900);
      const first = () => page.locator('.doc-section[data-doc-field="Description"] .vditor-reset li').first().textContent();
      assert.match(await first(), /beta/);
      await page.keyboard.press('ControlOrMeta+z');
      assert.match(await first(), /alpha/);
      const want = '- alpha\n- beta\n';
      assert.equal(await saved(page, surface, id, want), want);
    } finally { await page.close(); }
  });
}
