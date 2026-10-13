import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const LONG = 'Grid: after + New, the view must snap to the new row and keep it in view while the editor stays dropped';
const WRAPS = 'Search: a route that fails must say why it failed, name the field it could not read, keep the query the reader typed and offer the nearest table that does hold that field';

const s = await launch('document reference chips sit inline', (weave) => {
  weave.createSpace({ name: 'Dev' });
  weave.createTable({ space: 'Dev', name: 'Issue' });
  const long = weave.createEntity('Issue', { name: 'Snap to the new row' });
  const wraps = weave.createEntity('Issue', { name: 'Routes say why' });
  const short = weave.createEntity('Issue', { name: 'Eye rows' });
  const md = [
    `- [[Issue#${long.publicId}|${LONG}]] A route that fails`,
    `- Then [[Issue#${wraps.publicId}|${WRAPS}]] One more line`,
    `- [[Issue#${short.publicId}|Eye rows]] The eye's rows`,
    '',
  ].join('\n');
  const doc = weave.createEntity('Issue', { name: 'Notes' });
  weave.setDoc(doc.id, md);
  return { doc, md };
});

if (s) {
  const { base, browser, weave, doc, md } = s;

  const probe = (page) => page.evaluate(() => {
    const root = document.querySelector('.vditor-ir .vditor-reset');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const width = (n, a, b) => {
      const r = document.createRange();
      r.setStart(n, a); r.setEnd(n, b);
      return [...r.getClientRects()];
    };
    const marks = [];
    const prose = {};
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      for (const tok of ['[[', ']]']) {
        for (let i = n.nodeValue.indexOf(tok); i >= 0; i = n.nodeValue.indexOf(tok, i + 1)) {
          const w = width(n, i, i + 2).reduce((sum, r) => sum + r.width, 0);
          if (w > 0.5) marks.push(`${tok} ${w.toFixed(1)}px near "${n.nodeValue.slice(Math.max(0, i - 8), i + 10)}"`);
        }
      }
      for (const words of ['A route that fails', 'One more line', "The eye's rows"]) {
        const at = n.nodeValue.indexOf(words);
        if (at >= 0) prose[words] = width(n, at, at + words.length).map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom }));
      }
    }
    const chips = [...document.querySelectorAll('.doc-ref-layer .k-rel')].map((k) => {
      const r = k.getBoundingClientRect();
      return { label: k.querySelector('.k-label')?.textContent, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
    return { marks, prose, chips };
  });

  const overlaps = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

  const openEditor = async (colorScheme) => {
    const page = await browser.newPage({ colorScheme, viewport: { width: 900, height: 800 } });
    await page.goto(`${base}/#/entity/${doc.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.vditor-ir [contenteditable="true"]');
    await page.waitForFunction(() => document.querySelectorAll('.doc-ref-layer .k-rel').length === 3, null, { timeout: 20000 });
    return page;
  };

  for (const colorScheme of ['light', 'dark']) {
    test(`a long aliased reference reads as one inline chip, with no [[ or ]] showing and the prose after it beside the chip, in ${colorScheme}`, async () => {
      const page = await openEditor(colorScheme);
      try {
        const seen = await probe(page);
        assert.deepEqual(seen.marks, [], `no reference markup shows while the caret is elsewhere: ${seen.marks.join(' | ')}`);
        assert.equal(seen.chips.length, 3, `every reference is a chip, the wrapping one too: ${JSON.stringify(seen.chips.map((c) => c.label))}`);
        for (const [words, rects] of Object.entries(seen.prose)) {
          for (const chip of seen.chips) {
            for (const r of rects) assert.ok(!overlaps(chip, r), `"${words}" never sits under the chip "${chip.label}": ${JSON.stringify({ chip, r })}`);
          }
        }
        const first = seen.chips.find((c) => c.label === LONG);
        const after = seen.prose['A route that fails'][0];
        const sameLine = Math.abs((after.top + after.bottom) / 2 - (first.top + first.bottom) / 2) < 6;
        if (sameLine) {
          const gap = after.left - first.right;
          assert.ok(gap >= 0 && gap < 16, `the prose follows the chip where the reference was, the line reflowed (gap ${gap.toFixed(1)}px)`);
        } else {
          assert.ok(after.top >= first.bottom - 1, 'or starts the next line under it');
        }
        const short = seen.chips.find((c) => c.label === 'Eye rows');
        const eye = seen.prose["The eye's rows"][0];
        assert.ok(eye.left - short.right >= 0 && eye.left - short.right < 16, `a short chip pulls its prose up beside it (gap ${(eye.left - short.right).toFixed(1)}px)`);
      } finally { await page.close(); }
    });
  }

  test('the caret inside a reference shows its markup for editing, and leaving it brings the chip back', async () => {
    const page = await openEditor('light');
    try {
      await page.evaluate(() => {
        const root = document.querySelector('.vditor-ir .vditor-reset');
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const at = n.nodeValue.indexOf('|Eye rows]]');
          if (at < 0) continue;
          root.focus();
          const range = document.createRange();
          range.setStart(n, at + 3); range.collapse(true);
          getSelection().removeAllRanges(); getSelection().addRange(range);
          return;
        }
      });
      await page.waitForFunction(() => document.querySelectorAll('.doc-ref-layer .k-rel').length === 2, null, { timeout: 10000 });
      const open = await probe(page);
      assert.equal(open.marks.length, 2, `the raw [[ and ]] return while the caret is in that reference, and only there: ${open.marks.join(' | ')}`);
      assert.ok(!open.chips.some((c) => c.label === 'Eye rows'), 'and its chip steps aside');

      await page.evaluate(() => {
        const root = document.querySelector('.vditor-ir .vditor-reset');
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let last = null;
        for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.nodeValue.includes("eye's rows")) last = n;
        const range = document.createRange();
        range.setStart(last, last.nodeValue.length); range.collapse(true);
        getSelection().removeAllRanges(); getSelection().addRange(range);
      });
      await page.waitForFunction(() => document.querySelectorAll('.doc-ref-layer .k-rel').length === 3, null, { timeout: 10000 });
      assert.deepEqual((await probe(page)).marks, [], 'leaving the reference hides its markup again');
    } finally { await page.close(); }
  });

  test('drawing the chips inline leaves the markdown untouched', async () => {
    const page = await openEditor('light');
    try {
      const value = await page.evaluate(() => window.__weaveEditors.values().next().value.getValue());
      assert.equal(value.trim(), md.trim(), 'the editor serialises the same markdown it was given');
      assert.equal(weave.getDoc(doc.id).trim(), md.trim(), 'and nothing was saved over it');
    } finally { await page.close(); }
  });
}
