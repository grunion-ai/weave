import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, styleOf } from './lib/browser.mjs';

let table;
const s = await launch('a checked checklist item reads as done', (weave) => {
  weave.createSpace({ name: 'Work' });
  table = weave.createTable({ space: 'Work', name: 'Note' });
});

if (s) {
  const { browser, base, weave } = s;
  let n = 0;
  const open = async (theme) => {
    const id = weave.createEntity(table, { name: `Row ${++n}`, doc: '- [x] Shipped it\n- [ ] Ship the rest\n' }).id;
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: theme });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    const items = page.locator('.doc-section[data-doc-field="Description"] li.vditor-task');
    await items.nth(1).waitFor();
    return { page, done: items.nth(0), todo: items.nth(1) };
  };

  for (const theme of ['light', 'dark']) {
    test(`a checked checklist item strikes through and dims in the ${theme} theme (Issue #1518)`, async () => {
      const { page, done, todo } = await open(theme);
      try {
        assert.match(await styleOf(done, 'textDecorationLine', 'line-through'), /line-through/, 'the done item carries no strike');
        assert.equal(await styleOf(todo, 'textDecorationLine', 'none'), 'none', 'the open item was struck through too');
        const dim = await styleOf(done, 'color', 'x');
        const full = await styleOf(todo, 'color', 'x');
        assert.notEqual(dim, full, `the done item reads at the same weight as the open one (${dim})`);
      } finally { await page.close(); }
    });
  }
}
