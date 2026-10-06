import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, styleOf } from './lib/browser.mjs';

const para = (word, n) => Array.from({ length: n }, (_, i) => `${word} paragraph ${i + 1} with enough words to read as prose.`).join('\n\n');
const ROWS = 2000;

const s = await launch('pane scroll shell', (weave) => {
  for (const space of ['Sales', 'Product', 'Ops', 'Finance']) {
    weave.createSpace({ name: space });
    for (let i = 0; i < 14; i++) weave.createTable({ space, name: `${space} table ${i + 1}` });
  }
  const big = weave.createTable({ space: 'Sales', name: 'Ledger' });
  let first = null;
  for (let i = 0; i < ROWS; i++) {
    const e = weave.createEntity(big, { name: `Row ${String(i + 1).padStart(4, '0')}` });
    first ??= e;
  }
  weave.setDoc(first.id, para('Ledger', 80));
  return { big, first };
});

if (s) {
  const { base, browser, big, first } = s;

  const open = async (hash, { width = 1440, height = 900, theme = 'light', dockWidth = null, ready = '#main .wv-grid tbody tr[data-i]' } = {}) => {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    if (dockWidth) await page.addInitScript((w) => localStorage.setItem('wv-dock-width', w), String(dockWidth));
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(ready);
    await page.waitForTimeout(300);
    return page;
  };
  const tops = (page) => page.evaluate(() => {
    const top = (q) => {
      const n = document.querySelector(q);
      if (!n) return null;
      return [...n.querySelectorAll('.table-wrap')].reduce((t, w) => t + w.scrollTop, n.scrollTop);
    };
    return { doc: document.scrollingElement.scrollTop, rail: top('#ws-rail'), sidebar: top('#sidebar'), main: top('#main'), dock: top('#dock') };
  });
  const centreOf = (page, q) => page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, q);
  const wheelOver = async (page, q, dy = 600) => {
    const { x, y } = await centreOf(page, q);
    await page.mouse.move(x, y);
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(350);
  };
  const onlyMoved = (before, after, pane) => {
    assert.equal(after.doc, 0, `the document never scrolls (wheel over ${pane}): ${JSON.stringify(after)}`);
    assert.ok(after[pane] > before[pane] + 50, `a wheel over ${pane} scrolls ${pane}: ${before[pane]} -> ${after[pane]}`);
    for (const other of ['rail', 'sidebar', 'main', 'dock']) {
      if (other === pane) continue;
      assert.equal(after[other], before[other], `a wheel over ${pane} leaves ${other} where it was: ${JSON.stringify({ before, after })}`);
    }
  };

  for (const theme of ['light', 'dark']) {
    test(`${theme}: a wheel over the nav, the main panel and the dock moves that pane alone`, async () => {
      const page = await open(`#/table/${big.id}?e=${first.id}`, { theme, width: 1600, dockWidth: 380 });
      await page.waitForSelector('#dock:not([hidden]) .name-edit');
      await page.waitForTimeout(300);
      assert.ok(await page.locator('#main .table-wrap.wv-fit').count(), 'the grid fits its panel, so the panel is the box that scrolls');
      const room = await page.evaluate(() => Object.fromEntries(['#sidebar', '#main', '#dock'].map((q) => {
        const n = document.querySelector(q);
        const boxes = [n, ...n.querySelectorAll('.table-wrap')];
        return [q, Math.max(...boxes.map((b) => b.scrollHeight - b.clientHeight))];
      })));
      for (const [q, spare] of Object.entries(room)) assert.ok(spare > 300, `${q} has more content than room, so it must scroll: ${spare}`);

      for (const pane of ['sidebar', 'main', 'dock']) {
        const before = await tops(page);
        await wheelOver(page, `#${pane}`);
        onlyMoved(before, await tops(page), pane);
      }
      const frame = await page.evaluate(() => ['#ws-rail', '#sidebar', '#main', '#dock'].map((q) => Math.round(document.querySelector(q).getBoundingClientRect().top)));
      assert.deepEqual(frame, [0, 0, 8, 8], `rail and nav at the window top, the panels 8px under it: ${frame}`);
      await page.close();
    });
  }

  test('scroll chaining stops at each pane edge: a wheel past the bottom of the dock does not move the main panel', async () => {
    const page = await open(`#/table/${big.id}?e=${first.id}`, { width: 1600, dockWidth: 380 });
    await page.waitForSelector('#dock:not([hidden]) .name-edit');
    assert.ok(await page.locator('#main .table-wrap.wv-fit').count(), 'the panel beside the dock has room to scroll');
    await page.evaluate(() => { const d = document.querySelector('#dock'); d.scrollTo({ top: d.scrollHeight, behavior: 'instant' }); });
    const before = await tops(page);
    await wheelOver(page, '#dock', 800);
    const after = await tops(page);
    assert.equal(after.main, before.main, 'the main panel did not take the leftover wheel');
    assert.equal(after.doc, 0);
    await page.close();
  });

  test('scroll chaining stops at the nav edge: a wheel past the bottom of the left nav moves nothing (Issue #451)', async () => {
    const page = await open(`#/table/${big.id}`, { width: 1470, height: 794 });
    const spare = await page.evaluate(() => { const n = document.querySelector('#sidebar'); return n.scrollHeight - n.clientHeight; });
    assert.ok(spare > 300, `the nav has more content than room, so it can run out: ${spare}`);
    await page.evaluate(() => { const n = document.querySelector('#sidebar'); n.scrollTo({ top: n.scrollHeight, behavior: 'instant' }); });
    const before = await tops(page);
    assert.ok(before.sidebar >= spare - 1, `the nav starts at its end: ${before.sidebar} of ${spare}`);
    await wheelOver(page, '#sidebar', 800);
    const after = await tops(page);
    assert.equal(after.doc, 0, `the document did not take the leftover wheel: ${JSON.stringify(after)}`);
    assert.equal(after.main, before.main, 'the main panel did not take the leftover wheel');
    assert.equal(after.rail, before.rail, 'the workspace rail did not take it either');
    assert.ok(after.sidebar >= before.sidebar - 1, 'the nav stays at its end');
    const chain = () => styleOf(page.locator('#sidebar'), 'overscrollBehaviorY', 'contain');
    assert.equal(await chain(), 'contain', 'the in-flow nav contains its chain');
    await page.evaluate(() => document.querySelector('#app').classList.add('nav-collapsed', 'nav-peek'));
    assert.equal(await chain(), 'contain', 'the nav-peek overlay contains its chain');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await chain(), 'contain', 'the phone drawer contains its chain');
    await page.close();
  });

  for (const theme of ['light', 'dark']) {
    test(`${theme}: + New space holds the sidebar's bottom edge however far the nav scrolls (Issue #452)`, async () => {
      const page = await open(`#/table/${big.id}`, { theme, width: 1470, height: 794 });
      const spare = await page.evaluate(() => { const n = document.querySelector('#sidebar'); return n.scrollHeight - n.clientHeight; });
      assert.ok(spare > 300, `the nav has more content than room, so an unpinned foot would scroll away: ${spare}`);
      const seen = (q) => page.evaluate((sel) => {
        const n = document.querySelector('#sidebar');
        const box = n.getBoundingClientRect();
        const r = document.querySelector(sel)?.getBoundingClientRect();
        return r && { top: r.top, bottom: r.bottom, within: r.top >= box.top - 1 && r.bottom <= box.bottom + 1, scroll: n.scrollTop };
      }, q);
      const btn = '#sidebar .nav-foot button';
      const atTop = await seen(btn);
      assert.ok(atTop?.within, `+ New space is in the sidebar's window with the nav unscrolled: ${JSON.stringify(atTop)}`);
      await page.evaluate(() => { const n = document.querySelector('#sidebar'); n.scrollTo({ top: n.scrollHeight, behavior: 'instant' }); });
      await page.waitForTimeout(150);
      const atEnd = await seen(btn);
      assert.ok(atEnd.scroll >= spare - 1, `the nav is at its end: ${atEnd.scroll} of ${spare}`);
      assert.ok(atEnd.within, `+ New space is still in the sidebar's window at the nav's end: ${JSON.stringify(atEnd)}`);
      assert.ok(Math.abs(atEnd.top - atTop.top) <= 20, `the button held its place while the nav ran ${spare}px: ${atTop.top} -> ${atEnd.top}`);
      const order = await page.evaluate(() => [...document.querySelectorAll('#sidebar .nav-stats > *')].map((n) => n.className.split(' ')[0]));
      assert.deepEqual(order.slice(0, 2), ['nav-foot', 'nav-stats-line'], `the button leads the strip, the records line follows: ${order}`);
      await page.click(btn);
      await page.waitForTimeout(150);
      const input = await seen('.nav-inline-add');
      assert.ok(input?.within, `the new-space name input is in the sidebar's window: ${JSON.stringify(input)}`);
      assert.ok(await page.evaluate(() => !!document.querySelector('.nav-inline-add')?.closest('.nav-stats')), 'the name input opens inside the pinned strip');
      await page.close();
    });
  }

  test(`the ${ROWS}-row grid still paints rows as the main panel scrolls to its bottom`, async () => {
    const page = await open(`#/table/${big.id}`);
    const firstPaint = await page.evaluate(() => Math.max(...[...document.querySelectorAll('#main .wv-grid tbody tr.entity-row[data-i]')].map((tr) => Number(tr.dataset.i))));
    assert.ok(firstPaint < 1000, `the first paint is a window, not the whole table: ${firstPaint}`);
    for (let k = 0; k < 40; k++) {
      const done = await page.evaluate((last) => {
        const m = document.querySelector('#main');
        m.scrollTo({ top: m.scrollHeight, behavior: 'instant' });
        return !!document.querySelector(`#main .wv-grid tbody tr.entity-row[data-i="${last}"]`);
      }, ROWS - 1);
      if (done) break;
      await page.waitForTimeout(150);
    }
    const end = await page.evaluate((last) => ({
      doc: document.scrollingElement.scrollTop,
      main: document.querySelector('#main').scrollTop,
      last: [...(document.querySelector(`#main .wv-grid tbody tr.entity-row[data-i="${last}"]`)?.querySelectorAll('input, textarea') ?? [])].map((n) => n.value).join(' '),
    }), ROWS - 1);
    assert.equal(end.doc, 0, 'the document never scrolled');
    assert.ok(end.main > 1000, `the main panel scrolled: ${end.main}`);
    assert.match(end.last ?? '', /Row 2000/, 'the last row is painted at the bottom');
    await page.close();
  });

  test('phone 390x844: the main panel, the full-screen dock and the nav drawer each scroll alone', async () => {
    let page = await open(`#/entity/${first.id}`, { width: 390, height: 844, ready: '#main .doc-section .vditor-reset p' });
    let before = await tops(page);
    await wheelOver(page, '#main');
    let after = await tops(page);
    assert.equal(after.doc, 0, 'the document never scrolls on a phone');
    assert.ok(after.main > before.main + 50, `the main panel scrolls: ${before.main} -> ${after.main}`);

    await page.click('#main .nav-menu');
    await page.waitForTimeout(250);
    before = await tops(page);
    await wheelOver(page, '#sidebar');
    after = await tops(page);
    assert.equal(after.doc, 0);
    assert.ok(after.sidebar > before.sidebar + 50, `the drawer nav scrolls: ${before.sidebar} -> ${after.sidebar}`);
    assert.equal(after.main, before.main, 'the page under the drawer holds');
    await page.close();

    page = await open(`#/table/${big.id}?e=${first.id}`, { width: 390, height: 844 });
    await page.waitForSelector('#dock:not([hidden]) .name-edit');
    await page.waitForTimeout(300);
    const sheet = await page.evaluate(() => { const r = document.querySelector('#dock').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
    assert.deepEqual(sheet.map(Math.round), [0, 0, 390, 844], `the phone dock covers the screen: ${sheet}`);
    before = await tops(page);
    await wheelOver(page, '#dock');
    after = await tops(page);
    assert.equal(after.doc, 0);
    assert.ok(after.dock > before.dock + 50, `the sheet scrolls: ${before.dock} -> ${after.dock}`);
    assert.equal(after.main, before.main, 'the table under the sheet holds');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390, 'no sideways scroll');
    await page.close();
  });
}
