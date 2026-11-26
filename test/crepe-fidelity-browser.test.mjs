import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const DOC = [
  '# Buyer notes',
  '',
  'First paragraph to edit.',
  '',
  '| Merchant | Price |',
  '| --- | --- |',
  '| Direct | $939 |',
  '',
  '**Cashback portals**<br>*none found*',
  '',
  'Some _emphasis_, ~strike~ and a \\~tilde.',
  '',
  '* star bullet',
  '* second star',
  '',
  '1) paren list',
  '2) second',
  '',
  '***',
  '',
  'Last paragraph.',
  '',
].join('\n');

let tableRef;
const s = await launch('crepe source fidelity', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  tableRef = weave.createTable({ space: 'Scratch', name: 'Note' });
});

if (s) {
  const { base, browser, weave } = s;
  const ROOT = '.wv-crepe .ProseMirror[contenteditable="true"]';

  async function open(name, doc) {
    const e = weave.createEntity(tableRef, { name });
    weave.setDoc(e.id, doc, 'Description');
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.addInitScript(() => localStorage.setItem('weave.editor', 'crepe'));
    await page.goto(`${base}/#/entity/${e.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(ROOT, { timeout: 30000 });
    return { page, id: e.id };
  }

  async function saved(page, id, want) {
    await page.evaluate(() => window.__weaveFlushDocSaves());
    let doc = '';
    for (let i = 0; i < 40; i++) {
      doc = (await fetch(`${base}/api/entities/${id}`).then((r) => r.json())).docs?.Description ?? '';
      if (want.test(doc)) return doc;
      await page.waitForTimeout(100);
    }
    return doc;
  }

  test('an edit in one paragraph leaves every other block byte for byte (Issue #1896)', async () => {
    const { page, id } = await open('One edit', DOC);
    try {
      await page.click(`${ROOT} p:has-text("First paragraph")`);
      await page.keyboard.press('End');
      await page.keyboard.type(' Edited.', { delay: 30 });
      const got = await saved(page, id, /Edited\./);
      assert.equal(got, DOC.replace('First paragraph to edit.', 'First paragraph to edit. Edited.'));
    } finally { await page.close(); }
  });

  test('an edit in the last paragraph leaves the table, lists and marks as written (Issue #1896)', async () => {
    const { page, id } = await open('Last edit', DOC);
    try {
      await page.click(`${ROOT} p:has-text("Last paragraph")`);
      await page.keyboard.press('End');
      await page.keyboard.type(' More.', { delay: 30 });
      const got = await saved(page, id, /More\./);
      assert.equal(got, DOC.replace('Last paragraph.', 'Last paragraph. More.'));
    } finally { await page.close(); }
  });

  test('a new paragraph in the middle is the only text that changes (Issue #1896)', async () => {
    const { page, id } = await open('Insert', DOC);
    try {
      await page.click(`${ROOT} p:has-text("First paragraph")`);
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Inserted line.', { delay: 30 });
      const got = await saved(page, id, /Inserted line\./);
      assert.equal(got, DOC.replace('First paragraph to edit.\n', 'First paragraph to edit.\n\nInserted line.\n'));
    } finally { await page.close(); }
  });
  test('an edit in a table cell rewrites that table alone (Issue #1896)', async () => {
    const { page, id } = await open('Cell edit', DOC);
    try {
      await page.click(`${ROOT} td >> text=Direct`);
      await page.keyboard.press('End');
      await page.keyboard.type(' shop', { delay: 30 });
      const got = await saved(page, id, /Direct shop/);
      const [before, after] = DOC.split(/\| Merchant[\s\S]*?\$939 \|\n/);
      assert.ok(got.startsWith(before), 'blocks above the table keep their text');
      assert.ok(got.endsWith(after), 'blocks below the table keep their text');
      assert.match(got, /Direct shop/);
    } finally { await page.close(); }
  });
  test('clicking the empty part of a table cell puts the caret in it rather than selecting the cell (Issue #1896)', async () => {
    const { page, id } = await open('Cell click', DOC);
    try {
      const cell = page.locator(`${ROOT} td:has-text("Direct")`);
      const box = await cell.boundingBox();
      await page.mouse.click(box.x + box.width - 12, box.y + box.height / 2);
      await page.keyboard.type('X', { delay: 30 });
      const got = await saved(page, id, /X/);
      assert.match(got, /\| Direct ?X/, 'the typed letter joins the cell text');
    } finally { await page.close(); }
  });
  test('a click on the text of a table cell puts the caret there, so typing never replaces the cell (Issue #1896)', async () => {
    const { page, id } = await open('Cell text click', DOC);
    try {
      const at = await page.evaluate(() => {
        const td = [...document.querySelectorAll('.wv-crepe td')].find((t) => t.textContent.includes('Direct'));
        const range = document.createRange();
        range.selectNodeContents(td.querySelector('p') ?? td);
        const r = range.getClientRects()[0];
        return [r.right - 1, r.top + r.height / 2];
      });
      await page.mouse.click(at[0], at[1]);
      await page.waitForTimeout(150);
      await page.keyboard.type('X', { delay: 30 });
      const got = await saved(page, id, /X/);
      assert.match(got, /\| DirectX/, 'the letter lands after the clicked text and the cell keeps it');
    } finally { await page.close(); }
  });
  test('a cell edit keeps a plain dollar amount in that table unescaped (Issue #1898)', async () => {
    const { page, id } = await open('Dollar cell edit', DOC);
    try {
      await page.click(`${ROOT} td >> text=Direct`);
      await page.keyboard.press('End');
      await page.keyboard.type(' shop', { delay: 30 });
      const got = await saved(page, id, /Direct shop/);
      assert.match(got, /\| Direct shop \| \$939 +\|/);
      assert.doesNotMatch(got, /\\\$/);
    } finally { await page.close(); }
  });
  test('a cell edit keeps an author-written escaped dollar as written (Issue #1898)', async () => {
    const doc = '| Merchant | Price |\n| --- | --- |\n| Direct | \\$5 |\n';
    const { page, id } = await open('Escaped dollar cell edit', doc);
    try {
      await page.click(`${ROOT} td >> text=Direct`);
      await page.keyboard.press('End');
      await page.keyboard.type(' shop', { delay: 30 });
      const got = await saved(page, id, /Direct shop/);
      assert.match(got, /\| Direct shop \| \\\$5 +\|/);
    } finally { await page.close(); }
  });
}
