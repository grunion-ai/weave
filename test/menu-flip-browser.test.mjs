/* The ⋮ panel stays on the page, measured in a browser (Issue #133).

   Kyle's screenshot, 2026-09-01: the document section's downloads menu opened
   past the right edge and the reader saw a sliver of "…ownloa". Reproduced
   live before the fix at a 1280px viewport — the panel's box read
   `left: 1205, right: 1383`, 178px of menu with 75px of it on screen.

   That is a claim about painted geometry, and app.js cannot be read for it:
   the source said `class: 'dl-menu'` and looked fine. Only a browser can say
   where the box landed, so this suite opens every ⋮ on a real entity page and
   measures each panel against the viewport it has to live in.

   The general assertion is the point. The Issue was not "the doc menu is
   wrong"; it was "the side is chosen where the menu is written". So the test
   opens EVERY dotsMenu the page draws, not the one that was reported, and
   fails if any of them paints outside — including at a narrow width, where
   panels that fit at 1280 stop fitting.

   Playwright is NOT a dependency of weave (zero runtime deps). The harness
   imports it dynamically and the suite skips when it is absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let doc;
const s = await launch('menu flip', (weave) => {
  weave.createSpace({ name: 'Showcase' });
  const docs = weave.createTable({ space: 'Showcase', name: 'Documents' });
  weave.addField(docs, { name: 'Summary', type: 'text' });
  weave.addField(docs, { name: 'Brief', type: 'document' });
  doc = weave.createEntity(docs, {
    name: 'Markdown — the whole surface',
    values: { Summary: 'Every mark the editor knows' },
    docs: { Brief: '# Brief\n\nThe body of the document, long enough to draw.' },
  });
});
if (s) {
  const { base, browser } = s;

  async function entityPage(width = 1280) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    // Panels animate in; a scaled frame is not the box it rests at.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${base}/#/entity/${doc.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.doc-section .doc-dl .dots-btn');
    return page;
  }

  const setTheme = (page, want) => page.evaluate((w) => {
    const btn = document.querySelector('#theme-toggle');
    for (let i = 0; i < 4 && document.documentElement.dataset.bsTheme !== w; i++) btn.click();
  }, want);

  /* Open one ⋮ by index and measure the panel it revealed. Every ⋮ shares the
     document-level "one menu at a time" close, so opening the next one closes
     the last without any bookkeeping here. */
  const openAndMeasure = (page, i) => page.evaluate(async (idx) => {
    const round = (n) => Math.round(n * 10) / 10;
    const wrap = document.querySelectorAll('.dl-wrap')[idx];
    wrap.querySelector('.dots-btn').click();
    const menu = wrap.querySelector('.dl-menu');
    await Promise.all(menu.getAnimations().map((a) => a.finished.catch(() => {})));
    const r = menu.getBoundingClientRect();
    return {
      hidden: menu.classList.contains('hidden'),
      right: round(r.right), left: round(r.left), width: round(r.width),
      flipped: menu.classList.contains('dl-menu-right'),
      clientWidth: document.documentElement.clientWidth,
      title: wrap.querySelector('.dots-btn').title,
    };
  }, i);

  const count = (page) => page.locator('.dl-wrap').count();

  /* The reported defect, as its own measurement: the doc section's downloads
     panel. Before the fix this read right: 1383 against a 1280 viewport. */
  test('the document downloads panel opens inside the page', async () => {
    const page = await entityPage(1280);
    const wraps = await page.locator('.dl-wrap').all();
    let seen = null;
    for (let i = 0; i < wraps.length; i++) {
      const m = await openAndMeasure(page, i);
      if (m.title.includes('downloads')) { seen = m; break; }
    }
    assert.ok(seen, 'the doc section draws a downloads ⋮');
    assert.ok(seen.width > 100, `the panel is drawn, not collapsed (${seen.width}px)`);
    assert.ok(seen.right <= seen.clientWidth,
      `the panel's right edge (${seen.right}) must be inside the viewport (${seen.clientWidth})`);
    assert.ok(seen.left >= 0, `and its left edge (${seen.left}) inside it too`);
    assert.equal(seen.flipped, true, 'against the right edge, it hangs off the right');
    await page.close();
  });

  test('every ⋮ on the page opens inside the page, not only the reported one', async () => {
    const page = await entityPage(1280);
    const n = await count(page);
    assert.ok(n >= 2, `the entity page draws more than one ⋮ (${n})`);
    for (let i = 0; i < n; i++) {
      const m = await openAndMeasure(page, i);
      if (m.hidden) continue;               // a menu whose ⋮ is not clickable yet
      assert.ok(m.right <= m.clientWidth && m.left >= 0,
        `panel ${i} (${m.title}) painted at ${m.left}–${m.right}, viewport ${m.clientWidth}`);
    }
    await page.close();
  });

  /* Narrow is the second half of the Issue: in a narrow pane the panel clips
     against the edge instead of the window. A width chosen where the
     left-aligned placement cannot fit. */
  test('a narrow viewport moves the panel rather than clipping it', async () => {
    const page = await entityPage(820);
    const n = await count(page);
    for (let i = 0; i < n; i++) {
      const m = await openAndMeasure(page, i);
      if (m.hidden) continue;
      assert.ok(m.right <= m.clientWidth && m.left >= 0,
        `at 820px, panel ${i} (${m.title}) painted at ${m.left}–${m.right}`);
    }
    await page.close();
  });

  /* A panel with room to its right is left where its caller put it — the flip
     is a rescue, not a new default. */
  test('a panel that fits is not moved', async () => {
    const page = await entityPage(1600);
    // Park the downloads ⋮ — a caller that asks for no alignment, so 'left' is
    // its default — at the left edge: room on both sides, nothing to rescue.
    const i = await page.evaluate(() => {
      const wraps = [...document.querySelectorAll('.dl-wrap')];
      const at = wraps.findIndex((w) => w.querySelector('.dots-btn').title.includes('downloads'));
      Object.assign(wraps[at].style, { position: 'fixed', left: '20px', top: '300px' });
      return at;
    });
    const m = await openAndMeasure(page, i);
    assert.equal(m.flipped, false, 'with 1600px of room to its right it stays left-aligned');
    assert.ok(m.right <= m.clientWidth);
    await page.close();
  });

  test('both themes place the panel the same way — geometry is not a palette', async () => {
    for (const theme of ['light', 'dark']) {
      const page = await entityPage(1280);
      await setTheme(page, theme);
      const n = await count(page);
      for (let i = 0; i < n; i++) {
        const m = await openAndMeasure(page, i);
        if (m.hidden) continue;
        assert.ok(m.right <= m.clientWidth && m.left >= 0,
          `${theme}: panel ${i} (${m.title}) painted at ${m.left}–${m.right}`);
      }
      await page.close();
    }
  });
}
