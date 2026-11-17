import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { launch } from './lib/browser.mjs';
import { tempDir } from './lib/temp.mjs';

const rows = {};
let decks;
const BYTES = Buffer.from(Array.from({ length: 64 * 1024 }, (_, i) => i % 251));
const s = await launch('upload pause', (weave) => {
  weave.createSpace({ name: 'Product' });
  decks = weave.createTable({ space: 'Product', name: 'Deck' });
  weave.addField(decks, { name: 'Files', type: 'attachments' });
  for (const n of ['light', 'dark', 'cut']) rows[n] = weave.createEntity(decks, { name: n });
}, { weave: () => new Weave({ path: join(tempDir('weave-upload-pause-'), 'ws.db') }) });

if (s) {
  const { base, browser, weave } = s;
  const open = async (row, theme) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/entity/${rows[row].id}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector('.attach-box');
    return page;
  };
  const pick = (page, name) => page.locator('.attach-box input[type="file"]').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: BYTES });
  const stored = (row) => {
    const ids = weave.getEntity(rows[row].id).values[weave.getField(decks, 'Files').id] ?? [];
    return [].concat(ids).map((id) => weave.readFile(id));
  };
  const isPut = (r) => r.request().method() === 'PUT' && /\/api\/uploads$/.test(r.url());

  for (const theme of ['light', 'dark']) {
    test(`a running upload pauses on its tile and resumes to land the whole file (${theme})`, async () => {
      const page = await open(theme, theme);
      try {
        let release;
        let done;
        const held = new Promise((r) => { release = r; });
        const dropped = new Promise((r) => { done = r; });
        await page.route(/\/api\/uploads$/, async (route) => {
          if (route.request().method() !== 'PUT') return route.continue();
          await held;
          await route.abort().catch(() => {});
          done();
        });
        await pick(page, 'deck.bin');
        const tile = page.locator('.attach-item.is-pending', { hasText: 'deck.bin' });
        await tile.getByRole('button', { name: 'Pause deck.bin' }).click();
        const paused = page.locator('.attach-item.is-paused', { hasText: 'deck.bin' });
        await paused.waitFor();
        assert.match(await paused.textContent(), /Paused \d+%/);
        assert.equal(await page.locator('.attach-box').getAttribute('aria-busy'), null, 'a paused upload still marks the field busy');
        release();
        await dropped;
        await page.unroute(/\/api\/uploads$/);
        const landed = page.waitForResponse(isPut);
        await paused.getByRole('button', { name: 'Resume deck.bin' }).click();
        assert.equal((await landed).status(), 201, 'Resume did not finish the upload');
        await page.waitForFunction(() => !document.querySelector('[data-upload-job]'));
        assert.deepEqual(stored(theme).map((f) => f.bytes), [BYTES]);
      } finally { await page.close(); }
    });
  }

  test('Retry after a cut connection sends only the bytes the server does not hold', async () => {
    const page = await open('cut', 'light');
    try {
      const half = BYTES.length / 2;
      const sent = [];
      await page.route(/\/api\/uploads$/, async (route) => {
        const req = route.request();
        if (req.method() !== 'PUT') return route.continue();
        sent.push({ offset: req.headers()['upload-offset'], length: req.postDataBuffer()?.length });
        if (sent.length === 1) return route.continue({ postData: req.postDataBuffer().subarray(0, half) });
        return route.continue();
      });
      await pick(page, 'cut.bin');
      const failed = page.locator('.attach-item.is-failed', { hasText: 'cut.bin' });
      await failed.waitFor();
      const landed = page.waitForResponse((r) => isPut(r) && r.status() === 201);
      await failed.getByRole('button', { name: /retry/i }).click();
      await landed;
      assert.deepEqual(sent, [{ offset: '0', length: BYTES.length }, { offset: String(half), length: BYTES.length - half }]);
      await page.waitForFunction(() => !document.querySelector('[data-upload-job]'));
      assert.deepEqual(stored('cut').map((f) => f.bytes), [BYTES]);
    } finally { await page.close(); }
  });
}
