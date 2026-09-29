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
import { launch, eventually } from './lib/browser.mjs';


const s = await launch('hold-to-confirm release', (weave) => {
  weave.createSpace({ name: 'Product' });
});
if (s) {
  const { base, browser, weave } = s;
  const tableNames = () => weave.listTables().filter((d) => !d.system).map((d) => d.name);

  /* Fresh page, fresh table, hold the nav kebab's Delete for `ms`, release,
     wait out the full sweep, and report whether the table survived.

     The hold is timed on the page's own clock, the fill's transition, not
     by a sleep in this process: a sleep here also counts the time the press
     takes to reach a busy page, so on a loaded gate a 1300 ms hold could be
     a 700 ms one by the fill's reckoning (Issue #454). An early release is
     sent once the fill has swept `ms` of its 900, with the sweep played at
     a quarter speed so the release has 800 ms of wall time to arrive
     instead of 200: under a four-times CPU throttle the page's frames came
     too far apart to see 700 before the sweep ended. A hold to the end is
     held until the fill has fired, and the delete is read back until it
     lands. */
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
      if (ms < 900) {
        await hold.evaluate((btn) => new MutationObserver(() => {
          if (btn.classList.contains('holding')) for (const a of btn.querySelector('.hold-fill').getAnimations()) a.playbackRate = 0.25;
        }).observe(btn, { attributes: true, attributeFilter: ['class'] }));
      }
      await page.mouse.down();
      await page.waitForSelector('.hold-btn.holding');
      if (ms < 900) {
        const fill = await hold.locator('.hold-fill').elementHandle();
        await page.waitForFunction(([f, t]) => (f.getAnimations()[0]?.currentTime ?? 0) >= t, [fill, ms], { polling: 'raf' });
        await page.mouse.up();
        // Wait past the rest of the sweep at its quarter speed, the 80 ms
        // grace and the API round-trip, so a release that failed to cancel
        // has had every chance to delete.
        await page.waitForTimeout((900 - ms) * 4 + 500);
        return tableNames().includes(name);
      }
      await page.waitForSelector('.hold-btn.holding', { state: 'detached' }).catch(() => {});
      await page.mouse.up();
      return eventually(() => tableNames().includes(name), false);
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
