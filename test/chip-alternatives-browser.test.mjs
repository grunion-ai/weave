/* Feature #185: the chip alternatives mockup makes one measurable claim —
   a segment inside the chip is the SAME chip it is in a grid cell, at the
   shared size, and it sits outside the link so a click on it edits instead
   of navigating. Measure it in a browser rather than trust the class names.
   Playwright is imported by the shared harness and the suite skips without it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from './lib/browser.mjs';
import { ROOT } from './lib/source.mjs';

if (!chromium) {
  test('chip anatomy alternatives (browser)', { skip: 'playwright not installed' }, () => {});
} else {
  const browser = await chromium.launch();
  test.after(async () => { await browser.close(); });

  test('in every option the segments are live chips at the relation chip’s own size, outside the link, and the ↗ is gone', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    await page.goto(pathToFileURL(join(ROOT, 'docs/mockups/chip-anatomy-alternatives.html')).href, { waitUntil: 'load' });
    const seen = await page.evaluate(() => [...document.querySelectorAll('section.opt')].map((s) => {
      const panel = s.querySelector('.panel[data-surface="cell"][data-bs-theme="light"]');
      const rel = panel.querySelector('.k-rel');
      const a = panel.querySelector('.k-rel a');
      const segs = [...panel.querySelectorAll('.wv-live > .k')];
      const dark = s.querySelector('.panel[data-surface="cell"][data-bs-theme="dark"] .k-rel a');
      return {
        key: s.id,
        chipFont: getComputedStyle(rel).fontSize,
        segFonts: segs.map((k) => getComputedStyle(k).fontSize),
        segLines: segs.map((k) => getComputedStyle(k).lineHeight),
        segInsideLink: segs.some((k) => a.contains(k)),
        after: getComputedStyle(a, '::after').content,
        linkOutline: getComputedStyle(panel.querySelector('.hit-link')).outlineStyle,
        segOutline: segs.length ? getComputedStyle(segs[0]).outlineStyle : null,
        light: getComputedStyle(a).color,
        dark: getComputedStyle(dark).color,
      };
    }));
    assert.equal(seen.length, 5, 'five options');
    for (const o of seen) {
      assert.equal(o.chipFont, '13px', `${o.key}: the relation chip is at the token size`);
      assert.ok(o.segFonts.length >= 1, `${o.key}: at least one live segment in the cell`);
      for (const f of o.segFonts) assert.equal(f, o.chipFont, `${o.key}: a segment is the size of the chip it sits in (not .82em)`);
      for (const l of o.segLines) assert.equal(l, '22px', `${o.key}: a segment has the shared chip line`);
      assert.equal(o.segInsideLink, false, `${o.key}: the segments sit outside the anchor, so a click edits and never navigates`);
      assert.equal(o.after, 'none', `${o.key}: no ↗ — the chip is the link`);
      assert.equal(o.linkOutline, 'solid', `${o.key}: the link hitbox is the solid outline`);
      assert.equal(o.segOutline, 'dashed', `${o.key}: a segment hitbox is a dashed outline`);
      assert.notEqual(o.light, o.dark, `${o.key}: the two panels are the two themes`);
    }
    await page.close();
  });
}
