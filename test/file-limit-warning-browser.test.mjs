import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { THEMES } from './lib/states.mjs';

const KB = 1024;
const s = await launch('file limit warning', (weave) => {
  weave.createSpace({ name: 'Product' });
  const decks = weave.createTable({ space: 'Product', name: 'Deck' });
  weave.addField(decks, { name: 'Files', type: 'attachments' });
  const row = weave.createEntity(decks, { name: 'Launch deck' });
  const file = weave.attachFile(row.id, { name: 'plan.pdf', mime: 'application/pdf', bytes: Buffer.alloc(850 * KB) });
  weave.updateEntity(row.id, { Files: [file.id] });
  return { row };
});

const open = async (theme) => {
  const page = await s.browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript((t) => { try { localStorage.setItem('wv-theme', t); } catch {} }, theme);
  await page.goto(`${s.base}/#/entity/${s.row.id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.attach-box');
  return page;
};

const withLimit = async (mb, run) => {
  const was = process.env.WEAVE_WORKSPACE_FILE_MAX_MB;
  process.env.WEAVE_WORKSPACE_FILE_MAX_MB = String(mb);
  try { await run(); } finally {
    if (was === undefined) delete process.env.WEAVE_WORKSPACE_FILE_MAX_MB; else process.env.WEAVE_WORKSPACE_FILE_MAX_MB = was;
  }
};

if (s) {
  for (const theme of THEMES) {
    test(`a workspace at 80% of its file limit warns on the attachments tile before a file is picked (${theme})`, () => withLimit(1, async () => {
      const page = await open(theme);
      try {
        await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
        const note = page.locator('.attach-box .attach-near-full');
        await note.waitFor({ state: 'visible' });
        assert.equal(await note.textContent(), 'This workspace holds 850 KB of files and can hold 1 MB.');
        const ink = await note.evaluate((n) => getComputedStyle(n).color);
        const ground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        assert.notEqual(ink, ground, 'the warning reads against the page');
        assert.equal(await page.locator('.attach-item.is-failed').count(), 0, 'nothing was refused to get here');
      } finally { await page.close(); }
    }));
  }

  test('a workspace under 80% of its file limit, or with none, shows no warning', async () => {
    for (const mb of [2, 0]) {
      await withLimit(mb, async () => {
        const page = await open('light');
        try {
          assert.equal(await page.locator('.attach-near-full:visible').count(), 0, `limit ${mb} MB`);
        } finally { await page.close(); }
      });
    }
  });
}
