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
  const task = weave.createTable({ space: 'Dev', name: 'Task' });
  weave.addField('Task', { name: 'Captured', type: 'date' });
  weave.addField('Task', { name: 'Owner', type: 'text' });
  weave.updateField(task.id, 'Chip', { config: { state: false, fields: ['Captured', 'Owner'] } });
  const heard = weave.createEntity('Task', { name: 'Hear problems', Captured: '2026-10-29', Owner: 'Dylan' });
  const notes = weave.createEntity('Feature', { name: 'Notes', State: 'Planned' });
  const wide = weave.createEntity('Task', { name: LONG, Captured: '2026-10-29', Owner: 'Dylan' });
  weave.setDoc(notes.id, `Follow [[Task#${heard.publicId}|Hear problems]]--- then the words carry on after it.\n\nWide [[Task#${wide.publicId}]] one.`);
  return { doc, notes };
});

if (s) {
  const { base, browser, doc, notes } = s;

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

    const SLOT = '.doc-ref-layer .doc-ref-slot';
    const openNotes = async (page) => {
      await page.goto(`${base}/#/entity/${notes.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector(`${SLOT} .mention-caret`);
    };
    const opened = () => document.querySelector('.doc-ref-layer .doc-ref-slot .k-rel')?.classList.contains('open') === true;
    const readChip = (page) => page.evaluate((tail) => {
      const slot = document.querySelector('.doc-ref-layer .doc-ref-slot');
      const k = slot.querySelector('.k-rel');
      const raw = document.querySelector('.doc-ref-raw');
      const root = document.querySelector('.vditor-ir .vditor-reset');
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let after = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const at = n.nodeValue.indexOf(tail);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(n, at);
        range.setEnd(n, at + tail.length);
        after = [...range.getClientRects()].map((c) => ({ left: c.left, top: c.top, bottom: c.bottom }));
      }
      const box = (n) => { const r = n.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }; };
      return {
        open: k.classList.contains('open'),
        expanded: k.querySelector('.mention-caret').getAttribute('aria-expanded'),
        focused: document.activeElement === k.querySelector('.mention-caret'),
        long: slot.classList.contains('long'),
        slot: box(slot),
        chip: box(k),
        raw: box(raw),
        after,
      };
    }, '--- then');
    const clearOfProse = (m) => {
      assert.ok(m.after.length, 'the prose after the chip is found');
      for (const r of m.after) {
        const sameLine = r.top < m.slot.bottom - 0.5 && m.slot.top < r.bottom - 0.5;
        assert.ok(!sameLine || r.left >= m.slot.right - 0.5, `the prose after the chip never sits under it: ${JSON.stringify({ slot: m.slot, r })}`);
      }
    };

    test(`opening a reference chip in the editor pushes the prose along instead of covering it, in ${colorScheme}`, async () => {
      const page = await browser.newPage({ colorScheme, viewport: { width: 900, height: 800 } });
      try {
        await openNotes(page);
        const closed = await readChip(page);
        clearOfProse(closed);
        await page.click(`${SLOT} .mention-caret`);
        await page.waitForFunction(opened);
        await page.waitForFunction(() => {
          const raw = document.querySelector('.doc-ref-raw').getBoundingClientRect().width;
          return raw >= document.querySelector('.doc-ref-layer .doc-ref-slot .k-rel').getBoundingClientRect().width - 0.5;
        });
        const open = await readChip(page);
        assert.equal(open.expanded, 'true');
        assert.ok(open.slot.width > closed.slot.width + 20, `the slot grows with the chip: ${closed.slot.width} to ${open.slot.width}`);
        assert.ok(open.chip.right <= open.slot.right + 0.5, `the open chip stays inside its slot: ${JSON.stringify(open)}`);
        assert.equal(open.long, false, 'an open chip that fits is not cut off');
        assert.ok(Math.abs(open.raw.width - open.slot.width) < 1, 'the source span holds the same room in the line');
        clearOfProse(open);
        await page.click(`${SLOT} .mention-caret`);
        await page.waitForFunction(() => !document.querySelector('.doc-ref-layer .doc-ref-slot .k-rel').classList.contains('open'));
        await page.waitForFunction((w) => document.querySelector('.doc-ref-raw').getBoundingClientRect().width < w + 1, closed.raw.width);
        const again = await readChip(page);
        assert.equal(again.expanded, 'false');
        assert.ok(Math.abs(again.slot.width - closed.slot.width) < 1, 'closing returns the chip to its closed width');
      } finally { await page.close(); }
    });

    test(`an open reference chip stays open and keeps focus through an overlay rebuild, in ${colorScheme}`, async () => {
      const page = await browser.newPage({ colorScheme, viewport: { width: 900, height: 800 } });
      try {
        await openNotes(page);
        await page.focus(`${SLOT} .mention-caret`);
        await page.keyboard.press('Enter');
        await page.waitForFunction(opened);
        const before = await page.$eval(SLOT, (n) => { n.dataset.drawn = 'old'; return n.isConnected; });
        assert.equal(before, true);
        await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
        await page.waitForFunction(() => {
          const slot = document.querySelector('.doc-ref-layer .doc-ref-slot');
          return slot && slot.dataset.drawn !== 'old';
        });
        const m = await readChip(page);
        assert.equal(m.open, true, 'the rebuild draws the chip open');
        assert.equal(m.expanded, 'true');
        assert.equal(m.focused, true, 'keyboard focus stays on the caret');
        clearOfProse(m);
      } finally { await page.close(); }
    });

    test(`a reference chip wider than its line keeps its badge and caret reachable, closed and open, in ${colorScheme}`, async () => {
      const page = await browser.newPage({ colorScheme, viewport: { width: 900, height: 800 } });
      try {
        await openNotes(page);
        const WIDE = `${SLOT}.long`;
        await page.waitForSelector(`${WIDE} .mention-caret`);
        const edges = () => page.$eval(WIDE, (slot) => {
          const k = slot.querySelector('.k-rel');
          const right = slot.getBoundingClientRect().right;
          return {
            open: k.classList.contains('open'),
            lines: new Set([...k.getClientRects()].map((c) => Math.round(c.top))).size,
            caret: k.querySelector('.mention-caret').getBoundingClientRect().right - right,
            home: k.querySelector('.k-home').getBoundingClientRect().right - right,
          };
        });
        const inside = (m) => {
          assert.equal(m.lines, 1, 'one line tall');
          assert.ok(m.caret <= 0.5, `the caret stays inside the slot: ${m.caret}px past its edge`);
          assert.ok(m.home <= 0.5, `the table badge stays inside the slot: ${m.home}px past its edge`);
        };
        const closed = await edges();
        assert.equal(closed.open, false);
        inside(closed);
        await page.click(`${WIDE} .mention-caret`);
        await page.waitForFunction((sel) => document.querySelector(`${sel} .k-rel`)?.classList.contains('open'), WIDE);
        const open = await edges();
        inside(open);
        await page.click(`${WIDE} .mention-caret`);
        await page.waitForFunction((sel) => document.querySelector(`${sel} .k-rel`)?.classList.contains('open') === false, WIDE);
      } finally { await page.close(); }
    });

    const gaps = (page, root) => page.$eval(root, (k) => {
      const box = (n) => n.getBoundingClientRect();
      const segs = [...k.querySelectorAll('.mention-fields > *')];
      return {
        segments: segs.length,
        betweenSegments: segs.slice(1).map((seg, i) => box(seg).left - box(segs[i]).right),
        beforeHome: box(k.querySelector('.k-home')).left - box(k.querySelector('.mention-fields')).right,
      };
    });
    const assertGaps = (m) => {
      assert.equal(m.segments, 2, 'both fields show');
      assert.ok(m.beforeHome >= 4, `the table badge stands clear of the last field: ${m.beforeHome}px`);
      for (const g of m.betweenSegments) assert.ok(g >= 4, `fields stand clear of each other: ${g}px`);
    };

    test(`an open reference chip spaces its fields and table badge in the editor, in ${colorScheme}`, async () => {
      const page = await browser.newPage({ colorScheme, viewport: { width: 900, height: 800 } });
      try {
        await openNotes(page);
        await page.click(`${SLOT} .mention-caret`);
        await page.waitForFunction(opened);
        assertGaps(await gaps(page, `${SLOT} .k-rel`));
      } finally { await page.close(); }
    });

    test(`an open reference chip spaces its fields and table badge in the read view, in ${colorScheme}`, async () => {
      const page = await browser.newPage({ colorScheme, viewport: { width: 900, height: 800 } });
      try {
        await page.goto(`${base}/e/${notes.id}/doc.html`, { waitUntil: 'load' });
        await page.click('.k-rel .mention-caret');
        await page.waitForFunction(() => document.querySelector('.k-rel')?.classList.contains('open'));
        assertGaps(await gaps(page, '.k-rel'));
      } finally { await page.close(); }
    });
  }
}
