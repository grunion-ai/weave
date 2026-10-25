import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const LONG = 'Integration: connectors pull every source table into the workspace, keep each row in step with its origin and report the rows they could not read';

const s = await launch('a document reference chip draws on one line', (weave) => {
  weave.createSpace({ name: 'Dev' });
  const feature = weave.createTable({ space: 'Dev', name: 'Feature' });
  weave.addField('Feature', {
    name: 'State',
    type: 'workflow',
    config: {
      states: [
        { name: 'Planned', category: 'not-started' },
        { name: 'Shipped', category: 'done' },
      ],
    },
  });
  weave.updateField(feature.id, 'Chip', { config: { state: true } });
  const long = weave.createEntity('Feature', { name: 'Connectors', State: 'Planned' });
  const short = weave.createEntity('Feature', { name: 'Sync', State: 'Planned' });
  const md = [
    '## Build order',
    '',
    `1. Start with [[Feature#${short.publicId}|Sync]] so rows arrive.`,
    `2. Then [[Feature#${long.publicId}|${LONG}]] after the first source lands.`,
    '',
  ].join('\n');
  const doc = weave.createEntity('Feature', { name: 'Integration', State: 'Planned' });
  weave.setDoc(doc.id, md);
  return { doc };
});

if (s) {
  const { base, browser, doc } = s;

  for (const colorScheme of ['light', 'dark']) {
    test(`a long-titled reference chip with a state pill stays one line tall inside a list item, in ${colorScheme}`, async () => {
      const page = await browser.newPage({ colorScheme, viewport: { width: 900, height: 800 } });
      try {
        await page.goto(`${base}/#/entity/${doc.id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.vditor-ir [contenteditable="true"]');
        await page.waitForFunction(() => document.querySelectorAll('.doc-ref-layer .doc-ref-slot .k-rel').length === 2, null, { timeout: 20000 });
        const seen = await page.evaluate(() => {
          const slots = [...document.querySelectorAll('.doc-ref-layer .doc-ref-slot')].map((slot) => {
            const k = slot.querySelector('.k-rel');
            const r = slot.getBoundingClientRect();
            return {
              label: k.querySelector('.k-label')?.textContent,
              state: !!k.querySelector('.k'),
              height: r.height,
              lines: new Set([...k.getClientRects()].map((c) => Math.round(c.top))).size,
              box: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
            };
          });
          const root = document.querySelector('.vditor-ir .vditor-reset');
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          let after = null;
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const at = n.nodeValue.indexOf('after the first source lands');
            if (at < 0) continue;
            const range = document.createRange();
            range.setStart(n, at); range.setEnd(n, at + 'after the first source lands'.length);
            after = [...range.getClientRects()].map((c) => ({ left: c.left, right: c.right, top: c.top, bottom: c.bottom }));
          }
          return { slots, after };
        });
        const long = seen.slots.find((x) => x.label === LONG);
        const short = seen.slots.find((x) => x.label === 'Sync');
        assert.ok(long && short, `both references draw as chips: ${JSON.stringify(seen.slots.map((x) => x.label))}`);
        assert.ok(long.state && short.state, 'each chip carries its state pill');
        assert.equal(long.lines, 1, `the long chip keeps its state pill and title on one line: ${JSON.stringify(long)}`);
        assert.ok(Math.abs(long.height - short.height) < 1, `the long slot is one line tall like the short one (${long.height.toFixed(1)}px vs ${short.height.toFixed(1)}px)`);
        const overlaps = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
        assert.ok(seen.after?.length, 'the prose after the long chip is found');
        for (const r of seen.after) assert.ok(!overlaps(long.box, r), `the prose after the chip never sits under it: ${JSON.stringify({ chip: long.box, r })}`);
      } finally { await page.close(); }
    });
  }
}
