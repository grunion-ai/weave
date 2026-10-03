/* The dock's geometry, driven through a real browser (one entity surface,
   review round: Kyle, 2026-09-02). The split defaults to an even half of
   the room left of the nav, the dock's side padding matches #main's so the
   entity reads on the page's grid, and the divider on the dock's left edge
   drags to a remembered width — double-click restores the even split.
   Playwright is NOT a dependency; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let deals, a;
const s = await launch('entity dock resize', (weave) => {
  weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deals' });
  a = weave.createEntity(deals, { name: 'Acme Working Capital' });
});
if (s) {
  const { base, browser } = s;
  async function openDocked() {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.click(`tr[data-eid="${a.id}"] .open-link`);
    await page.waitForSelector('#dock-gutter:not([hidden])');
    return page;
  }

  test('the split defaults to an even half of the room beside the nav', async () => {
    const page = await openDocked();
    const { main, dockW } = await page.evaluate(() => ({
      main: document.querySelector('#main').getBoundingClientRect().width,
      dockW: document.querySelector('#dock').getBoundingClientRect().width,
    }));
    assert.ok(Math.abs(main - dockW) < 24, `an even split: main ${main} vs dock ${dockW}`);
    await page.close();
  });

  test("the dock's side padding matches the page's, so the entity keeps its grid", async () => {
    const page = await openDocked();
    const pads = await page.evaluate(() => {
      const cs = (sel) => getComputedStyle(document.querySelector(sel));
      return {
        dock: [cs('#dock').paddingLeft, cs('#dock').paddingRight],
        main: [cs('#main').paddingLeft, cs('#main').paddingRight],
      };
    });
    assert.deepEqual(pads.dock, pads.main, `dock ${pads.dock} vs page ${pads.main}`);
    await page.close();
  });

  test('dragging the divider pins a width and it survives a reopen', async () => {
    const page = await openDocked();
    const grip = page.locator('#dock-gutter');
    const box = await grip.boundingBox();
    const y = box.y + 200;
    await page.mouse.move(box.x + 4, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 4 - 160, y, { steps: 5 });
    await page.mouse.up();
    const widened = await page.evaluate(() => document.querySelector('#dock').getBoundingClientRect().width);
    const stored = await page.evaluate(() => Number(localStorage.getItem('wv-dock-width')));
    assert.ok(Math.abs(stored - widened) <= 2, `the drag is remembered: ${stored} vs ${widened}`);
    // Reopen: close the dock, dock again — the pinned width comes back.
    await page.click('#dock .crumb-row button[aria-label="Close"]');
    await page.waitForSelector('#dock', { state: 'hidden' });
    await page.click(`tr[data-eid="${a.id}"] .open-link`);
    await page.waitForSelector('#dock:not([hidden])');
    const reopened = await page.evaluate(() => document.querySelector('#dock').getBoundingClientRect().width);
    assert.ok(Math.abs(reopened - widened) <= 2, `the width survives a reopen: ${reopened} vs ${widened}`);
    await page.close();
  });

  test('double-clicking the divider restores the even split', async () => {
    const page = await openDocked();
    await page.evaluate(() => localStorage.setItem('wv-dock-width', '900'));
    await page.click('#dock .crumb-row button[aria-label="Close"]');
    await page.click(`tr[data-eid="${a.id}"] .open-link`);
    await page.waitForSelector('#dock-gutter:not([hidden])');
    await page.dblclick('#dock-gutter');
    const { main, dockW, stored } = await page.evaluate(() => ({
      main: document.querySelector('#main').getBoundingClientRect().width,
      dockW: document.querySelector('#dock').getBoundingClientRect().width,
      stored: localStorage.getItem('wv-dock-width'),
    }));
    assert.equal(stored, null, 'the pin is forgotten');
    assert.ok(Math.abs(main - dockW) < 24, `back to even: main ${main} vs dock ${dockW}`);
    await page.close();
  });

  test('the drag clamps: the table keeps its minimum room', async () => {
    const page = await openDocked();
    const grip = page.locator('#dock-gutter');
    const box = await grip.boundingBox();
    const y = box.y + 200;
    await page.mouse.move(box.x + 4, y);
    await page.mouse.down();
    await page.mouse.move(60, y, { steps: 5 }); // far past the sidebar
    await page.mouse.up();
    const mainW = await page.evaluate(() => document.querySelector('#main').getBoundingClientRect().width);
    assert.ok(mainW >= 300, `the table survives an over-drag: ${mainW}px`);
    await page.close();
  });

  /* Issue #326 (Kyle, 2026-09-20, at 1470 px): "left panel needs minimum
     width to avoid responsive break". A dock pinned wide on a big window
     came back at full width on a smaller one and took the table's room,
     because the stored pin was applied unclamped and #main may shrink to
     nothing. The table keeps 320 px beside any pin at any window, and the
     pin itself is never rewritten by a window that is only small. */
  const MAIN_MIN = 320;
  const geometry = (page) => page.evaluate(() => ({
    main: document.querySelector('#main').getBoundingClientRect().width,
    dockW: document.querySelector('#dock').getBoundingClientRect().width,
    stored: localStorage.getItem('wv-dock-width'),
    overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  async function openPinned(theme, px, width) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.evaluate(([t, w]) => {
      document.documentElement.setAttribute('data-bs-theme', t);
      if (w) localStorage.setItem('wv-dock-width', String(w));
    }, [theme, px]);
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.click(`tr[data-eid="${a.id}"] .open-link`);
    await page.waitForSelector('#dock-gutter:not([hidden])');
    return page;
  }

  for (const theme of ['light', 'dark']) {
    test(`a dock pinned wide leaves the table its minimum at a narrow window (Issue #326, ${theme})`, async () => {
      // 900 px is a pin the drag allows at 1600; the report's window was 1470.
      for (const width of [1470, 1100]) {
        const page = await openPinned(theme, 900, width);
        const g = await geometry(page);
        assert.ok(g.main >= MAIN_MIN, `at ${width} px the table keeps ${MAIN_MIN}px: ${g.main}px beside a ${g.dockW}px dock`);
        assert.ok(g.overflow <= 0, `at ${width} px nothing spills past the window: ${g.overflow}px`);
        assert.equal(g.stored, '900', 'opening at a small window leaves the pin alone');
        await page.close();
      }
    });

    test(`a window narrowed and widened again gives the pinned dock back (Issue #326, ${theme})`, async () => {
      const page = await openPinned(theme, 900, 1600);
      const wide = await geometry(page);
      assert.ok(Math.abs(wide.dockW - 900) <= 2, `the pin applies where it fits: ${wide.dockW}px`);
      await page.setViewportSize({ width: 1000, height: 900 });
      const narrow = await geometry(page);
      assert.ok(narrow.main >= MAIN_MIN, `narrowed, the table keeps ${MAIN_MIN}px: ${narrow.main}px`);
      assert.ok(narrow.overflow <= 0, `narrowed, nothing spills past the window: ${narrow.overflow}px`);
      assert.equal(narrow.stored, '900', 'the narrow window never rewrites the pin');
      await page.setViewportSize({ width: 1600, height: 900 });
      const back = await geometry(page);
      assert.ok(Math.abs(back.dockW - 900) <= 2, `widened again, the pinned width returns: ${back.dockW}px`);
      await page.close();
    });

    test(`an over-drag stops at the table's minimum and stores the width shown (Issue #326, ${theme})`, async () => {
      const page = await openPinned(theme, 0, 1600);
      const box = await page.locator('#dock-gutter').boundingBox();
      const y = box.y + 200;
      await page.mouse.move(box.x + 4, y);
      await page.mouse.down();
      await page.mouse.move(60, y, { steps: 5 });
      await page.mouse.up();
      const g = await geometry(page);
      assert.ok(g.main >= MAIN_MIN, `the table survives an over-drag: ${g.main}px`);
      assert.ok(Math.abs(Number(g.stored) - g.dockW) <= 2, `the stored pin is the width shown: ${g.stored} vs ${g.dockW}`);
      await page.close();
    });

    /* A window too narrow for a 360px dock squeezes it to what the table's
       floor leaves (340px at 1000). A drag there stored that squeezed width,
       and applyDockWidth drops any pin under DOCK_MIN, so every later open
       fell back to the even split. The drag stores the width shown, floored
       at DOCK_MIN, which is always a pin the next open honours. */
    test(`a drag on a window too narrow for the dock leaves a pin a wide window honours (Issue #326, ${theme})`, async () => {
      const page = await openPinned(theme, 0, 1000);
      const squeezed = await geometry(page);
      assert.ok(squeezed.dockW < 360, `the window squeezes the dock under 360px: ${squeezed.dockW}px`);
      const box = await page.locator('#dock-gutter').boundingBox();
      const y = box.y + 200;
      await page.mouse.move(box.x + 4, y);
      await page.mouse.down();
      await page.mouse.move(box.x + 4 - 40, y, { steps: 5 });
      await page.mouse.up();
      const stored = Number(await page.evaluate(() => localStorage.getItem('wv-dock-width')));
      assert.ok(stored >= 360, `the drag leaves a pin the next open keeps: ${stored}`);
      await page.setViewportSize({ width: 1600, height: 900 });
      await page.click('#dock .crumb-row button[aria-label="Close"]');
      await page.waitForSelector('#dock', { state: 'hidden' });
      await page.click(`tr[data-eid="${a.id}"] .open-link`);
      await page.waitForSelector('#dock:not([hidden])');
      const g = await geometry(page);
      assert.ok(Math.abs(g.dockW - stored) <= 2, `the wide window opens at the pin: ${g.dockW}px vs ${stored}`);
      assert.ok(Math.abs(g.main - g.dockW) > 24, `not the even split: table ${g.main}px, dock ${g.dockW}px`);
      await page.close();
    });
  }

  test('the divider lives in the canvas gap, not inside either panel', async () => {
    const page = await openDocked();
    const { gap, gutter } = await page.evaluate(() => {
      const main = document.querySelector('#main').getBoundingClientRect();
      const dockR = document.querySelector('#dock').getBoundingClientRect();
      const g = document.querySelector('#dock-gutter').getBoundingClientRect();
      return { gap: { from: main.right, to: dockR.left }, gutter: { left: g.left, right: g.right } };
    });
    assert.ok(gutter.left >= gap.from - 1 && gutter.right <= gap.to + 1,
      `the gutter (${gutter.left}–${gutter.right}) must sit between the panels (${gap.from}–${gap.to})`);
    await page.close();
  });
}
