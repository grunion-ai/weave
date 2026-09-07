/* Programmatic scrolling, driven through a real browser (Issue #69).

   The pure arithmetic is in test/scroll.test.mjs. What needs a browser is the
   claim the whole Issue rests on: `Element.scrollIntoView()` scrolls every
   scrollable ancestor of its target, so jumping to a heading in a docked
   document used to drag the page behind the dock along with it. Weave's own
   helper moves one box. Only a live layout — a document that overflows its
   dock, inside a table page that overflows the window — can show that.
   Playwright is NOT a dependency of weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const RAIL_DOC = '# One\n\ntext\n\n## Two\n\n' + 'filler\n\n'.repeat(60)
  + '## Three\n\n' + 'more\n\n'.repeat(30) + '### Four\n\nend\n';

let table, target;
const s = await launch('programmatic scrolling', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  table = weave.createTable({ space: 'Scratch', name: 'Note' });
  target = weave.createEntity(table, { name: 'Outlined' });
  weave.setDoc(target.id, RAIL_DOC, 'Description');
  // The page behind the dock has to have somewhere to go, or the test proves
  // nothing about leaving it alone.
  for (let i = 0; i < 60; i++) weave.createEntity(table, { name: `Row ${i}` });
});

if (s) {
  const { base, browser } = s;

  async function dockedDoc() {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto(`${base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.click(`tr[data-eid="${target.id}"] .open-link`);
    await page.waitForSelector('#dock:not([hidden])');
    await page.waitForSelector('#dock .doc-rail .doc-rail-dash', { timeout: 20000 });
    return page;
  }

  const room = (page) => page.evaluate(() => {
    const dock = document.querySelector('#dock');
    return {
      dock: dock.scrollHeight - dock.clientHeight,
      page: document.documentElement.scrollHeight - innerHeight,
    };
  });

  test('a jump inside the dock moves the dock and nothing behind it', async () => {
    const page = await dockedDoc();
    try {
      const r = await room(page);
      assert.ok(r.dock > 200, `the docked document overflows its panel (${r.dock}px of travel)`);
      assert.ok(r.page > 200, `and the table page overflows the window (${r.page}px)`);

      await page.evaluate(() => window.scrollTo(0, 300));
      await page.waitForFunction(() => window.scrollY >= 295, null, { timeout: 20000 });
      const before = await page.evaluate(() => Math.round(window.scrollY));

      // The first click anywhere on the rail opens the outline; only then
      // does a dash click jump.
      await page.evaluate(() => document.querySelector('#dock .doc-rail').click());
      await page.waitForSelector('#dock .doc-rail.open', { timeout: 20000 });
      await page.evaluate(() => document.querySelectorAll('#dock .doc-rail-dash')[1].click());

      await page.waitForFunction(() => document.querySelector('#dock').scrollTop > 100,
        null, { timeout: 20000 });
      // Let a smooth scroll finish before reading the page's own position.
      await page.waitForTimeout(700);
      const after = await page.evaluate(() => ({
        dock: document.querySelector('#dock').scrollTop,
        win: Math.round(window.scrollY),
      }));
      assert.ok(after.dock > 100, 'the dock brought the heading up');
      assert.equal(after.win, before,
        'the page behind the dock held its place — scrollIntoView would have moved it too');
    } finally { await page.close(); }
  });

  test('the heading lands on the reading line, not under the panel edge', async () => {
    const page = await dockedDoc();
    try {
      await page.evaluate(() => document.querySelector('#dock .doc-rail').click());
      await page.waitForSelector('#dock .doc-rail.open', { timeout: 20000 });
      await page.evaluate(() => document.querySelectorAll('#dock .doc-rail-dash')[1].click());
      await page.waitForFunction(() => {
        const h = [...document.querySelectorAll('#dock .vditor-ir .vditor-reset h2')]
          .find((x) => x.textContent.includes('Two'));
        const dock = document.querySelector('#dock').getBoundingClientRect();
        const gap = h.getBoundingClientRect().top - dock.top;
        return gap > 40 && gap < 140; // the 80px reading line, give or take
      }, null, { timeout: 20000 });
    } finally { await page.close(); }
  });

  test('a reader who asked for less motion gets the jump, not the glide', async () => {
    const page = await dockedDoc();
    try {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(() => document.querySelector('#dock .doc-rail').click());
      await page.waitForSelector('#dock .doc-rail.open', { timeout: 20000 });
      const landed = await page.evaluate(async () => {
        document.querySelectorAll('#dock .doc-rail-dash')[1].click();
        await new Promise((r) => requestAnimationFrame(r));
        return document.querySelector('#dock').scrollTop;
      });
      assert.ok(landed > 100,
        `reduced motion lands inside one frame instead of animating (scrollTop ${landed})`);
    } finally { await page.close(); }
  });
}
