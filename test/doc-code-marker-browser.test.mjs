import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage } from './lib/browser.mjs';

let id;
const s = await launch('doc code block marker', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  const notes = weave.createTable({ space: 'Scratch', name: 'Note' });
  id = weave.createEntity(notes, { name: 'Code case' }).id;
  weave.setDoc(id, 'Line above the code.\n\n```js\nconst a = 1;\n```\n\nLine below the code.\n');
});

if (s) {
  const { base, browser } = s;
  for (const [label, viewport] of [['phone', null], ['desktop', { width: 1280, height: 800 }]]) {
    test(`a code block at rest paints nothing outside its box on a ${label} (Issue #704)`, async () => {
      const page = viewport ? await browser.newPage({ viewport }) : await phonePage(await phoneBrowser());
      try {
        await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.vditor-ir [data-type="code-block"] pre.vditor-ir__preview');
        const m = await page.evaluate(() => {
          const node = document.querySelector('.vditor-ir [data-type="code-block"]');
          const marker = node.querySelector('pre.vditor-ir__marker--pre');
          const r = marker.getBoundingClientRect();
          return { expanded: node.classList.contains('vditor-ir__node--expand'), w: r.width, h: r.height };
        });
        assert.equal(m.expanded, false, 'the block is at rest');
        assert.deepEqual([m.w, m.h], [0, 0], `the hidden source box paints ${m.w}x${m.h}px`);
      } finally { await page.close(); }
    });
  }

  test('the raw source of an expanded code block keeps its bordered box (Issue #704)', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.vditor-ir [data-type="code-block"] pre.vditor-ir__preview');
      await page.evaluate(() => {
        document.querySelector('.doc-editor').classList.add('wv-code-raw');
        document.querySelector('.vditor-ir [data-type="code-block"]').classList.add('vditor-ir__node--expand');
      });
      const marker = page.locator('.vditor-ir [data-type="code-block"] pre.vditor-ir__marker--pre');
      await page.waitForFunction((pre) => getComputedStyle(pre).borderTopWidth === '1px', await marker.elementHandle(), { timeout: 5000 });
      assert.equal(await marker.evaluate((pre) => getComputedStyle(pre).borderTopStyle), 'solid');
    } finally { await page.close(); }
  });
}
