import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const rows = {};
let decks;

const s = await launch('attachment size limit', (weave) => {
  weave.createSpace({ name: 'Product' });
  decks = weave.createTable({ space: 'Product', name: 'Deck' });
  weave.addField(decks, { name: 'Files', type: 'attachments' });
  for (const n of ['light', 'dark']) rows[n] = weave.createEntity(decks, { name: n });
});

if (s) {
  const { base, browser, weave } = s;
  const OVER = 11 * 1024 * 1024;

  const cellSel = (row) => `tr[data-eid="${rows[row].id}"] td[data-field="Files"]`;

  const drop = (page, sel, bytes) => page.evaluate(({ sel, bytes }) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], 'deck.pdf', { type: 'application/pdf' }));
    for (const type of ['dragenter', 'dragover', 'drop']) {
      document.querySelector(sel).dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
  }, { sel, bytes });

  for (const theme of ['light', 'dark']) {
    test(`a file over the limit is refused in the browser, naming the file and the limit (${theme})`, async () => {
      const sel = cellSel(theme);
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      const posts = [];
      page.on('request', (r) => { if (r.method() === 'POST' && /\/files$/.test(r.url())) posts.push(r.url()); });
      try {
        await page.goto(`${base}/#/table/${decks.id}`, { waitUntil: 'networkidle' });
        await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
        await page.waitForSelector(sel);
        await drop(page, sel, OVER);
        const refusal = page.locator('.wv-toast.err', { hasText: 'deck.pdf is 11.0 MB' });
        await refusal.waitFor();
        assert.match(await refusal.textContent(), /files can be up to 10\.0 MB/, 'the refusal names no limit');
        assert.deepEqual(posts, [], 'the browser sent the file before the server refused it');
        assert.deepEqual(weave.getEntity(rows[theme].id).files ?? [], [], 'the oversized file landed anyway');
      } finally { await page.close(); }
    });
  }
}
