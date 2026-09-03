/* The dock's geometry, driven through a real browser (one entity surface,
   review round: Kyle, 2026-09-02). The split defaults to an even half of
   the room left of the nav, the dock's side padding matches #main's so the
   entity reads on the page's grid, and the divider on the dock's left edge
   drags to a remembered width — double-click restores the even split.
   Playwright is NOT a dependency; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const chromium = await import('playwright')
  .then((pw) => pw.chromium)
  .catch(() => null);

if (!chromium) {
  test('entity dock resize (browser)', { skip: 'playwright not installed' }, () => {});
} else {
  let server, base, browser, weave, deals, a;
  test.before(async () => {
    weave = new Weave();
    weave.createSpace({ name: 'Sales' });
    deals = weave.createTable({ space: 'Sales', name: 'Deals' });
    a = weave.createEntity(deals, { name: 'Acme Working Capital' });
    ({ server } = await startServer(weave, { port: 0 }));
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
  });
  test.after(async () => {
    await browser?.close();
    server?.close();
  });

  async function openDocked() {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.click(`tr[data-eid="${a.id}"] .open-link`);
    await page.waitForSelector('#dock:not([hidden]) .dock-resize');
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
    const grip = page.locator('#dock .dock-resize');
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
    await page.click('#dock .dock-head button[title^="Close"]');
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
    await page.click('#dock .dock-head button[title^="Close"]');
    await page.click(`tr[data-eid="${a.id}"] .open-link`);
    await page.waitForSelector('#dock:not([hidden]) .dock-resize');
    await page.dblclick('#dock .dock-resize');
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
    const grip = page.locator('#dock .dock-resize');
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
}
