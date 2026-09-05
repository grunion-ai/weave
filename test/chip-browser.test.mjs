/* The chip, driven through a real browser (Kyle, 2026-09-05). The source
   gates in view-fields-ui.test.mjs pin what the chip says; this file proves
   how it draws.

   1. The retract caret faces the text (Issue #193). The expand caret points
      right, toward the segments it opens. Rotated 90° it pointed DOWN, at
      nothing — Kyle: "it should face the text it collapses back into". Open
      turns it 180°, so expand and retract read as one control folding in
      and out. Same glyph, same box, same hit area either way.
   2. One chip size, decided once (Issue #194). Kyle: "Default chip view is
      likely too small." The label sat at 11.5px under 14px body text with a
      ~21px box. The size is now two tokens on :root — --wv-chip-font (one
      step below body) and --wv-chip-line — and every chip surface reads
      them, so a state cell, a relation cell, the Appears-as strip and the
      filter row measure the same: label >= 13px, box >= 24px tall.

   Playwright is NOT a dependency of weave (house rule: zero runtime deps);
   it is imported dynamically and the suite skips when it is absent. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let task, tasks;

const s = await launch('chip', (weave) => {
  weave.createSpace({ name: 'Dev' });
  tasks = weave.createTable({ space: 'Dev', name: 'Task' });
  weave.createTable({ space: 'Dev', name: 'Person' });
  weave.addField(tasks, {
    name: 'State', type: 'workflow',
    config: { states: [{ name: 'Open', category: 'not-started', default: true }, { name: 'Doing', category: 'in-progress' }, { name: 'Done', category: 'done' }] },
  });
  weave.addField(tasks, { name: 'Severity', type: 'select', config: { options: ['Low', 'High'] } });
  weave.addField(tasks, { name: 'Due', type: 'date' });
  weave.addRelation(tasks, { name: 'Owner', targetDb: 'Person', cardinality: 'many-to-one' });
  const ada = weave.createEntity('Person', { name: 'Ada' });
  task = weave.createEntity('Task', { name: 'Ship the editor', Severity: 'High', Due: '2026-09-12' });
  weave.setState(task.id, 'State', 'Doing');
  weave.link(task.id, 'Owner', [ada.id]);
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

  /* ---------- #194: one size, from the tokens ---------- */
  const measure = (page, sel) => page.$eval(sel, (n) => {
    const r = n.getBoundingClientRect();
    const cs = getComputedStyle(n);
    return { height: Math.round(r.height), fontSize: cs.fontSize, radius: cs.borderTopLeftRadius, background: cs.backgroundColor };
  });
  const tokens = (page) => page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return { font: cs.getPropertyValue('--wv-chip-font').trim(), line: cs.getPropertyValue('--wv-chip-line').trim() };
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`every chip surface draws at the shared size — label >= 13px, box >= 24px — in ${colorScheme}`, async () => {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
      await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'load' });
      await page.waitForSelector('.wv-grid td .k-state');
      const tok = await tokens(page);
      assert.match(tok.font, /^\d+(\.\d+)?px$/, 'the size is a token on :root, --wv-chip-font');
      assert.match(tok.line, /^\d+(\.\d+)?px$/, 'and so is the line, --wv-chip-line');
      const body = await page.$eval('body', (b) => parseFloat(getComputedStyle(b).fontSize));
      const font = parseFloat(tok.font);
      assert.ok(font >= 13 && font <= body, `the label is body size or one step below: got ${tok.font} under a ${body}px body`);
      const surfaces = {
        'a state cell': '.wv-grid td .k-state',
        'a select cell': '.wv-grid td .k-select',
        'a relation cell': '.wv-grid td .k-rel',
      };
      for (const [what, sel] of Object.entries(surfaces)) {
        const m = await measure(page, sel);
        assert.equal(m.fontSize, tok.font, `${what} reads the token, not its own number`);
        assert.ok(m.height >= 24, `${what} is a comfortable hit target: ${m.height}px, want >= 24`);
        assert.equal(m.radius, '4px', `${what} keeps the 4px corner`);
      }
      assert.equal((await measure(page, '.wv-grid td .k-rel')).background, 'rgba(0, 0, 0, 0)', 'still no fill behind a pointer chip');
      // The entity page's own preview and the reference chip share the size.
      await page.goto(`${base}/#/entity/${task.id}`, { waitUntil: 'load' });
      await page.waitForSelector('.wv-appears-chip .k-rel');
      const appears = await measure(page, '.wv-appears-chip .k-rel');
      assert.equal(appears.fontSize, tok.font, 'the Appears-as chip reads the token');
      assert.ok(appears.height >= 24, `the Appears-as chip is >= 24px tall, got ${appears.height}`);
      await page.close();
    });
  }
}
