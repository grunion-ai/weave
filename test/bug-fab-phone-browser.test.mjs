import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage } from './lib/browser.mjs';

let notes, id;
const s = await launch('bug fab phone', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  notes = weave.createTable({ space: 'Scratch', name: 'Note' });
  id = weave.createEntity(notes, { name: 'Long note' }).id;
  const lines = Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of a long document that runs to the right edge of a phone.`);
  weave.setDoc(id, lines.join('\n\n'));
});
if (s) {
  const { base, browser } = s;
  const fab = (page) => page.$eval('.bug-fab', (b) => {
    const r = b.getBoundingClientRect();
    const inset = parseFloat(getComputedStyle(b).borderTopWidth) || 0;
    return { left: r.left, top: r.top, right: r.right, width: r.width, height: r.height, face: r.width - 2 * inset, inset, vw: innerWidth };
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`on a phone the bug button is a 44px target on the screen edge, and the end of a document clears it, in ${colorScheme} (Issue #695)`, async () => {
      const page = await phonePage(await phoneBrowser(), { colorScheme });
      try {
        await page.goto(`${base}/#/table/${notes.id}?e=${id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('#dock:not([hidden]) .vditor-ir [contenteditable="true"]');
        const b = await fab(page);
        assert.ok(b.width >= 44 && b.height >= 44, `the tap target is ${b.width}x${b.height}px`);
        assert.ok(Math.abs(b.face - 26) < 1, `the drawn face stays the desktop's 26px, got ${b.face}px`);
        assert.ok(b.vw - b.right <= 3.5, `the button hugs the edge, ${b.vw - b.right}px in`);
        await page.$eval('#dock', (d) => { d.scrollTop = d.scrollHeight; });
        await page.waitForTimeout(100);
        const last = await page.$eval('#dock .vditor-ir .vditor-reset > p:last-of-type', (p) => {
          const r = p.getBoundingClientRect();
          return { bottom: r.bottom, right: r.right };
        });
        const faceTop = b.top + b.inset;
        assert.ok(last.bottom <= faceTop, `the last line ends at ${last.bottom}px, under the button face at ${faceTop}px`);
      } finally { await page.close(); }
    });
  }

  test('on a desktop the bug button keeps its 26px corner', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      await page.goto(`${base}/#/table/${notes.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.bug-fab');
      const b = await fab(page);
      assert.equal(Math.round(b.width), 26);
      assert.equal(Math.round(b.vw - b.right), 12);
    } finally { await page.close(); }
  });
}
