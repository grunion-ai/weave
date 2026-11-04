import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, engineOf, styleOf, settled, PHONE, phoneBrowser, phonePage, phoneProfile, touchScroll } from './lib/browser.mjs';
import { barsOnEngine } from './lib/bars-engine.mjs';
import { decodePng } from './lib/png.mjs';

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
  const wide = weave.createTable({ space: 'Sales', name: 'Wide' });
  for (let i = 0; i < 24; i++) weave.addField(wide, { name: `Column ${i + 1}`, type: 'text' });
  for (let i = 0; i < 80; i++) weave.createEntity(wide, { name: `Wide row ${i + 1}` });
  const short = weave.createTable({ space: 'Sales', name: 'Short' });
  weave.createEntity(short, { name: 'Only row' });
  return { big, first, wide, short };
});

if (s) {
  const { base, browser, big, first, wide, short } = s;

  const open = async (hash, { width = 1440, height = 900, theme = 'light', dockWidth = null, ready = '#main .wv-grid tbody tr[data-i]', phone = false, engine = browser } = {}) => {
    const page = phone ? await phonePage(await phoneBrowser()) : await engine.newPage({ viewport: { width, height } });
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
    return { doc: document.scrollingElement.scrollTop, rail: top('#ws-rail'), sidebar: top('#sidebar'), nav: top('#nav'), main: top('#main'), dock: top('#dock') };
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
  const swipeOver = async (page, q, dy = 600) => touchScroll(page, await centreOf(page, q), dy);
  const onlyMoved = (before, after, pane) => {
    assert.equal(after.doc, 0, `the document never scrolls (wheel over ${pane}): ${JSON.stringify(after)}`);
    assert.ok(after[pane] > before[pane] + 50, `a wheel over ${pane} scrolls ${pane}: ${before[pane]} -> ${after[pane]}`);
    for (const other of ['rail', 'sidebar', 'nav', 'main', 'dock']) {
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
      const room = await page.evaluate(() => Object.fromEntries(['#nav', '#main', '#dock'].map((q) => {
        const n = document.querySelector(q);
        const boxes = [n, ...n.querySelectorAll('.table-wrap')];
        return [q, Math.max(...boxes.map((b) => b.scrollHeight - b.clientHeight))];
      })));
      for (const [q, spare] of Object.entries(room)) assert.ok(spare > 300, `${q} has more content than room, so it must scroll: ${spare}`);

      for (const pane of ['nav', 'main', 'dock']) {
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
    const spare = await page.evaluate(() => { const n = document.querySelector('#nav'); return n.scrollHeight - n.clientHeight; });
    assert.ok(spare > 300, `the nav has more content than room, so it can run out: ${spare}`);
    await page.evaluate(() => { const n = document.querySelector('#nav'); n.scrollTo({ top: n.scrollHeight, behavior: 'instant' }); });
    const before = await tops(page);
    assert.ok(before.nav >= spare - 1, `the nav starts at its end: ${before.nav} of ${spare}`);
    await wheelOver(page, '#nav', 800);
    const after = await tops(page);
    assert.equal(after.doc, 0, `the document did not take the leftover wheel: ${JSON.stringify(after)}`);
    assert.equal(after.main, before.main, 'the main panel did not take the leftover wheel');
    assert.equal(after.rail, before.rail, 'the workspace rail did not take it either');
    assert.equal(after.sidebar, 0, 'the sidebar around the list did not take it');
    assert.ok(after.nav >= before.nav - 1, 'the nav stays at its end');
    const chain = () => styleOf(page.locator('#nav'), 'overscrollBehaviorY', 'contain');
    assert.equal(await chain(), 'contain', 'the in-flow nav contains its chain');
    await page.evaluate(() => document.querySelector('#app').classList.add('nav-collapsed', 'nav-peek'));
    assert.equal(await chain(), 'contain', 'the nav-peek overlay contains its chain');
    await page.setViewportSize(phoneProfile().page.viewport);
    assert.equal(await chain(), 'contain', 'the phone drawer contains its chain');
    await page.close();
  });

  for (const theme of ['light', 'dark']) {
    test(`${theme}: + New space holds the sidebar's bottom edge however far the nav scrolls (Issue #452)`, async () => {
      const page = await open(`#/table/${big.id}`, { theme, width: 1470, height: 794 });
      const spare = await page.evaluate(() => { const n = document.querySelector('#nav'); return n.scrollHeight - n.clientHeight; });
      assert.ok(spare > 300, `the nav has more content than room, so an unpinned foot would scroll away: ${spare}`);
      const seen = (q) => page.evaluate((sel) => {
        const box = document.querySelector('#sidebar').getBoundingClientRect();
        const r = document.querySelector(sel)?.getBoundingClientRect();
        return r && { top: r.top, bottom: r.bottom, within: r.top >= box.top - 1 && r.bottom <= box.bottom + 1, scroll: document.querySelector('#nav').scrollTop };
      }, q);
      const btn = '#sidebar .nav-foot button';
      const atTop = await seen(btn);
      assert.ok(atTop?.within, `+ New space is in the sidebar's window with the nav unscrolled: ${JSON.stringify(atTop)}`);
      await page.evaluate(() => { const n = document.querySelector('#nav'); n.scrollTo({ top: n.scrollHeight, behavior: 'instant' }); });
      await page.waitForTimeout(150);
      const atEnd = await seen(btn);
      assert.ok(atEnd.scroll >= spare - 1, `the nav is at its end: ${atEnd.scroll} of ${spare}`);
      assert.ok(atEnd.within, `+ New space is still in the sidebar's window at the nav's end: ${JSON.stringify(atEnd)}`);
      assert.ok(Math.abs(atEnd.top - atTop.top) <= 20, `the button held its place while the nav ran ${spare}px: ${atTop.top} -> ${atEnd.top}`);
      const order = await page.evaluate(() => [...document.querySelectorAll('#sidebar .nav-pinned > *')].filter((n) => !n.hidden).map((n) => n.className.split(' ')[0]));
      assert.deepEqual(order, ['nav-foot', 'nav-system', 'nav-identity'], `the button leads the strip, the System space follows, the identity panel last (Issue #854, Feature #333): ${order}`);
      await page.click(btn);
      await page.waitForTimeout(150);
      const input = await seen('.nav-inline-add');
      assert.ok(input?.within, `the new-space name input is in the sidebar's window: ${JSON.stringify(input)}`);
      assert.ok(await page.evaluate(() => !!document.querySelector('.nav-inline-add')?.closest('.nav-pinned')), 'the name input opens inside the pinned strip');
      await page.close();
    });
  }

  for (const theme of ['light', 'dark']) {
    test(`${theme}: WebKit reserves at most 8px for the nav, main panel and dock bars, never Tabler's 16px (Issue #956)`, async () => {
      const webkit = await engineOf('webkit');
      assert.ok(webkit, 'WebKit is installed, so the Safari bar is measured');
      const page = await open(`#/table/${big.id}?e=${first.id}`, { theme, width: 1600, dockWidth: 380, engine: webkit });
      await page.waitForSelector('#dock:not([hidden]) .name-edit');
      await page.locator('#dock .doc-section .vditor-reset p').filter({ hasText: 'Ledger paragraph 80 ' }).waitFor();
      await settled(page.locator('#dock'));
      const bars = await page.evaluate(() => Object.fromEntries(['#nav', '#main', '#dock'].map((q) => {
        const n = document.querySelector(q);
        const cs = getComputedStyle(n);
        return [q, { bar: n.offsetWidth - n.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth), spare: n.scrollHeight - n.clientHeight }];
      })));
      for (const [q, m] of Object.entries(bars)) {
        assert.ok(m.spare > 100, `${q} overflows, so it draws a bar: ${JSON.stringify(bars)}`);
        assert.ok(m.bar <= 8, `${q} reserves ${m.bar}px for its bar, wanted at most 8: ${JSON.stringify(bars)}`);
      }
      await page.close();
    });
  }

  const barOf = (page, q) => page.evaluate((sel) => {
    const n = document.querySelector(sel);
    const cs = getComputedStyle(n);
    return {
      v: n.offsetWidth - n.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth),
      h: n.offsetHeight - n.clientHeight - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth),
      spareV: n.scrollHeight - n.clientHeight,
      spareH: n.scrollWidth - n.clientWidth,
      radius: parseFloat(cs.borderTopRightRadius) || parseFloat(cs.borderBottomRightRadius) || 0,
    };
  }, q);
  const stripOf = async (page, q, axis) => {
    await page.evaluate(() => document.querySelector('.bug-fab')?.style.setProperty('display', 'none'));
    const box = await page.locator(q).boundingBox();
    const clip = axis === 'v' ? { x: box.x + box.width - 8, y: box.y, width: 8, height: box.height } : { x: box.x, y: box.y + box.height - 8, width: box.width, height: 8 };
    return decodePng(await page.screenshot({ clip, animations: 'disabled' }));
  };
  const longestRun = (length, inked) => {
    let best = null;
    let start = -1;
    for (let i = 0; i <= length; i++) {
      if (i < length && inked(i)) { if (start < 0) start = i; continue; }
      if (start >= 0 && i - start > (best?.length ?? 0)) best = { start, length: i - start };
      start = -1;
    }
    return best;
  };
  const scrollPane = async (page, q, top, left = 0) => {
    await page.evaluate(([sel, t, l]) => document.querySelector(sel).scrollTo({ top: t < 0 ? 1e9 : t, left: l < 0 ? 1e9 : l, behavior: 'instant' }), [q, top, left]);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  };
  const thumbGaps = async (page, q, axis) => {
    const img = await stripOf(page, q, axis);
    const v = axis === 'v';
    const length = v ? img.height : img.width;
    const ground = v ? img.at(img.width - 1, Math.floor(img.height / 2)) : img.at(Math.floor(img.width / 2), img.height - 1);
    const run = longestRun(length, (i) => {
      const p = v ? img.at(img.width - 4, i) : img.at(i, img.height - 4);
      return p.some((c, k) => Math.abs(c - ground[k]) > 2);
    });
    return run && { before: run.start, after: length - run.start - run.length, length: run.length };
  };

  for (const name of ['chromium', 'webkit']) {
    for (const theme of ['light', 'dark']) {
      test(`${name} ${theme}: every pane reserves one 8px bar and its ends clear the rounded corners (Issue #1310)`, async () => {
        const engine = await barsOnEngine(name);
        assert.ok(engine, `${name} is installed`);
        const page = await open(`#/table/${big.id}?e=${first.id}`, { theme, width: 1600, dockWidth: 380, engine });
        await page.waitForSelector('#dock:not([hidden]) .name-edit');
        await page.locator('#dock .doc-section .vditor-reset p').filter({ hasText: 'Ledger paragraph 80 ' }).waitFor();
        await settled(page.locator('#dock'));
        await page.mouse.move(1, 1);
        for (const q of ['#nav', '#main', '#dock']) {
          const bar = await barOf(page, q);
          assert.ok(bar.spareV > 100, `${q} overflows, so it draws a bar: ${JSON.stringify(bar)}`);
          assert.equal(bar.v, 8, `${q} reserves exactly 8px in ${name}, whatever the OS scroll bar setting: ${JSON.stringify(bar)}`);
        }
        for (const q of ['#main', '#dock']) {
          const { radius } = await barOf(page, q);
          assert.equal(radius, 16, `${q} is the 16px card`);
          await scrollPane(page, q, 0);
          const top = await thumbGaps(page, q, 'v');
          assert.ok(top && top.length > 10, `${q} paints a thumb at the top: ${JSON.stringify(top)}`);
          assert.ok(top.before >= radius, `${q} thumb starts ${top.before}px below the corner, wanted at least ${radius}px: ${JSON.stringify(top)}`);
          await scrollPane(page, q, -1);
          const end = await thumbGaps(page, q, 'v');
          assert.ok(end.after >= radius, `${q} thumb stops ${end.after}px above the corner, wanted at least ${radius}px: ${JSON.stringify(end)}`);
          await scrollPane(page, q, 0);
        }
        await page.close();
      });
    }

    test(`${name}: the grid draws 8px bars on both axes, clear of each other and transparent where they meet (Issue #1310)`, async () => {
      const engine = await barsOnEngine(name);
      const page = await open(`#/table/${wide.id}`, { width: 1100, height: 700, engine });
      await page.mouse.move(1, 1);
      const q = '#main .table-wrap.wv-grid-scroll';
      const bar = await barOf(page, q);
      assert.ok(bar.spareV > 100 && bar.spareH > 100, `the grid scrolls both ways: ${JSON.stringify(bar)}`);
      assert.deepEqual([bar.v, bar.h], [8, 8], `8px each way: ${JSON.stringify(bar)}`);
      assert.ok((await thumbGaps(page, q, 'v')).before >= 8, 'the vertical thumb starts past the corner');
      assert.ok((await thumbGaps(page, q, 'h')).before >= 8, 'the horizontal thumb starts past the corner');
      const img = await stripOf(page, q, 'h');
      const inCorner = img.at(img.width - 4, img.height - 4);
      const panel = await page.evaluate(() => {
        const c = document.createElement('canvas').getContext('2d');
        c.fillStyle = getComputedStyle(document.querySelector('#main')).backgroundColor;
        c.fillRect(0, 0, 1, 1);
        return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3);
      });
      assert.deepEqual(inCorner, panel, `the corner shows the panel through it, no white square: ${inCorner} against ${panel}`);
      await page.close();
    });

    test(`${name}: a pane holds its gutter with nothing to scroll, so overflow never shifts its content (Issue #1310)`, async () => {
      const engine = await barsOnEngine(name);
      const page = await open(`#/table/${short.id}`, { width: 1440, engine });
      const bar = await barOf(page, '#main');
      assert.ok(bar.spareV <= 0, `the short table has nothing to scroll: ${JSON.stringify(bar)}`);
      assert.equal(bar.v, 8, `the panel keeps the same 8px without overflow: ${JSON.stringify(bar)}`);
      await page.close();
    });

    test(`${name}: the Share pane list, code blocks and modal bodies take the one spec, and the hidden bars stay hidden (Issue #1310)`, async () => {
      const engine = await barsOnEngine(name);
      const page = await open(`#/table/${big.id}`, { width: 1440, height: 500, engine });
      await page.click('.table-share-btn');
      await page.waitForSelector('#share-pane:not([hidden]) .share-add');
      await page.evaluate(() => {
        const list = document.querySelector('.share-scroll');
        const tall = Object.assign(document.createElement('div'), { style: 'height:2000px' });
        list.append(tall);
        for (const [tag, cls] of [['pre', 'probe-pre'], ['div', 'modal-body probe-modal']]) {
          const n = document.createElement(tag);
          n.className = cls;
          n.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:100px;overflow:auto;white-space:pre';
          n.textContent = 'x'.repeat(800) + '\n'.repeat(40);
          document.body.append(n);
        }
      });
      for (const q of ['.share-scroll', '.probe-pre', '.probe-modal']) {
        const bar = await barOf(page, q);
        assert.equal(bar.v, 8, `${q} reserves 8px: ${JSON.stringify(bar)}`);
      }
      for (const q of ['#ws-rail', '.view-strip']) {
        if (!await page.locator(q).count()) continue;
        const bar = await barOf(page, q);
        assert.deepEqual([bar.v, bar.h], [0, 0], `${q} still hides its bar: ${JSON.stringify(bar)}`);
      }
      await page.close();
    });
  }

  test(`${PHONE}: a phone keeps its native overlay bars and no gutter (Issue #1310)`, async () => {
    const page = await open(`#/entity/${first.id}`, { phone: true, ready: '#main .doc-section .vditor-reset p' });
    const bar = await barOf(page, '#main');
    assert.ok(bar.spareV > 100, `the page overflows: ${JSON.stringify(bar)}`);
    assert.equal(bar.v, 0, `no gutter on a touch screen: ${JSON.stringify(bar)}`);
    await page.close();
  });

  test('the nav list is the one scroll box, between the head and the pinned foot, in the sidebar and the peek overlay, and the phone drawer scrolls as one column (Issue #957, Issue #1164)', async () => {
    const page = await open(`#/table/${big.id}`, { width: 1470, height: 794 });
    const frame = () => page.evaluate(() => {
      const nav = document.querySelector('#nav');
      const side = document.querySelector('#sidebar');
      const head = document.querySelector('#sidebar .nav-head');
      const foot = document.querySelector('#sidebar .nav-foot');
      const n = nav.getBoundingClientRect();
      const s = side.getBoundingClientRect();
      return {
        navScrolls: nav.scrollHeight > nav.clientHeight + 100 && /auto|scroll/.test(getComputedStyle(nav).overflowY),
        sidebarScrolls: side.scrollHeight > side.clientHeight + 1 || /auto|scroll/.test(getComputedStyle(side).overflowY),
        holdsHead: nav.contains(head),
        holdsFoot: nav.contains(foot),
        clearOfHead: n.top >= head.getBoundingClientRect().bottom - 0.5,
        clearOfFoot: n.bottom <= foot.getBoundingClientRect().top + 0.5,
        barAtEdge: Math.round(s.right - n.right),
      };
    });
    const want = { navScrolls: true, sidebarScrolls: false, holdsHead: false, holdsFoot: false, clearOfHead: true, clearOfFoot: true, barAtEdge: 0 };
    assert.deepEqual(await frame(), want, 'the in-flow sidebar');
    const column = { ...want, navScrolls: false, sidebarScrolls: true };
    for (const [label, viewport, shape] of [['peek', { width: 1470, height: 794 }, want], ['tablet peek', { width: 800, height: 1000 }, want], ['phone drawer', phoneProfile().page.viewport, column]]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.evaluate(() => document.querySelector('#app').classList.add('nav-collapsed', 'nav-peek'));
      await settled(page.locator('#sidebar'));
      assert.deepEqual(await frame(), shape, `the ${label}`);
    }
    await page.close();
  });

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

  test(`${PHONE}: the main panel, the full-screen dock and the nav drawer each scroll alone`, async () => {
    let page = await open(`#/entity/${first.id}`, { phone: true, ready: '#main .doc-section .vditor-reset p' });
    let before = await tops(page);
    await swipeOver(page, '#main');
    let after = await tops(page);
    assert.equal(after.doc, 0, 'the document never scrolls on a phone');
    assert.ok(after.main > before.main + 50, `the main panel scrolls: ${before.main} -> ${after.main}`);

    await page.click('#main .nav-menu');
    await page.waitForTimeout(250);
    before = await tops(page);
    await swipeOver(page, '#sidebar');
    after = await tops(page);
    assert.equal(after.doc, 0);
    assert.ok(after.sidebar > before.sidebar + 50, `the drawer scrolls as one column: ${before.sidebar} -> ${after.sidebar}`);
    assert.equal(after.nav, 0, 'the list inside the drawer has no scroller of its own');
    assert.equal(after.main, before.main, 'the page under the drawer holds');
    await page.close();

    page = await open(`#/table/${big.id}?e=${first.id}`, { phone: true });
    await page.waitForSelector('#dock:not([hidden]) .name-edit');
    await page.waitForTimeout(300);
    const sheet = await page.evaluate(() => { const r = document.querySelector('#dock').getBoundingClientRect(); return [r.left, r.top, r.width, r.height, innerWidth, innerHeight]; });
    assert.deepEqual(sheet.map(Math.round).slice(0, 4), [0, 0, ...sheet.slice(4)], `the phone dock covers the screen: ${sheet}`);
    before = await tops(page);
    await swipeOver(page, '#dock');
    after = await tops(page);
    assert.equal(after.doc, 0);
    assert.ok(after.dock > before.dock + 50, `the sheet scrolls: ${before.dock} -> ${after.dock}`);
    assert.equal(after.main, before.main, 'the table under the sheet holds');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, 'no sideways scroll');
    await page.close();
  });
}
