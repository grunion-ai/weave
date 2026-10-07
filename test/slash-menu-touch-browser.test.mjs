import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let notes;
const s = await launch('slash menu touch', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  notes = weave.createTable({ space: 'Scratch', name: 'Note' });
});
if (s) {
  const { base, browser, weave } = s;
  async function rowHeights(width, colorScheme) {
    const id = weave.createEntity(notes, { name: `Touch ${width} ${colorScheme}` }).id;
    const page = await browser.newPage({ viewport: { width, height: 844 }, colorScheme });
    try {
      await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.vditor-ir [contenteditable="true"]');
      await page.click('.vditor-ir [contenteditable="true"]');
      await page.keyboard.type('/');
      await page.waitForSelector('.vditor-hint:not(.vditor-panel--arrow) .slash-item', { state: 'visible' });
      return await page.$$eval('.vditor-hint:not(.vditor-panel--arrow) .slash-item',
        (ns) => ns.slice(0, 6).map((n) => n.getBoundingClientRect().height));
    } finally { await page.close(); }
  }

  for (const colorScheme of ['light', 'dark']) {
    test(`on a phone, every slash menu row is at least 44px tall, in ${colorScheme} (Issue #696)`, async () => {
      const heights = await rowHeights(390, colorScheme);
      assert.ok(heights.length >= 6, 'the menu lists its commands');
      for (const h of heights) assert.ok(h >= 44, `a row is ${h}px tall: ${heights.join(', ')}`);
    });
  }

  test('on a desktop, the slash menu keeps its compact rows', async () => {
    const heights = await rowHeights(1280, 'light');
    for (const h of heights) assert.ok(h < 44, `a desktop row grew to ${h}px`);
  });
}
