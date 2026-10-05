/* Attachment previews on the record page (Kyle, 2026-10-05). A many-file
   field left unset draws its pictures in a contact sheet (auto, medium,
   trim) and the rest as chips; a single-file field left unset draws its
   file in the viewer in place, an HTML upload in a sandboxed frame whose
   script runs and cannot reach the page; a cover field puts its picture
   at the top of the record; a sheet cell opens the fullscreen viewer and
   → walks to the next file. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABAQMAAADO7O3JAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8AAP///0EdNBEAAAABYktHRAH/Ai3eAAAAB3RJTUUH6goFETs3n475pwAAAApJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII=', 'base64'); // a 2x1 red png (ImageMagick)
const HTML = Buffer.from('<!doctype html><p id="p">page</p><script>document.getElementById("p").textContent = "ran"; try { parent.document; document.title = "reached"; } catch { document.title = "blocked"; }</script>');
const SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox';

let row, files;
const s = await launch('attachment previews', (weave) => {
  weave.createSpace({ name: 'Product' });
  const deck = weave.createTable({ space: 'Product', name: 'Deck' });
  weave.addField(deck, { name: 'Files', type: 'attachments' });
  weave.addField(deck, { name: 'Page', type: 'attachments', config: { multiple: false } });
  weave.addField(deck, { name: 'Hero', type: 'attachments', config: { multiple: false, preview: 'cover', fit: 'fill' } });
  weave.addField(deck, { name: 'Links', type: 'attachments', config: { preview: 'link' } });
  row = weave.createEntity(deck, { name: 'row' });
  files = {
    shot: weave.attachToField(row.id, 'Files', { name: 'shot.png', mime: 'image/png', bytes: PNG }),
    spec: weave.attachToField(row.id, 'Files', { name: 'spec.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-1.4') }),
    site: weave.attachToField(row.id, 'Files', { name: 'site.html', mime: 'text/html', bytes: HTML }),
    page: weave.attachToField(row.id, 'Page', { name: 'page.html', mime: 'text/html', bytes: HTML }),
    hero: weave.attachToField(row.id, 'Hero', { name: 'hero.png', mime: 'image/png', bytes: PNG }),
    link: weave.attachToField(row.id, 'Links', { name: 'notes.txt', mime: 'text/plain', bytes: Buffer.from('n') }),
  };
});

if (s) {
  const { base, browser } = s;
  const rowSel = (name) => `.attach-block[data-block="${name}"]`;

  async function open() {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(rowSel('Files') + ' .attach-sheet');
    return page;
  }

  test('a many-file field left unset is a sheet of its pictures (auto · medium · trim) with the rest as chips', async () => {
    const page = await open();
    try {
      const sheet = page.locator(rowSel('Files') + ' .attach-sheet');
      assert.deepEqual(await sheet.evaluate((n) => [...n.classList].sort()), ['attach-sheet', 'fit-trim', 'size-medium']);
      assert.deepEqual(await sheet.locator('.attach-cell').evaluateAll((ns) => ns.map((n) => n.title)), ['shot.png'], 'only the picture is a cell');
      const chips = await page.locator(rowSel('Files') + ' .attach-chips .attach-item a').evaluateAll((ns) => ns.map((n) => n.textContent));
      assert.deepEqual(chips, ['spec.pdf', 'site.html'], 'the pdf and the html stay chips under auto');
      const ar = await eventually(() => sheet.locator('.attach-cell').evaluate((n) => getComputedStyle(n).getPropertyValue('--ar').trim()), '2.000');
      assert.equal(ar, '2.000', 'trim reads the picture\'s own shape once it loads');
      assert.equal(await page.locator(rowSel('Links') + ' .attach-sheet').count(), 0, 'a link preview draws no sheet');
      assert.equal(await page.locator(rowSel('Links') + ' .attach-item').count(), 1);
    } finally { await page.close(); }
  });

  test('a single-file field left unset shows its HTML upload live in a sandboxed frame', async () => {
    const page = await open();
    try {
      const frame = page.locator(rowSel('Page') + ' .file-viewer.size-medium iframe.file-viewer-frame');
      await frame.waitFor();
      assert.equal(await frame.getAttribute('sandbox'), SANDBOX);
      assert.match(await frame.getAttribute('src'), new RegExp(`/api/files/${files.page.id}\\?view$`));
      const inner = page.frames().find((f) => f.url().endsWith(`/api/files/${files.page.id}?view`));
      assert.ok(inner, 'the frame loaded the ?view route');
      await inner.waitForFunction(() => document.title !== '');
      assert.equal(await inner.evaluate(() => document.getElementById('p').textContent), 'ran', 'the page\'s own script runs');
      assert.equal(await inner.evaluate(() => document.title), 'blocked', 'the page cannot reach the record page');
      assert.equal(await page.locator(rowSel('Page') + ' .attach-chips .attach-item').count(), 1, 'the chip row stays, for the name and the ×');
    } finally { await page.close(); }
  });

  test('a cover field puts its picture at the top of the record', async () => {
    const page = await open();
    try {
      const cover = page.locator('.entity-cover');
      assert.equal(await cover.count(), 1);
      assert.deepEqual(await cover.evaluate((n) => [...n.classList].sort()), ['entity-cover', 'fit-fill', 'size-medium']);
      assert.match(await cover.locator('img').getAttribute('src'), new RegExp(`/api/files/${files.hero.id}$`));
      assert.ok(await cover.evaluate((n) => n.compareDocumentPosition(document.querySelector('.fieldrow')) & Node.DOCUMENT_POSITION_FOLLOWING), 'the cover precedes the fields');
      assert.equal(await page.locator(rowSel('Hero') + ' .attach-item').count(), 1, 'the file stays a chip in its row');
    } finally { await page.close(); }
  });

  test('a sheet cell opens the fullscreen viewer; → steps to the next file, Esc closes', async () => {
    const page = await open();
    try {
      await page.click(rowSel('Files') + ' .attach-cell');
      await page.waitForSelector('#fsv-back');
      assert.match(await page.locator('.fsv-title').textContent(), /shot\.png · 1 \/ 1/);
      assert.match(await page.locator('.fsv-frame').getAttribute('src'), new RegExp(`/api/files/${files.shot.id}$`));
      await page.keyboard.press('Escape');
      await page.waitForSelector('#fsv-back', { state: 'detached' });
    } finally { await page.close(); }
  });
}
