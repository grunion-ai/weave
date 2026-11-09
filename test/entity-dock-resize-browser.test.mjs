import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, settled } from './lib/browser.mjs';

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
    await page.waitForSelector('#dock:not([hidden])');
    await settled(page.locator('#dock'));
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
    await page.waitForSelector('#dock:not([hidden])');
    await settled(page.locator('#dock'));
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
    await page.mouse.move(60, y, { steps: 5 });
    await page.mouse.up();
    const mainW = await page.evaluate(() => document.querySelector('#main').getBoundingClientRect().width);
    assert.ok(mainW >= 300, `the table survives an over-drag: ${mainW}px`);
    await page.close();
  });

  const MAIN_MIN = 400;
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
    await page.waitForSelector('#dock:not([hidden])');
    await settled(page.locator('#dock'));
    return page;
  }

  {
    const theme = 'light';
    test(`a dock pinned wide leaves the table its minimum at a narrow window (Issue #326, ${theme})`, async () => {
      for (const width of [1470, 1280]) {
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
      assert.ok(wide.dockW >= 800, `the pin applies where it fits: ${wide.dockW}px`);
      await page.setViewportSize({ width: 1000, height: 900 });
      await page.waitForFunction(() => document.querySelector('#app').classList.contains('table-yield'));
      assert.equal((await geometry(page)).main, 0, 'narrowed, the table gives the record the available width');
      const narrow = await geometry(page);
      assert.ok(narrow.overflow <= 0, `narrowed, nothing spills past the window: ${narrow.overflow}px`);
      assert.equal(narrow.stored, '900', 'the narrow window never rewrites the pin');
      await page.setViewportSize({ width: 1600, height: 900 });
      await page.waitForFunction(() => !document.querySelector('#app').classList.contains('table-yield'));
      await settled(page.locator('#dock'));
      const back = await geometry(page);
      assert.ok(Math.abs(back.dockW - wide.dockW) <= 2, `widened again, the pinned width returns: ${back.dockW}px`);
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

    test('narrow viewports show a usable record and restore the table on close (Issue #1513)', async () => {
      for (const width of [601, 729, 901, 1000]) {
        const page = await openPinned('light', 900, width);
        await page.waitForFunction(() => document.querySelector('#app').classList.contains('table-yield'));
        const g = await geometry(page);
        assert.equal(g.main, 0, `${width}px yields the table`);
        assert.ok(g.dockW >= 400, `${width}px keeps the record readable: ${g.dockW}px`);
        assert.ok(g.overflow <= 0);
        assert.equal(g.stored, '900');
        if (width <= 900) {
          await page.click('#dock .nav-menu');
          await page.waitForFunction(() => document.querySelector('#app').classList.contains('nav-held'));
          await page.keyboard.press('Escape');
          await page.waitForFunction(() => document.activeElement === document.querySelector('#dock .nav-menu'));
        }
        await page.click('#dock .dock-close');
        await page.waitForFunction(() => getComputedStyle(document.querySelector('#main')).display !== 'none');
        assert.ok((await geometry(page)).main >= 360);
        assert.equal(await page.locator('.nav-menu-burger').count(), 0);
        await page.close();
      }
    });

  }

  test('an older pin below the new minimum clamps without losing the preference (Issue #1513)', async () => {
    const page = await openPinned('light', 380, 1600);
    try {
      const g = await geometry(page);
      assert.equal(g.dockW, 400);
      assert.equal(g.stored, '380');
    } finally { await page.close(); }
  });

  test('the split holds both content floors around its boundary (Issue #1513)', async () => {
    const page = await openPinned('light', 0, 1600);
    try {
      for (const width of [865, 866, 867, 868, 869, 900, 901, 1131, 1132, 1133, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await settled(page.locator('#dock'));
        const g = await geometry(page);
        assert.ok(g.main === 0 || g.main >= 400, `${width}px table: ${g.main}`);
        assert.ok(g.dockW >= 400, `${width}px record: ${g.dockW}`);
        assert.ok(g.overflow <= 0, `${width}px overflow: ${g.overflow}`);
      }
    } finally { await page.close(); }
  });

  test('the divider lives in the canvas gap, not inside either panel', async () => {
    const page = await openDocked();
    const { gap, gutter } = await page.evaluate(() => {
      const main = document.querySelector('#main').getBoundingClientRect();
      const dockR = document.querySelector('#dock').getBoundingClientRect();
      const g = document.querySelector('#dock-gutter').getBoundingClientRect();
      return { gap: { from: main.right, to: dockR.left }, gutter: { left: g.left, right: g.right } };
    });
    assert.ok(gap.to - gap.from <= 8, `the pane gap stays compact: ${gap.to - gap.from}px`);
    assert.ok(gutter.left >= gap.from - 1 && gutter.right <= gap.to + 1,
      `the gutter (${gutter.left}–${gutter.right}) must sit between the panels (${gap.from}–${gap.to})`);
    await page.close();
  });
}
