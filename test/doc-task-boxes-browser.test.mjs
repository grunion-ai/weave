import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const CHECKLIST = 'Launch checklist\n\n- [ ] Draft the quickstart\n- [x] Pick the sample app\n';

let table;
const s = await launch('task boxes keep their stored shape', (weave) => {
  weave.createSpace({ name: 'Work' });
  table = weave.createTable({ space: 'Work', name: 'Task' });
});

if (s) {
  const { browser, base, weave } = s;
  let n = 0;

  const open = async (doc) => {
    const id = weave.createEntity(table, { name: `Row ${++n}`, doc }).id;
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    const surface = page.locator('.doc-section[data-doc-field="Description"] .vditor-ir [contenteditable="true"]');
    await surface.waitFor();
    return { id, page, surface };
  };

  const settled = async (id, want) => {
    for (let i = 0; i < 60 && (weave.getDoc(id, 'Description') ?? '') !== want; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return weave.getDoc(id, 'Description') ?? '';
  };

  test('an edit on one line leaves every task line byte for byte (Issue #555)', async () => {
    const { id, page, surface } = await open(CHECKLIST);
    try {
      await page.click('.doc-section[data-doc-field="Description"] .vditor-reset > p:first-of-type');
      await page.keyboard.press('End');
      await page.keyboard.type(' for v1');
      await surface.evaluate((node) => node.blur());
      await page.evaluate(() => window.__weaveFlushDocSaves());
      const want = 'Launch checklist for v1\n\n- [ ] Draft the quickstart\n- [x] Pick the sample app\n';
      assert.equal(await settled(id, want), want,
        'one space after the box and a lower-case x survive an unrelated edit');
    } finally { await page.close(); }
  });

  test('a task item typed by hand stores one space after the box', async () => {
    const { id, page, surface } = await open('');
    try {
      await surface.click();
      await page.keyboard.type('- [ ] Buy milk');
      await surface.evaluate((node) => node.blur());
      await page.evaluate(() => window.__weaveFlushDocSaves());
      assert.equal(await settled(id, '- [ ] Buy milk\n'), '- [ ] Buy milk\n');
    } finally { await page.close(); }
  });

  test('a document nobody changed is not rewritten when the caret leaves it', async () => {
    const { id, page, surface } = await open(CHECKLIST);
    const puts = [];
    page.on('request', (r) => { if (r.method() === 'PUT' && r.url().includes('/doc')) puts.push(r.url()); });
    try {
      await surface.click();
      await surface.evaluate((node) => node.blur());
      await page.evaluate(() => window.__weaveFlushDocSaves());
      await page.waitForTimeout(400);
      assert.deepEqual(puts, [], 'the two-space form the editor hands back is not a change');
      assert.equal(weave.getDoc(id, 'Description'), CHECKLIST);
    } finally { await page.close(); }
  });
}
