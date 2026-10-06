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
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${base}/#/entity/${doc.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.doc-section .doc-dl .dots-btn');
    return page;
  }

  const setTheme = (page, want) => page.evaluate((w) => {
    const btn = document.querySelector('#theme-toggle');
    for (let i = 0; i < 4 && document.documentElement.dataset.bsTheme !== w; i++) btn.click();
  }, want);

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
      if (m.hidden) continue;
      assert.ok(m.right <= m.clientWidth && m.left >= 0,
        `panel ${i} (${m.title}) painted at ${m.left}–${m.right}, viewport ${m.clientWidth}`);
    }
    await page.close();
  });

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

  test('a panel that fits is not moved', async () => {
    const page = await entityPage(1600);
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
