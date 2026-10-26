import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, styleOf } from './lib/browser.mjs';

let row;
const s = await launch('glyph tiles show the real file name', (weave) => {
  weave.createSpace({ name: 'Product' });
  const deck = weave.createTable({ space: 'Product', name: 'Deck' });
  weave.addField(deck, { name: 'Docs', type: 'attachments', config: { preview: 'inline' } });
  row = weave.createEntity(deck, { name: 'row' });
  weave.attachToField(row.id, 'Docs', { name: 'Mixed-Case-Spec.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-1.4') });
});

if (s) {
  const { base, browser } = s;
  for (const theme of ['light', 'dark']) {
    test(`a glyph tile keeps its name's case, underlines nothing and carries a chip-sized remove button (${theme}) (Issue #1192)`, async () => {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
      try {
        await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
        const cell = page.locator('.attach-block[data-block="Docs"] .attach-cell.is-glyph');
        await cell.waitFor();
        const label = cell.locator('.attach-cell-label');
        const kind = cell.locator('.attach-cell-kind');
        assert.equal(await styleOf(label, 'textTransform', 'none'), 'none', 'the file name is shown as it is spelled');
        assert.equal(await styleOf(label, 'letterSpacing', 'normal'), 'normal');
        assert.equal(await styleOf(kind, 'textTransform', 'uppercase'), 'uppercase', 'the kind word stays a small-caps tag');
        await cell.hover();
        await styleOf(cell.locator('.tiny'), 'opacity', '1');
        for (const n of [cell, kind, label]) assert.equal(await styleOf(n, 'textDecorationLine', 'none'), 'none', 'no underline in the tile on hover');
        const [x, chipX] = await Promise.all([
          cell.locator('.tiny').evaluate((n) => { const b = n.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; }),
          page.locator('.attach-chips .attach-item .tiny').first().evaluate((n) => { const b = n.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; }).catch(() => null),
        ]);
        assert.ok(x.w <= 24 && x.h <= 24, `the remove button is small: ${JSON.stringify(x)}`);
        if (chipX) assert.ok(Math.abs(x.h - chipX.h) <= 4, 'about the chip remove button\'s size');
      } finally { await page.close(); }
    });
  }
}
