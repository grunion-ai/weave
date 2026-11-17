import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const rows = {};
let decks;
const s = await launch('attachment cell opens the viewer', (weave) => {
  weave.createSpace({ name: 'Product' });
  decks = weave.createTable({ space: 'Product', name: 'Deck' });
  weave.addField(decks, { name: 'Files', type: 'attachments' });
  for (const n of ['page-light', 'page-dark', 'pair', 'plain']) rows[n] = weave.createEntity(decks, { name: n });
  for (const n of ['page-light', 'page-dark']) {
    weave.attachToField(rows[n].id, 'Files', { name: 'review.html', mime: 'text/html', bytes: Buffer.from('<h1>review</h1>') });
  }
  weave.attachToField(rows.pair.id, 'Files', { name: 'brief.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-1') });
  weave.attachToField(rows.pair.id, 'Files', { name: 'notes.html', mime: 'text/html', bytes: Buffer.from('<h1>notes</h1>') });
  weave.attachToField(rows.plain.id, 'Files', { name: 'archive.zip', mime: 'application/zip', bytes: Buffer.from('PK') });
});

if (s) {
  const { base, browser } = s;
  const cellSel = (row) => `tr[data-eid="${rows[row].id}"] td[data-field="Files"]`;
  const chipSel = (row) => `${cellSel(row)} .k-attach`;
  const open = async (theme, ready) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/table/${decks.id}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector(ready);
    return page;
  };
  const framed = (page) => page.evaluate(() => {
    const f = document.querySelector('.wv-file-panel .wv-file-body iframe');
    return f ? { src: f.getAttribute('src'), sandbox: f.getAttribute('sandbox'), name: document.querySelector('.wv-file-name')?.textContent } : null;
  });

  for (const theme of ['light', 'dark']) {
    test(`${theme}: clicking an html file in a grid cell opens it in the file panel (Issue #1072)`, async () => {
      const row = `page-${theme}`;
      const page = await open(theme, chipSel(row));
      try {
        const href = await page.locator(chipSel(row)).getAttribute('href');
        assert.ok(href && href.endsWith('?view'), `the cell links the file's viewer url: ${href}`);
        await page.locator(chipSel(row)).click();
        const got = await framed(page);
        assert.ok(got, 'the file panel opened');
        assert.ok(got.src.endsWith('?view'), `the panel frames the viewer url: ${got.src}`);
        assert.equal(got.sandbox, 'allow-scripts allow-popups allow-popups-to-escape-sandbox', 'the frame keeps its sandbox');
        assert.equal(got.name, 'review.html', 'the panel names the clicked file');
      } finally { await page.close(); }
    });
  }

  test('a cell of several files opens the first viewable one and offers the rest (Issue #1072)', async () => {
    const page = await open('light', chipSel('pair'));
    try {
      await page.locator(chipSel('pair')).click();
      const got = await framed(page);
      assert.ok(got, 'the file panel opened');
      assert.equal(got.name, 'brief.pdf', 'the panel opens the first file of the cell');
      assert.equal(await page.locator('.wv-file-panel [title="Next"]').count(), 1, 'the panel offers the other file');
    } finally { await page.close(); }
  });

  test('a cell holding no viewable file stays a label (Issue #1072)', async () => {
    const page = await open('light', chipSel('plain'));
    try {
      assert.equal(await page.locator(chipSel('plain')).getAttribute('href'), null, 'an unviewable file gets no viewer link');
      await page.locator(chipSel('plain')).click();
      assert.equal(await framed(page), null, 'clicking it opens no panel');
    } finally { await page.close(); }
  });

  test('⌘-click on a grid file cell leaves the panel shut (Issue #1072)', async () => {
    const page = await open('light', chipSel('page-light'));
    try {
      await page.locator(chipSel('page-light')).click({ modifiers: ['Meta'] });
      assert.equal(await framed(page), null, 'the panel stays shut for a ⌘-click');
    } finally { await page.close(); }
  });
}
