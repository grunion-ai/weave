import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage } from './lib/browser.mjs';

let notes, id;
const s = await launch('phone record report', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  notes = weave.createTable({ space: 'Scratch', name: 'Note' });
  id = weave.createEntity(notes, { name: 'Long note' }).id;
  weave.setDoc(id, 'A note the reporter is looking at when something breaks.');
});

if (s) {
  const { base, browser } = s;
  const phone = await phoneBrowser();
  const engines = [['chromium 390x844', (o) => browser.newPage({ viewport: { width: 390, height: 844 }, ...o })]];
  if (phone) engines.push(['webkit iPhone 15', (o) => phonePage(phone, o)]);

  const panelBox = (page) => page.$eval('#bug-panel', (n) => {
    const r = n.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth, vh: innerHeight };
  });

  for (const [engine, make] of engines) {
    for (const theme of ['light', 'dark']) {
      test(`on a phone the record overflow menu carries Report a problem (${engine}, ${theme}, Issue #1023)`, async () => {
        const page = await make({ colorScheme: theme });
        try {
          await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
          await page.goto(`${base}/#/table/${notes.id}?e=${id}`, { waitUntil: 'networkidle' });
          await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
          assert.equal(await page.evaluate(() => [...document.querySelectorAll('.bug-fab')].filter((b) => b.getClientRects().length).length), 0,
            'no floating bug button on a phone (Issue #983)');

          await page.click('#dock .crumb-actions .dots-btn');
          const row = page.locator('.wv-menu-row.record-bug-row');
          await row.waitFor();
          assert.equal((await row.innerText()).trim(), 'Report a problem');
          const box = await row.boundingBox();
          assert.ok(box.height >= 44, `the row is a 44px target (${box.height})`);

          await row.click();
          await page.waitForSelector('#bug-panel .bug-note');
          const p = await panelBox(page);
          assert.ok(p.left >= 8 && p.vw - p.right >= 8, `the panel sits inside a gutter (${JSON.stringify(p)})`);
          assert.ok(p.top >= 0 && p.bottom <= p.vh, 'and fully on screen');
          await page.keyboard.press('Escape');
          await page.waitForSelector('#bug-panel', { state: 'detached' });
        } finally { await page.close(); }
      });
    }

    test(`on a phone the Activity sheet head carries Report a problem (${engine}, Issue #1023)`, async () => {
      const page = await make();
      try {
        await page.goto(`${base}/#/table/${notes.id}?e=${id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
        await page.click('#dock .activity-btn');
        await page.waitForSelector('aside.wv-activity .wv-act-list');

        const trigger = page.locator('aside.wv-activity .wv-act-head .bug-trigger');
        await trigger.waitFor();
        assert.equal(await trigger.getAttribute('title'), 'Report a problem');
        await trigger.click();
        await page.waitForSelector('#bug-panel .bug-note');
        assert.equal(await page.locator('aside.wv-activity').count(), 1, 'the sheet stays open behind the report');
        const p = await panelBox(page);
        assert.ok(p.top >= 0 && p.bottom <= p.vh, 'the panel sits on screen');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#bug-panel', { state: 'detached' });
        assert.equal(await page.locator('aside.wv-activity').count(), 1,
          'Escape dismisses the report and leaves the sheet where it was');
      } finally { await page.close(); }
    });
  }

  test('on a desktop the record overflow menu has no Report a problem row, since the bug button stays in the corner (Issue #1023)', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main textarea.name-edit');
      await page.click('#main .crumb-actions .dots-btn');
      await page.waitForSelector('.wv-menu-row');
      assert.equal(await page.locator('.wv-menu-row.record-bug-row').count(), 0);
      assert.equal(await page.evaluate(() => [...document.querySelectorAll('.bug-fab')].filter((b) => b.getClientRects().length).length), 1,
        'the corner button is the desktop route');
    } finally { await page.close(); }
  });
}
