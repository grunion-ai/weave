import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tableRef;
const s = await launch('crepe inline html', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  tableRef = weave.createTable({ space: 'Scratch', name: 'Note' });
});

if (s) {
  const { base, browser, weave } = s;

  test('an inline <br> breaks the line under Crepe instead of showing as text (Issue #1897)', async () => {
    const e = weave.createEntity(tableRef, { name: 'Breaks' });
    weave.setDoc(e.id, '**Cashback portals**<br>*none found*\n\nA<br/>B<br />C\n', 'Description');
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      await page.addInitScript(() => localStorage.setItem('weave.editor', 'crepe'));
      await page.goto(`${base}/#/entity/${e.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-crepe .ProseMirror[contenteditable="true"]', { timeout: 30000 });
      const r = await page.evaluate(() => {
        const ps = [...document.querySelectorAll('.wv-crepe .ProseMirror p')];
        const top = (p, word) => {
          const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const at = n.data.indexOf(word);
            if (at < 0) continue;
            const range = document.createRange();
            range.setStart(n, at);
            range.setEnd(n, at + word.length);
            return range.getBoundingClientRect().top;
          }
          return null;
        };
        return {
          shown: ps.map((p) => p.innerText).join(' | '),
          first: [top(ps[0], 'Cashback'), top(ps[0], 'none')],
          second: [top(ps[1], 'A'), top(ps[1], 'B'), top(ps[1], 'C')],
        };
      });
      assert.doesNotMatch(r.shown, /<br/, `no tag shows as text: ${r.shown}`);
      assert.ok(r.first[1] > r.first[0], 'the text after <br> starts a new line');
      assert.ok(r.second[1] > r.second[0] && r.second[2] > r.second[1], '<br/> and <br /> break too');
    } finally { await page.close(); }
  });
}
