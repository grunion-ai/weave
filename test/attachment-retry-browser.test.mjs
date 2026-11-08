import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const rows = {};
let decks;

const s = await launch('attachment retry', (weave) => {
  weave.createSpace({ name: 'Product' });
  decks = weave.createTable({ space: 'Product', name: 'Deck' });
  weave.addField(decks, { name: 'Files', type: 'attachments' });
  for (const n of ['light', 'dark', 'oversized']) rows[n] = weave.createEntity(decks, { name: n });
});

if (s) {
  const { base, browser, weave } = s;

  const open = async (row, theme) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/entity/${rows[row].id}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector('.attach-box');
    return page;
  };

  const picker = (page) => page.locator('.attach-box input[type=file]');
  const refuse = (page) => page.route(/\/api\/uploads$/, (route) => (route.request().method() === 'PUT' ? route.fulfill({
    status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Internal error (request 1a2b3c4d)', code: 'internal', id: '1a2b3c4d' }),
  }) : route.continue()));
  const pick = (page, name = 'deck.pdf') => picker(page).setInputFiles({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 fake') });
  const stored = (row) => (weave.getEntity(rows[row].id).files ?? []).map((f) => f.name);

  for (const theme of ['light', 'dark']) {
    test(`a failed upload leaves a tile with the reason and a Retry button, and empties the input (${theme})`, async () => {
      const page = await open(theme, theme);
      try {
        await refuse(page);
        await pick(page);
        const tile = page.locator('.attach-item.is-failed', { hasText: 'deck.pdf' });
        await tile.waitFor();
        assert.match(await tile.textContent(), /Error 1a2b3c4d/, 'the failed tile names no reason or drops the request id');
        await tile.getByRole('button', { name: /retry/i }).waitFor();
        assert.equal(await picker(page).evaluate((n) => n.files.length), 0, 'the input still holds the picked file');
        assert.deepEqual(stored(theme), [], 'the refused file landed');

        await page.unroute(/\/api\/uploads$/);
        const landed = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/api\/uploads$/.test(r.url()));
        await tile.getByRole('button', { name: /retry/i }).click();
        assert.equal((await landed).status(), 201, 'Retry did not send the file again');
        await page.locator('.attach-item', { hasText: 'deck.pdf' }).filter({ hasNot: page.locator('.attach-fail-why') }).waitFor();
        await page.waitForFunction(() => !document.querySelector('.attach-item.is-failed'));
        assert.deepEqual(stored(theme), ['deck.pdf'], 'the retried file did not land');
      } finally { await page.close(); }
    });
  }

  test('a file refused before any request gets the same tile, and Retry is there after a reload', async () => {
    const page = await open('oversized', 'light');
    try {
      const posts = [];
      page.on('request', (r) => { if (r.method() === 'POST' && /\/files$/.test(r.url())) posts.push(r.url()); });
      await picker(page).setInputFiles({ name: 'huge.zip', mimeType: 'application/zip', buffer: Buffer.alloc(11 * 1024 * 1024) });
      const tile = page.locator('.attach-item.is-failed', { hasText: 'huge.zip' });
      await tile.waitFor();
      assert.match(await tile.textContent(), /Over 10 MB/, 'the tile names no limit');
      assert.equal(await tile.getByRole('button', { name: 'Retry' }).count(), 0, 'Retry cannot fix a file over the limit');
      assert.deepEqual(posts, [], 'the browser sent an oversized file');
      assert.equal(await picker(page).evaluate((n) => n.files.length), 0, 'the input still holds the picked file');
      await picker(page).setInputFiles({ name: 'huge.zip', mimeType: 'application/zip', buffer: Buffer.alloc(11 * 1024 * 1024) });
      await page.waitForFunction(() => document.querySelectorAll('.attach-item.is-failed').length === 1);
      assert.equal(await page.locator('.attach-item.is-failed').count(), 1, 'the same file failing twice stacks two tiles');
      await tile.getByRole('button', { name: /dismiss/i }).click();
      await page.waitForFunction(() => !document.querySelector('.attach-item.is-failed'));
    } finally { await page.close(); }
  });
}
