import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tableRef;
const s = await launch('crepe editor theme', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  tableRef = weave.createTable({ space: 'Scratch', name: 'Note' });
});

if (s) {
  const { base, browser, weave } = s;
  const SURFACE = '.wv-crepe .ProseMirror[contenteditable="true"]';

  for (const theme of ['light', 'dark']) {
    test(`the Crepe editor paints with weave's own tokens (${theme})`, async () => {
      const e = weave.createEntity(tableRef, { name: `Theme ${theme}` });
      weave.setDoc(e.id, 'Plain words.\n\n> A quote.', 'Description');
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      try {
        await page.addInitScript(() => localStorage.setItem('weave.editor', 'crepe'));
        await page.goto(`${base}/#/entity/${e.id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector(SURFACE, { timeout: 30000 });
        await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
        const paint = await page.evaluate(() => {
          const probe = (v) => {
            const d = document.createElement('div');
            d.style.color = `var(${v})`;
            document.body.append(d);
            const c = getComputedStyle(d).color;
            d.remove();
            return c;
          };
          const p = document.querySelector('.wv-crepe .ProseMirror p');
          const box = document.querySelector('.wv-crepe .milkdown');
          return {
            text: getComputedStyle(p).color,
            body: probe('--tblr-body-color'),
            background: getComputedStyle(box).backgroundColor,
            font: getComputedStyle(p).fontFamily,
            bodyFont: getComputedStyle(document.body).fontFamily,
          };
        });
        assert.equal(paint.text, paint.body, 'document text uses the theme body colour');
        assert.ok(['rgba(0, 0, 0, 0)', 'transparent'].includes(paint.background), `the editor lets the panel show through, got ${paint.background}`);
        assert.equal(paint.font, paint.bodyFont, 'document text uses weave\'s font');
      } finally { await page.close(); }
    });
  }
}
