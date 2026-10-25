import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABAQMAAADO7O3JAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8AAP///0EdNBEAAAABYktHRAH/Ai3eAAAAB3RJTUUH6goFETs3n475pwAAAApJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII=', 'base64');
let row;
const s = await launch('attachment tiles stay inside their field row', (weave) => {
  weave.createSpace({ name: 'Product' });
  const deck = weave.createTable({ space: 'Product', name: 'Deck' });
  weave.addField(deck, { name: 'Shots', type: 'attachments' });
  weave.addField(deck, { name: 'Docs', type: 'attachments', config: { preview: 'inline' } });
  weave.addField(deck, { name: 'Grid', type: 'attachments', config: { preview: 'inline', fit: 'fill' } });
  weave.addField(deck, { name: 'Notes', type: 'text' });
  row = weave.createEntity(deck, { name: 'row', Notes: 'after' });
  weave.attachToField(row.id, 'Shots', { name: 'shot.png', mime: 'image/png', bytes: PNG });
  weave.attachToField(row.id, 'Shots', { name: 'shot2.png', mime: 'image/png', bytes: PNG });
  weave.attachToField(row.id, 'Shots', { name: 'spec.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-1.4') });
  weave.attachToField(row.id, 'Docs', { name: 'spec.pdf', mime: 'application/pdf', bytes: Buffer.from('%PDF-1.4') });
  weave.attachToField(row.id, 'Docs', { name: 'notes.txt', mime: 'text/plain', bytes: Buffer.from('n') });
  weave.attachToField(row.id, 'Grid', { name: 'bundle.zip', mime: 'application/zip', bytes: Buffer.from('PK') });
});

if (s) {
  const { base, browser } = s;
  const boxes = (page, name) => page.evaluate((n) => {
    const r = (x) => { const b = x.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
    const block = document.querySelector(`.attach-block[data-block="${n}"]`);
    return {
      block: r(block),
      cells: [...block.querySelectorAll('.attach-cell')].map(r),
      add: r(block.querySelector('.attach-chips > button')),
      loaded: [...block.querySelectorAll('.attach-cell img')].every((i) => i.complete && i.naturalWidth > 0),
    };
  }, name);
  const meets = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  const inside = (a, o) => a.l >= o.l - 0.5 && a.r <= o.r + 0.5 && a.t >= o.t - 0.5 && a.b <= o.b + 0.5;

  for (const theme of ['light', 'dark']) {
    test(`every tile sits inside its field row and clear of the + file button (${theme}) (Issue #1191)`, async () => {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
      try {
        await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.attach-block[data-block="Grid"] .attach-cell');
        await eventually(async () => (await boxes(page, 'Shots')).loaded, true);
        for (const name of ['Shots', 'Docs', 'Grid']) {
          const got = await boxes(page, name);
          assert.ok(got.cells.length > 0, `${name} draws tiles`);
          for (const [i, cell] of got.cells.entries()) {
            assert.ok(inside(cell, got.block), `${name} tile ${i} stays inside its row: ${JSON.stringify({ cell, block: got.block })}`);
            assert.ok(!meets(cell, got.add), `${name} tile ${i} leaves the + file button clear: ${JSON.stringify({ cell, add: got.add })}`);
          }
        }
        const add = page.locator('.attach-block[data-block="Docs"] .attach-chips > button');
        assert.equal(await add.evaluate((n) => { const b = n.getBoundingClientRect(); return document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) === n; }), true, 'the + file button takes its own click');
      } finally { await page.close(); }
    });
  }
}
