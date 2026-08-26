/* The bug reporter's panel, driven through a real browser (Issue #93).

   Kyle typed a report, clicked the grid behind the panel to look at the thing
   he was reporting, and the panel — and everything he had written — was gone.
   The trace he filed instead shows the shape of it exactly: forty-nine seconds
   with nothing recorded (the recorder never keeps keystrokes), then one click
   on a cell, then a two-line note that reads "had types an issue and los tit".

   The panel is deliberately non-modal so the broken page stays visible while
   the report is written. Clicking that page is therefore the intended gesture,
   and it must not be the destructive one.

   Playwright is NOT a dependency of weave (house rule: zero runtime deps,
   nothing npm-installed). It is imported dynamically and the whole suite skips
   when it is absent, so `node --test` stays green on a bare checkout. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { seedWeaver } from '../src/weaver-seed.js';

const chromium = await import('playwright')
  .then((pw) => pw.chromium)
  .catch(() => null);

if (!chromium) {
  test('bug panel (browser)', { skip: 'playwright not installed' }, () => {});
} else {
  let server, base, browser, weave;

  /* The panel files into Development/Issue, so the instance under test is the
     seeded docs workspace — a report that cannot be sent cannot prove that
     sending clears the draft. */
  test.before(async () => {
    weave = seedWeaver(new Weave());
    ({ server } = await startServer(weave, { port: 0, workspaces: { weave } }));
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
  });

  test.after(async () => {
    await browser?.close();
    server?.close();
  });

  /* Every case starts on a table, because that is where a report gets written:
     looking at the thing that went wrong. */
  async function open() {
    const page = await browser.newPage();
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.bug-fab');
    await page.click('.bug-fab');
    await page.waitForSelector('#bug-panel .bug-note');
    return page;
  }

  const note = (page) => page.$eval('#bug-panel .bug-note', (n) => n.value);
  const picked = (page) => page.$$eval('#bug-panel .bug-cat.picked', (ns) => ns.map((n) => n.dataset.cat));
  // The page behind the panel — the bug itself, which is the thing a reporter
  // is looking at when they reach for the mouse.
  const clickBehind = (page) => page.click('main#main', { position: { x: 8, y: 8 }, force: true });

  test('a started report survives a click on the page behind it', async () => {
    const page = await open();
    try {
      await page.fill('#bug-panel .bug-note', 'the peers cell drops what I picked');
      await clickBehind(page);
      assert.equal(await page.locator('#bug-panel').count(), 1, 'the panel is still open');
      assert.equal(await note(page), 'the peers cell drops what I picked', 'and still holds the note');
    } finally { await page.close(); }
  });

  /* Nothing typed is nothing to lose, so the click still means "put it away".
     Otherwise a panel opened by accident becomes a thing to dismiss. */
  test('an untouched panel still closes when you click the page', async () => {
    const page = await open();
    try {
      await clickBehind(page);
      await page.waitForSelector('#bug-panel', { state: 'detached' });
    } finally { await page.close(); }
  });

  /* Escape is an explicit dismissal and still closes. What it must not do is
     throw the writing away: reopening picks the report back up. */
  test('Escape puts the report away, and reopening brings it back', async () => {
    const page = await open();
    try {
      await page.fill('#bug-panel .bug-note', 'forty-nine seconds of typing');
      await page.click('#bug-panel .bug-cat[data-cat="wrong-data"]');
      await page.keyboard.press('Escape');
      await page.waitForSelector('#bug-panel', { state: 'detached' });
      await page.click('.bug-fab');
      await page.waitForSelector('#bug-panel .bug-note');
      assert.equal(await note(page), 'forty-nine seconds of typing', 'the note came back');
      assert.deepEqual(await picked(page), ['wrong-data'], 'and so did the symptom');
      assert.equal(await page.locator('#bug-panel .bug-send').isDisabled(), false, 'Send is live on a restored draft');
    } finally { await page.close(); }
  });

  /* A filed report is finished. The next one starts blank, or every report
     after the first opens wearing the last one's words. */
  test('a sent report leaves nothing behind for the next one', async () => {
    const page = await open();
    try {
      await page.fill('#bug-panel .bug-note', 'this one gets filed');
      await page.click('#bug-panel .bug-send');
      await page.waitForSelector('#bug-panel', { state: 'detached', timeout: 5000 });
      await page.click('.bug-fab');
      await page.waitForSelector('#bug-panel .bug-note');
      assert.equal(await note(page), '', 'a fresh panel');
      assert.deepEqual(await picked(page), [], 'and no symptoms carried over');
    } finally { await page.close(); }
  });
}
