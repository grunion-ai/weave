import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tableRef;
const s = await launch('crepe document editor', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  tableRef = weave.createTable({ space: 'Scratch', name: 'Note' });
});

if (s) {
  const { base, browser, weave } = s;
  const SURFACE = '.wv-crepe .ProseMirror[contenteditable="true"]';

  async function open(name, doc = '') {
    const e = weave.createEntity(tableRef, { name });
    if (doc) weave.setDoc(e.id, doc, 'Description');
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.addInitScript(() => localStorage.setItem('weave.editor', 'crepe'));
    await page.goto(`${base}/#/entity/${e.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(SURFACE, { timeout: 30000 });
    await page.click(SURFACE);
    return { page, id: e.id };
  }

  const KEY_GAP = 120;
  const press = async (page, key) => { await page.keyboard.press(key); await page.waitForTimeout(KEY_GAP); };

  async function saved(page, id, want) {
    await page.evaluate(() => window.__weaveFlushDocSaves());
    let doc = '';
    for (let i = 0; i < 40; i++) {
      const e = await fetch(`${base}/api/entities/${id}`).then((r) => r.json());
      doc = e.docs?.Description ?? e.doc ?? '';
      if (want.test(doc)) return doc;
      await page.waitForTimeout(100);
    }
    return doc;
  }

  test('Tab nests a list item with the caret at its end, and Shift+Tab brings it back (Issue #1888)', async () => {
    const { page, id } = await open('Tab');
    try {
      await page.keyboard.type('- alpha', { delay: 30 });
      await press(page, 'Enter');
      await page.keyboard.type('beta', { delay: 30 });
      await press(page, 'Tab');
      await page.keyboard.type('X', { delay: 30 });
      assert.match(await saved(page, id, /betaX/), /^- alpha\n\n?\s+- betaX/m, 'beta nests under alpha and the X lands in it');
      await press(page, 'Shift+Tab');
      await page.keyboard.type('Y', { delay: 30 });
      assert.match(await saved(page, id, /betaXY/), /^- betaXY$/m, 'Shift+Tab returns the item to the top level');
      const focused = await page.evaluate((sel) => document.querySelector(sel).contains(document.activeElement) || document.querySelector(sel) === document.activeElement, SURFACE);
      assert.ok(focused, 'focus stays in the document');
    } finally { await page.close(); }
  });

  test('Return on an empty nested item moves up one level (Issue #1889)', async () => {
    const { page, id } = await open('Nested return');
    try {
      await page.keyboard.type('- alpha', { delay: 30 });
      await press(page, 'Enter');
      await page.keyboard.type('beta', { delay: 30 });
      await press(page, 'Tab');
      await press(page, 'Enter');
      await press(page, 'Enter');
      await page.keyboard.type('X', { delay: 30 });
      const doc = await saved(page, id, /X/);
      assert.match(doc, /^- X$/m, 'the new item sits at the top level');
      assert.match(doc, /^\s+- beta$/m, 'beta stays nested');
    } finally { await page.close(); }
  });

  test('/code puts the caret inside the new code block (Issue #1890)', async () => {
    const { page, id } = await open('Slash code');
    try {
      await page.keyboard.type('/code', { delay: 30 });
      await page.waitForSelector('.milkdown-slash-menu[data-show="true"]', { timeout: 10000 });
      await press(page, 'Enter');
      await page.waitForSelector('.wv-crepe .milkdown-code-block .cm-content', { timeout: 10000 });
      await page.keyboard.type('let x = 1', { delay: 30 });
      assert.match(await saved(page, id, /let x = 1/), /```[a-z]*\nlet x = 1\n```/, 'the typed code is the block body');
    } finally { await page.close(); }
  });

  test('weave markdown survives a load and an edit: dash bullets, rules and [[references]] stay as written', async () => {
    const doc = '# Notes\n\n- one\n- two\n\n---\n\nSee [[Note#1]] here.';
    const { page, id } = await open('Round trip', doc);
    try {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
      await page.keyboard.type(' Done.', { delay: 30 });
      const got = await saved(page, id, /Done\./);
      assert.match(got, /^- one\n- two$/m);
      assert.match(got, /^---$/m);
      assert.match(got, /See \[\[Note#1\]\] here\. Done\./);
    } finally { await page.close(); }
  });
}
