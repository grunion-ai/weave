import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let rows;
const s = await launch('rail help tooltip', (weave) => {
  weave.createSpace({ name: 'Ledger' });
  rows = weave.createTable({ space: 'Ledger', name: 'Rows' });
  weave.createEntity(rows, { name: 'first' });
});

if (s) {
  const { base, browser } = s;

  const open = async (theme) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/table/${rows.id}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector('#rail-help');
    return page;
  };

  for (const theme of ['light', 'dark']) {
    test(`the rail's help button carries no native tooltip, and keeps its name (${theme})`, async () => {
      const page = await open(theme);
      const btn = await page.locator('#rail-help').evaluate((e) => ({
        title: e.getAttribute('title'),
        label: e.getAttribute('aria-label'),
        text: e.textContent.trim(),
        icons: e.querySelectorAll('svg').length,
      }));
      assert.equal(btn.title, null, 'no title attribute, so no native tooltip on hover');
      assert.equal(btn.label, 'Keyboard shortcuts', 'the accessible name stays for screen readers');
      assert.equal(btn.icons, 1, 'the icon alone');
      assert.equal(btn.text, '', 'no glyph beside the icon');
      await page.close();
    });
  }

  test('the help button and the ? key both still open the key sheet', async () => {
    const page = await open('light');
    await page.click('#rail-help');
    await page.waitForSelector('#modal.wv-keys');
    assert.equal(await page.locator('#modal.wv-keys').count(), 1, 'a click opens the key sheet');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#modal.wv-keys', { state: 'detached' });
    await page.keyboard.press('?');
    await page.waitForSelector('#modal.wv-keys');
    assert.equal(await page.locator('#modal.wv-keys').count(), 1, 'the ? key opens it too');
    await page.keyboard.press('Escape');
    await page.close();
  });
}
