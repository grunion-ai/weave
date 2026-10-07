import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let notes, id;
const s = await launch('doc toolbar phone', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  notes = weave.createTable({ space: 'Scratch', name: 'Note' });
  id = weave.createEntity(notes, { name: 'Toolbar case' }).id;
  weave.setDoc(id, 'First line above the selection.\n\nSelect this word here.\n\nLast line below it.\n');
});
if (s) {
  const { base, browser } = s;
  async function selectWord(page) {
    await page.waitForSelector('.vditor-ir [contenteditable="true"]');
    await page.evaluate(() => {
      const p = [...document.querySelectorAll('.vditor-ir .vditor-reset > p')].find((n) => n.textContent.startsWith('Select'));
      const text = p.firstChild;
      const range = document.createRange();
      range.setStart(text, 7);
      range.setEnd(text, 11);
      p.closest('[contenteditable="true"]').focus();
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await page.waitForSelector('.doc-editor .vditor-toolbar.wv-show');
    await page.waitForTimeout(100);
  }
  const measure = (page) => page.evaluate(() => {
    const bar = document.querySelector('.doc-editor .vditor-toolbar.wv-show');
    const r = bar.getBoundingClientRect();
    const sel = getSelection().getRangeAt(0).getBoundingClientRect();
    const buttons = [...bar.querySelectorAll('button')].filter((b) => b.offsetParent)
      .map((b) => b.getBoundingClientRect()).map((b) => ({ w: b.width, h: b.height }));
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height,
      position: getComputedStyle(bar).position, selTop: sel.top, selBottom: sel.bottom,
      vw: innerWidth, vh: innerHeight, buttons };
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`on a phone the formatting bar is one row of 44px buttons along the bottom, clear of the text, in ${colorScheme} (Issue #693)`, async () => {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme });
      try {
        await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
        await selectWord(page);
        const m = await measure(page);
        assert.ok(m.buttons.length >= 10, 'the bar holds its commands');
        for (const b of m.buttons) assert.ok(b.w >= 44 && b.h >= 44, `a button is ${b.w}x${b.h}px`);
        assert.ok(m.height < 70, `the bar is one row, ${m.height}px tall`);
        assert.ok(Math.abs(m.bottom - m.vh) <= 1, `the bar sits on the bottom edge, ending at ${m.bottom} of ${m.vh}`);
        assert.ok(m.left <= 0.5 && m.right >= m.vw - 0.5, 'the bar spans the screen');
        assert.ok(m.top > m.selBottom, 'the bar is below the selected text, not over the line above');
      } finally { await page.close(); }
    });
  }

  test('on a desktop the formatting bar still floats over the selection', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
      await selectWord(page);
      const m = await measure(page);
      assert.equal(m.position, 'absolute');
      assert.ok(m.bottom <= m.selTop || m.top >= m.selBottom, 'the bubble floats beside the selection without covering it');
    } finally { await page.close(); }
  });
}
