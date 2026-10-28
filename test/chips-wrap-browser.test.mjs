import test from 'node:test';
import assert from 'node:assert/strict';
import { atRest, launch, engineOf, painted, phoneProfile } from './lib/browser.mjs';
import { CELLS, fingerprint, seed, sweepCell } from './lib/cutoff.mjs';
import { ROUTES, STATES } from './lib/states.mjs';

const LEAD = /\.phone-lead/;
const CHIP = /\.k-rel|\.k-multi|\.k-select|\.k-state|\.computed\.k|\.mention-caret/;
const WRAPPED = {
  desktop: ['board-view', 'sink-board', 'sink-row'],
  phone: ['board-view', 'sink-row'],
};
const stateOf = (name) => STATES.find((x) => x.name === name);

const s = await launch('chips wrap inside tiles and field rows', seed);

if (s) {
  const handset = await engineOf(CELLS.phone.engine);
  const matrix = {
    desktop: { browser: s.browser, page: { viewport: CELLS.desktop.viewport } },
    phone: handset && { browser: handset, page: { ...phoneProfile().page, viewport: CELLS.phone.viewport } },
  };

  for (const cell of Object.keys(WRAPPED)) {
    test(`${cell}: chips in board tiles and field rows show their whole label (Issues #1124, #1125, #1151, #1152, #1154)`, async (t) => {
      const m = matrix[cell];
      if (!m) return t.skip(`${CELLS[cell].engine} cannot launch here`);
      const rests = WRAPPED[cell].map(stateOf);
      const { findings, failed } = await sweepCell(m.browser, cell, s, { page: m.page, journeys: [], overlays: [], rests });
      assert.deepEqual(failed, [], 'a state could not open: its selectors rotted');
      const chips = findings.filter((f) => CHIP.test(f.selector) && !LEAD.test(f.selector)).map((f) => `${f.where} ${fingerprint(f, f.cell)} ${JSON.stringify(f.text)} ${f.px}px`);
      assert.deepEqual(chips, [], 'a chip inside a tile field or a field row still cuts its label');
    });
  }

  test('desktop: the board tile relation chip wraps its label and keeps the caret whole (Issue #1124)', async () => {
    const page = await s.browser.newPage(matrix.desktop.page);
    try {
      await page.goto(ROUTES.board.url(s));
      await painted(page, ROUTES.board.ready());
      const chip = page.locator('.tile-field dd .k-rel').filter({ hasText: 'long enough to wrap' }).first();
      await atRest(chip);
      const got = await chip.evaluate((k) => {
        const dd = k.closest('dd').getBoundingClientRect();
        const label = k.querySelector('.k-label');
        const caret = k.querySelector('.mention-caret').getBoundingClientRect();
        const cs = getComputedStyle(label);
        return {
          height: label.getBoundingClientRect().height,
          line: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2,
          sideways: label.scrollWidth - label.clientWidth,
          below: label.scrollHeight - label.clientHeight,
          clamp: cs.webkitLineClamp,
          caretIn: caret.right <= dd.right + 0.5 && caret.left >= dd.left - 0.5,
        };
      });
      assert.ok(got.height > got.line * 1.5, `the label grows past one line (${got.height}px tall at a ${got.line}px line)`);
      assert.ok(got.sideways <= 1, `the whole label fits its width, no ellipsis (${got.sideways}px hidden sideways)`);
      assert.ok(got.below <= 1, `no line of the label is hidden (${got.below}px hidden below)`);
      assert.equal(got.clamp, 'none', 'no line clamp hides part of the label');
      assert.ok(got.caretIn, 'the caret sits inside the tile field');
    } finally { await page.close(); }
  });
}
