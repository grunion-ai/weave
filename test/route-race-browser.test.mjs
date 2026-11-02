import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const BODY = 'The soak smoke reads this body.';

let tasks;
let row;
const s = await launch('route race', (weave) => {
  weave.createSpace({ name: 'Net' });
  tasks = weave.createTable({ space: 'Net', name: 'Tasks' });
  const made = [];
  for (let i = 0; i < 12; i++) made.push(weave.createEntity(tasks.id, { Name: `Task ${i + 1}` }));
  row = made[0].id;
  weave.setDoc(row, `${BODY}\n\nA second paragraph.`);
});

if (s) {
  const { base, browser } = s;

  const raced = async () => {
    const page = await browser.newPage();
    let jumped = false;
    await page.route('**/api/tables/*/query', async (route) => {
      if (!jumped) {
        jumped = true;
        page.evaluate((id) => { location.hash = `#/entity/${id}`; }, row).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      await route.continue();
    });
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'commit' });
    await page.waitForLoadState('networkidle');
    return page;
  };

  test('a hash change that lands while the first table render is still loading still decides the view (Issue #1138)', async () => {
    const page = await raced();
    try {
      const seen = await page.evaluate(() => ({
        hash: location.hash,
        docEditors: document.querySelectorAll('.doc-editor').length,
        gridRows: document.querySelectorAll('.wv-grid tbody tr.entity-row').length,
      }));
      assert.equal(seen.hash, `#/entity/${row}`);
      assert.equal(seen.gridRows, 0, `the table render overwrote the newer ${seen.hash} route, leaving ${seen.gridRows} grid rows`);
      assert.ok(seen.docEditors > 0, 'the document route left no .doc-editor on the page');
    } finally {
      await page.close();
    }
  });

  test('the document the newer route names is the one that renders (Issue #1138)', async () => {
    const page = await raced();
    try {
      await page.waitForFunction(() => [...document.querySelectorAll('.doc-editor .vditor-reset')]
        .some((e) => e.textContent.trim().length > 0));
      const text = await page.evaluate(() => [...document.querySelectorAll('.doc-editor .vditor-reset')]
        .map((e) => e.textContent.trim()).filter(Boolean).join(' '));
      assert.match(text, new RegExp(BODY));
    } finally {
      await page.close();
    }
  });
}
