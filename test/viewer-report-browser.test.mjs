import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABAQMAAADO7O3JAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8AAP///0EdNBEAAAABYktHRAH/Ai3eAAAAB3RJTUUH6goFETs3n475pwAAAApJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII=', 'base64');
let row;
const s = await launch('the report button stays off the file viewers', (weave) => {
  weave.createSpace({ name: 'Product' });
  const deck = weave.createTable({ space: 'Product', name: 'Deck' });
  weave.addField(deck, { name: 'Files', type: 'attachments' });
  row = weave.createEntity(deck, { name: 'row' });
  weave.attachToField(row.id, 'Files', { name: 'shot.png', mime: 'image/png', bytes: PNG });
});

if (s) {
  const { base, browser } = s;
  const box = (loc) => loc.evaluate((n) => { const b = n.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width }; });
  const meets = (a, b) => a.w > 0 && b.w > 0 && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

  for (const theme of ['light', 'dark']) {
    test(`with a file in the side panel or full screen, Report a problem moves into the viewer's own bar (${theme}) (Issue #1193)`, async () => {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
      try {
        await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
        const fab = page.locator('.bug-fab');
        assert.equal(await fab.isVisible(), true, 'the floating button shows on a plain record');

        await page.click('.attach-cell');
        const panel = page.locator('#side .wv-file-panel');
        await panel.waitFor();
        assert.equal(await fab.isVisible(), false, 'the floating button leaves while the side panel shows a file');
        assert.equal(meets(await box(fab), await box(panel)), false);
        assert.equal(await panel.locator('.wv-file-head button[title="Report a problem"]').count(), 1, 'the panel bar carries the report button');

        await page.click('#side .wv-file-panel button[title="Full screen"]');
        await page.waitForSelector('#fsv-back');
        assert.equal(await fab.isVisible(), false, 'and while the full-screen viewer is open');
        assert.equal(meets(await box(fab), await box(page.locator('#fsv-back .fsv-frame'))), false, 'nothing of weave sits over the file');
        const report = page.locator('#fsv-back .fsv-bar button[title="Report a problem"]');
        await report.click();
        const bugPanel = page.locator('#bug-panel');
        await bugPanel.waitFor();
        const [r, p] = await Promise.all([box(report), box(bugPanel)]);
        assert.ok(p.t >= r.b && p.r <= 1400 && p.l >= 0, `the report panel opens under its button, on screen: ${JSON.stringify({ r, p })}`);
        assert.equal(await report.getAttribute('aria-expanded'), 'true');
        await page.keyboard.press('Escape');
        await bugPanel.waitFor({ state: 'detached' });
        assert.equal(await page.locator('#fsv-back').count(), 1, 'Esc closes the report panel first, the viewer stays');
        await page.keyboard.press('Escape');
        await page.waitForSelector('#fsv-back', { state: 'detached' });
        await page.keyboard.press('Escape');
        await panel.waitFor({ state: 'detached' });
        assert.equal(await fab.isVisible(), true, 'the floating button comes back once no viewer is open');
      } finally { await page.close(); }
    });
  }
}
