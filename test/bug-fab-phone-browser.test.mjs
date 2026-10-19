import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage } from './lib/browser.mjs';

let notes, id;
const s = await launch('bug fab phone', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  notes = weave.createTable({ space: 'Scratch', name: 'Note' });
  id = weave.createEntity(notes, { name: 'Long note' }).id;
  const lines = Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of a long document that runs to the right edge of a phone.`);
  weave.setDoc(id, lines.join('\n\n'));
});
if (s) {
  const { base, browser } = s;
  const fab = (page) => page.$eval('.bug-fab', (b) => {
    const r = b.getBoundingClientRect();
    const inset = parseFloat(getComputedStyle(b).borderTopWidth) || 0;
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, face: r.width - 2 * inset, inset, vw: innerWidth, vh: innerHeight };
  });

  const phone = await phoneBrowser();
  const engines = [['chromium 390x844', (o) => browser.newPage({ viewport: { width: 390, height: 844 }, ...o })]];
  if (phone) engines.push(['webkit iPhone 15', (o) => phonePage(phone, o)]);
  const drawn = (page) => page.evaluate(() => [...document.querySelectorAll('.bug-fab')].filter((b) => b.getClientRects().length).length);

  for (const [engine, make] of engines) {
    for (const colorScheme of ['light', 'dark']) {
      test(`on a phone no bug button floats over the table, the record or the Activity sheet (${engine}, ${colorScheme}, Issue #983)`, async () => {
        const page = await make({ colorScheme });
        try {
          await page.goto(`${base}/#/table/${notes.id}`, { waitUntil: 'networkidle' });
          await page.waitForSelector('#main tr.entity-row');
          assert.equal(await drawn(page), 0, 'the table');
          await page.goto(`${base}/#/table/${notes.id}?e=${id}`, { waitUntil: 'networkidle' });
          await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
          assert.equal(await drawn(page), 0, 'the record');
          await page.click('#dock .activity-btn');
          await page.waitForSelector('aside.wv-activity .wv-act-list');
          assert.equal(await drawn(page), 0, 'the Activity sheet');
        } finally { await page.close(); }
      });
    }

    test(`on a phone Report a problem lives in Your menu and opens the report panel across the screen (${engine}, Issue #983)`, async () => {
      const page = await make();
      try {
        await page.goto(`${base}/#/table/${notes.id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('#main tr.entity-row');
        await page.click('#main .nav-menu');
        await page.click('#sidebar .nav-identity-more');
        const row = page.locator('.nav-personal-menu .nav-bug-row');
        assert.equal((await row.innerText()).trim(), 'Report a problem');
        const box = await row.boundingBox();
        assert.ok(box.height >= 44, `the row is a 44px target (${box.height})`);
        await row.click();
        await page.waitForSelector('#bug-panel .bug-note');
        const p = await page.$eval('#bug-panel', (n) => { const r = n.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth, vh: innerHeight }; });
        assert.ok(p.left >= 8 && p.vw - p.right >= 8 && p.vw - p.right <= 16 && p.left <= 16, `the panel spans the screen inside a gutter (${JSON.stringify(p)})`);
        assert.ok(p.top >= 0 && p.bottom <= p.vh, 'and sits fully on screen');
        assert.equal(await page.locator('#app.nav-peek').count(), 0, 'the menu closes so the panel reads over the page');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#bug-panel', { state: 'detached' });
      } finally { await page.close(); }
    });
  }

  test('on a desktop Your menu has no Report a problem row, since the bug button stays in the corner (Issue #983)', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      await page.goto(`${base}/#/table/${notes.id}`, { waitUntil: 'networkidle' });
      await page.click('#sidebar .nav-identity-more');
      await page.waitForSelector('.nav-personal-menu .wv-menu-row');
      assert.equal(await page.locator('.nav-personal-menu .nav-bug-row').count(), 0);
      assert.equal(await drawn(page), 1);
    } finally { await page.close(); }
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`on a desktop the bug button keeps its 26px corner, equally inset from both edges, in ${colorScheme} (Issue #846)`, async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme });
      try {
        await page.goto(`${base}/#/table/${notes.id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.bug-fab');
        assert.equal(await page.$eval('html', (h) => h.dataset.bsTheme), colorScheme);
        const b = await fab(page);
        assert.equal(Math.round(b.width), 26);
        assert.equal(Math.round(b.vw - b.right), 12);
        assert.equal(Math.round(b.vh - b.bottom), Math.round(b.vw - b.right));
      } finally { await page.close(); }
    });
  }
}
