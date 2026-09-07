/* The header description clamps to five lines (Feature #186, Kyle,
   2026-09-07): a long glossary under a table title was pushing the grid a
   full screen down. The rendered markdown shows its first five lines; when
   more is hidden a `Show more` control sits under it and toggles to
   `Show less`. Short descriptions carry no control, and the control never
   opens the editor — a click on the prose still does. One viewHeader serves
   table, space and workspace pages, so the same probe runs on each. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const LONG = Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of a long description.`).join('\n\n');
const SHORT = 'One line only.';

const s = await launch('view-desc-clamp', (weave) => {
  const longSpace = weave.createSpace({ name: 'Long', description: LONG });
  const longTable = weave.createTable({ space: 'Long', name: 'Glossary', description: LONG });
  const shortTable = weave.createTable({ space: 'Long', name: 'Terse', description: SHORT });
  weave.updateWorkspace({ description: LONG });
  return { longSpace, longTable, shortTable };
});

if (s) {
  const { base, browser, longSpace, longTable, shortTable } = s;

  async function open(hash) {
    const page = await browser.newPage();
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.view-desc .view-desc-body');
    return page;
  }

  const probe = (page) => page.evaluate(() => {
    const desc = document.querySelector('.view-desc');
    const body = desc.querySelector('.view-desc-body');
    const more = desc.querySelector('.view-desc-more');
    const lh = parseFloat(getComputedStyle(desc).lineHeight);
    return {
      clamped: body.classList.contains('clamped'),
      shown: body.clientHeight,
      full: body.scrollHeight,
      lineHeight: lh,
      more: more ? more.textContent.trim() : null,
      editing: !!desc.querySelector('.view-desc-edit'),
    };
  });

  for (const [label, hash] of [
    ['a table page', () => `#/table/${longTable.id}`],
    ['a space page', () => `#/space/${longSpace.id}`],
    ['the workspace page', () => ''],
  ]) {
    test(`${label}: a long description shows five lines and a Show more control`, async () => {
      const page = await open(hash());
      try {
        const r = await probe(page);
        assert.ok(r.clamped, 'the body wears the clamp');
        assert.ok(r.full > r.shown, `there is hidden text (${r.shown} of ${r.full}px shown)`);
        assert.ok(r.shown <= r.lineHeight * 5 + 1, `shows at most five lines: ${r.shown}px at ${r.lineHeight}px/line`);
        assert.ok(r.shown >= r.lineHeight * 4, `shows about five lines, not fewer: ${r.shown}px`);
        assert.equal(r.more, 'Show more');
      } finally { await page.close(); }
    });
  }

  test('Show more reveals the whole description and becomes Show less; a second click folds it back', async () => {
    const page = await open(`#/table/${longTable.id}`);
    try {
      await page.click('.view-desc-more');
      let r = await probe(page);
      assert.equal(r.clamped, false, 'the clamp is off');
      assert.equal(r.shown, r.full, 'nothing is hidden');
      assert.equal(r.more, 'Show less');
      assert.equal(r.editing, false, 'the control did not open the editor');
      await page.click('.view-desc-more');
      r = await probe(page);
      assert.ok(r.clamped, 'folded back');
      assert.equal(r.more, 'Show more');
      assert.equal(r.editing, false);
    } finally { await page.close(); }
  });

  test('the prose still opens the editor on click', async () => {
    const page = await open(`#/table/${longTable.id}`);
    try {
      await page.click('.view-desc .view-desc-body p');
      await page.waitForSelector('.view-desc-edit');
      const v = await page.$eval('.view-desc-edit', (ta) => ta.value);
      assert.equal(v, LONG, 'the editor carries the full markdown');
    } finally { await page.close(); }
  });

  test('a short description carries no control and no clamp', async () => {
    const page = await open(`#/table/${shortTable.id}`);
    try {
      const r = await probe(page);
      assert.equal(r.more, null, 'no Show more');
      assert.equal(r.clamped, false, 'a body that fits is not clamped');
      assert.equal(r.shown, r.full);
    } finally { await page.close(); }
  });
}
