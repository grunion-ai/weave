/* Press-and-hold, released early, must NOT fire (Kyle, 2026-09-02: "hold to
   delete sticks when more than half done and doesn't stop on release").

   The gesture's whole contract is that letting go cancels — a hold that keeps
   going after the finger lifts is a confirm dialog that answers itself. These
   tests drive the real button in a real browser: release past the halfway
   mark cancels, release just shy of the end cancels, and only a hold carried
   to the end fires.

   Playwright is NOT a dependency of weave (house rule: zero runtime deps) —
   imported dynamically, whole file skips when absent. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const chromium = await import('playwright')
  .then((pw) => pw.chromium)
  .catch(() => null);

if (!chromium) {
  test('hold-to-confirm release (browser)', { skip: 'playwright not installed' }, () => {});
} else {
  let server, base, browser, weave;

  test.before(async () => {
    weave = new Weave();
    weave.createSpace({ name: 'Product' });
    ({ server } = await startServer(weave, { port: 0 }));
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
  });

  test.after(async () => {
    await browser?.close();
    server?.close();
  });

  const tableNames = () => weave.listTables().filter((d) => !d.system).map((d) => d.name);

  /* Fresh page, fresh table, hold the nav kebab's Delete for `ms`, release,
     wait out the full sweep, and report whether the table survived. */
  const holdFor = async (ms, name) => {
    weave.createTable({ space: 'Product', name });
    const page = await browser.newPage();
    try {
      await page.goto(base);
      const row = page.locator('.nav-db', { hasText: name });
      await row.hover();
      await row.locator('.dots-btn').click();
      const hold = row.locator('.hold-btn');
      await hold.hover();
      await page.mouse.down();
      await page.waitForTimeout(ms);
      await page.mouse.up();
      // Wait past the full 900ms sweep plus the API round-trip either way.
      await page.waitForTimeout(1300);
      return tableNames().includes(name);
    } finally {
      await page.close();
    }
  };

  test('release past the halfway mark cancels the delete', async () => {
    assert.ok(await holdFor(550, 'Halfway'), 'released at 550ms of 900 — the table must survive');
  });

  test('release just shy of the end cancels the delete', async () => {
    assert.ok(await holdFor(700, 'AlmostDone'), 'released at 700ms of 900 — the table must survive');
  });

  test('a hold carried to the end fires the delete', async () => {
    assert.equal(await holdFor(1300, 'HeldToEnd'), false, 'held past 900ms — the table goes to the trash');
  });

  test('drifting off the button and releasing there still cancels', async () => {
    weave.createTable({ space: 'Product', name: 'DriftOff' });
    const page = await browser.newPage();
    try {
      await page.goto(base);
      const row = page.locator('.nav-db', { hasText: 'DriftOff' });
      await row.hover();
      await row.locator('.dots-btn').click();
      await row.locator('.hold-btn').hover();
      await page.mouse.down();
      await page.waitForTimeout(400);
      await page.mouse.move(600, 300, { steps: 4 }); // off the menu entirely
      await page.waitForTimeout(200);
      await page.mouse.up();                          // released nowhere near the button
      await page.waitForTimeout(1300);
      assert.ok(tableNames().includes('DriftOff'), 'the release, wherever it lands, cancels the hold');
    } finally {
      await page.close();
    }
  });
}
