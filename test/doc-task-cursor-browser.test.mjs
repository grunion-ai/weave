import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, styleOf } from './lib/browser.mjs';

let table;
const s = await launch('a checklist box reads as a control', (weave) => {
  weave.createSpace({ name: 'Work' });
  table = weave.createTable({ space: 'Work', name: 'Note' });
});

if (s) {
  const { browser, base, weave } = s;
  let n = 0;
  const open = async (width) => {
    const id = weave.createEntity(table, { name: `Row ${++n}`, doc: '- [ ] Ship it\n' }).id;
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    const box = page.locator('.doc-section[data-doc-field="Description"] li.vditor-task input[type=checkbox]');
    await box.waitFor();
    return { page, box };
  };

  for (const width of [1280, 375]) {
    test(`the checklist box takes the pointer, never the text caret, at ${width} px (Issue #1517)`, async () => {
      const { page, box } = await open(width);
      try {
        assert.equal(await styleOf(box, 'cursor', 'pointer'), 'pointer', 'the box hovers as a control, not as text');
      } finally { await page.close(); }
    });
  }
}
