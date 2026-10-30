import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, hold } from './lib/browser.mjs';

const s = await launch('system space menu', (weave) => {
  weave.createSpace({ name: 'Product' });
  weave.createTable({ space: 'Product', name: 'Tasks' });
  return { sys: weave.getSpace('System'), user: weave.getSpace('Product') };
});

if (s) {
  const { base, browser, sys, user } = s;
  async function openSpace(spaceId, theme) {
    const page = await browser.newPage();
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/#/space/${spaceId}`);
    await page.waitForSelector('.view-header h1, .view-header .view-title');
    return page;
  }
  async function openMenu(spaceId, theme) {
    const page = await openSpace(spaceId, theme);
    await page.waitForSelector('.view-header .dots-btn');
    await page.click('.view-header .dots-btn');
    await page.waitForSelector('.wv-menu[role="menu"]');
    const items = await page.locator('.wv-menu .wv-menu-row').evaluateAll((rs) => rs.map((r) => (r.querySelector('.wv-menu-label, .hold-label') ?? r).textContent));
    return { page, items };
  }

  for (const theme of ['light', 'dark']) {
    test(`${theme}: the System space renders no ⋮ menu`, async () => {
      const page = await openSpace(sys.id, theme);
      assert.equal(await page.locator('.view-header .dots-btn').count(), 0, 'no ⋮ on the system space');
      assert.equal(await page.locator('.wv-menu').count(), 0, 'no empty menu panel');
      await page.close();
    });

    test(`${theme}: the System space header says why it carries no space controls (Issue #849)`, async () => {
      const page = await openSpace(sys.id, theme);
      const note = page.locator('.view-header .space-system-note');
      assert.equal(await note.count(), 1, 'the header carries one note');
      assert.ok(await note.isVisible(), 'the note is on screen');
      const said = (await note.innerText()).trim();
      assert.match(said, /cannot be shared/i, `the note names sharing: ${said}`);
      assert.match(said, /template/i, `the note names templates: ${said}`);
      assert.match(said, /deleted/i, `the note names deletion: ${said}`);
      assert.ok(!said.includes('\u2014'), `no em dash: ${said}`);
      assert.equal(await page.locator('.view-header .table-share-btn').count(), 0, 'still no Share');
      assert.equal(await page.locator('.view-header .use-template-btn').count(), 0, 'still no Use template');
      assert.equal(await page.locator('.view-header .dots-btn').count(), 0, 'still no \u22ee');
      const paint = await note.evaluate((n) => ({ fg: getComputedStyle(n).color, bg: getComputedStyle(document.body).backgroundColor }));
      assert.notEqual(paint.fg, paint.bg, `the note is readable in ${theme}: ${JSON.stringify(paint)}`);
      await page.close();
    });

    test(`${theme}: a user space carries no system note (Issue #849)`, async () => {
      const page = await openSpace(user.id, theme);
      assert.equal(await page.locator('.view-header .space-system-note').count(), 0, 'a user space keeps its controls');
      assert.equal(await page.locator('.view-header .table-share-btn').count(), 1, 'a user space still offers Share');
      await page.close();
    });

    test(`${theme}: a user space offers only Move to trash, behind a hold (Feature #296, Feature #346)`, async () => {
      const { page, items } = await openMenu(user.id, theme);
      assert.ok(!items.some((t) => /Export .*\.csv/.test(t)), `no per-table export: ${items}`);
      assert.equal(await page.locator('.wv-menu .wv-menu-sep').count(), 0, 'no divider');
      assert.deepEqual(items.map((t) => t.trim()), ['Move to trash'], 'one row');
      assert.equal(await page.locator('.wv-menu .hold-btn').count(), 1, 'hold to delete');
      assert.equal(await page.locator('.wv-menu .wv-menu-row.wv-menu-danger').count(), 1, 'the row reads as destructive');
      await page.close();
    });
  }
}
