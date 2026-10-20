import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const rows = {};
let decks;
const s = await launch('attachment preview', (weave) => {
  weave.createSpace({ name: 'Product' });
  decks = weave.createTable({ space: 'Product', name: 'Deck' });
  weave.addField(decks, { name: 'Shots', type: 'attachments' });
  weave.addField(decks, { name: 'Hero', type: 'attachments', config: { multiple: false, preview: 'cover' } });
  for (const n of ['light', 'dark', 'cover']) rows[n] = weave.createEntity(decks, { name: n });
});

if (s) {
  const { base, browser, weave } = s;
  const photo = (page) => page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 4000;
    c.height = 3000;
    const g = c.getContext('2d');
    const img = g.createImageData(c.width, c.height);
    let x = 7;
    for (let i = 0; i < img.data.length; i += 4) {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      img.data[i] = x & 255;
      img.data[i + 1] = (x >> 8) & 255;
      img.data[i + 2] = (i >> 10) & 255;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    let blob;
    for (const q of [0.9, 0.75, 0.6, 0.45, 0.3]) {
      blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
      if (blob.size < 6 * 1024 * 1024) break;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  });
  const open = async (row, theme) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/entity/${rows[row].id}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector('.attach-box');
    return page;
  };
  const fileRequest = (page, preview) => page.waitForResponse((r) => r.request().method() === 'GET'
    && /\/api\/files\/[0-9a-f-]{36}(\?preview)?$/.test(r.url()) && r.url().endsWith('?preview') === preview);

  for (const theme of ['light', 'dark']) {
    test(`a 4000 px photo shows in its sheet cell from a small preview, and the viewer opens the original (${theme})`, async () => {
      const page = await open(theme, theme);
      try {
        const shots = page.locator('.fieldrow', { has: page.locator('.fieldrow-label', { hasText: 'Shots' }) }).locator('input[type=file]');
        const b64 = await photo(page);
        const original = Buffer.from(b64, 'base64');
        assert.ok(original.length > 1_000_000, `the test photo is only ${original.length} bytes`);
        const cellReq = fileRequest(page, true);
        await shots.setInputFiles({ name: 'phone.jpg', mimeType: 'image/jpeg', buffer: original });
        const cell = await cellReq;
        const cellBytes = (await cell.body()).length;
        assert.ok(cellBytes < 60 * 1024, `the cell downloaded ${cellBytes} bytes`);
        const img = page.locator('.attach-sheet .attach-cell img');
        await img.waitFor();
        assert.deepEqual(await img.evaluate((n) => [n.loading, n.decoding]), ['lazy', 'async']);
        await page.waitForFunction(() => document.querySelector('.attach-sheet .attach-cell img')?.naturalWidth > 0);
        assert.equal(await img.evaluate((n) => Math.max(n.naturalWidth, n.naturalHeight)), 320);
        const stored = weave.readEntity(rows[theme].id).files[0];
        assert.equal(stored.size, original.length, 'the original was not stored whole');
        assert.ok(stored.preview?.size < 60 * 1024, 'the file entry records no preview');
        assert.match(stored.preview.mime, /^image\/(webp|jpeg)$/);
        console.log(`# cell bytes ${theme}: before ${original.length}, after ${cellBytes}`);

        const viewReq = fileRequest(page, false);
        await img.click();
        const view = await viewReq;
        assert.equal((await view.body()).length, original.length, 'the viewer did not load the original');
      } finally { await page.close(); }
    });
  }

  test('the cover shows the preview first, lazy and async', async () => {
    const page = await open('cover', 'light');
    try {
      const b64 = await photo(page);
      const coverReq = fileRequest(page, true);
      const hero = page.locator('.fieldrow', { has: page.locator('.fieldrow-label', { hasText: 'Hero' }) }).locator('input[type=file]');
      await hero.setInputFiles({ name: 'hero.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
      await page.reload({ waitUntil: 'domcontentloaded' });
      const cover = page.locator('.entity-cover img');
      await cover.waitFor();
      assert.ok((await (await coverReq).body()).length < 60 * 1024);
      assert.deepEqual(await cover.evaluate((n) => [n.loading, n.decoding]), ['lazy', 'async']);
    } finally { await page.close(); }
  });
}
