/* The chip, driven through a real browser (Kyle, 2026-09-05). The source
   gates in view-fields-ui.test.mjs pin what the chip says; this file proves
   how it draws.

   1. The retract caret faces the text (Issue #193). The expand caret points
      right, toward the segments it opens. Rotated 90° it pointed DOWN, at
      nothing — Kyle: "it should face the text it collapses back into". Open
      turns it 180°, so expand and retract read as one control folding in
      and out. Same glyph, same box, same hit area either way.

   Playwright is NOT a dependency of weave (house rule: zero runtime deps);
   it is imported dynamically and the suite skips when it is absent. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let task;

const s = await launch('chip', (weave) => {
  weave.createSpace({ name: 'Dev' });
  weave.createTable({ space: 'Dev', name: 'Task' });
  weave.addField('Task', { name: 'Owner', type: 'text' });
  weave.addField('Task', { name: 'Due', type: 'date' });
  task = weave.createEntity('Task', { name: 'Ship the editor', Owner: 'Kyle', Due: '2026-09-12' });
});
if (s) {
  const { base, browser } = s;
  const open = async (id, { colorScheme = 'light' } = {}) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'load' });
    await page.waitForSelector('.wv-appears-chip .mention-caret');
    return page;
  };
  const CARET = '.wv-appears-chip .mention-caret';
  const caretState = (page) => page.$eval(CARET, (c) => {
    const r = c.getBoundingClientRect();
    return {
      transform: getComputedStyle(c).transform,
      open: c.closest('.mention-wrap').classList.contains('open'),
      expanded: c.getAttribute('aria-expanded'),
      width: Math.round(r.width), height: Math.round(r.height),
    };
  });
  // The caret turns over a .1s transition; read it once the turn has landed.
  const settle = (page) => page.waitForTimeout(250);
  /* A 2D transform matrix(a, b, c, d, e, f): rotation θ has a = cos θ,
     b = sin θ. The browser reports it in pixels-of-matrix, not degrees. */
  const angle = (transform) => {
    if (!transform || transform === 'none') return 0;
    const [a, b] = transform.match(/matrix\(([^)]+)\)/)[1].split(',').map(Number);
    return Math.round((Math.atan2(b, a) * 180) / Math.PI);
  };

  for (const colorScheme of ['light', 'dark']) {
    test(`the retract caret faces the text: 180° from the expand caret, same box, in ${colorScheme}`, async () => {
      const page = await open(task.id, { colorScheme });
      assert.equal(await page.$eval('html', (h) => h.dataset.bsTheme), colorScheme, 'the page resolved the theme under test');
      const closed = await caretState(page);
      assert.equal(closed.open, false);
      assert.equal(closed.expanded, 'false');
      assert.equal(angle(closed.transform), 0, 'at rest the › points right, toward the segments it opens');
      await page.click(CARET);
      await settle(page);
      const opened = await caretState(page);
      assert.equal(opened.open, true, 'the click opened the segments');
      assert.equal(opened.expanded, 'true');
      assert.equal(Math.abs(angle(opened.transform)), 180,
        `open, the › turns to face the label (‹), not down — got ${opened.transform}`);
      assert.deepEqual([opened.width, opened.height], [closed.width, closed.height],
        'the same glyph in the same box: the hit area does not change with the state');
      assert.ok(await page.isVisible('.wv-appears-chip .mention-fields'), 'the segments are showing');
      await page.click(CARET);
      await settle(page);
      const again = await caretState(page);
      assert.equal(again.open, false, 'a second click folds the segments back in');
      assert.equal(angle(again.transform), 0, 'and the caret points right again');
      await page.close();
    });
  }
}
