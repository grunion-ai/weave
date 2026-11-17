import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
const s = await launch('settings preferences', (weave) => {
  weave.markOnboarded();
  weave.state.meta.name = 'main';
});
if (s) {
  const { base, browser } = s;
  const pick = async (page, label, choice) => {
    await page.locator('#main .settings-sec', { hasText: label }).locator('.picker-face').click();
    await page.locator('.picker-pop .picker-row', { has: page.getByText(choice, { exact: true }) }).click();
    await page.waitForFunction(() => !document.querySelector('.picker-pop'));
  };

  test('Settings is one panel with Preferences and Workspace pages, and Delete forever is not on it (Feature #382)', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    try {
      await page.goto(`${base}/#/settings`);
      const shell = page.locator('#main .settings-shell');
      await shell.waitFor();
      assert.deepEqual((await shell.locator('.settings-tab').allTextContents()).map((t) => t.trim()), ['Preferences', 'Workspace']);
      assert.equal((await shell.locator('.settings-tab[aria-selected="true"]').textContent()).trim(), 'Preferences');
      assert.deepEqual((await shell.locator('.settings-sec-label > span').allTextContents()).map((t) => t.trim()),
        ['Appearance', 'Week starts on', 'Date format', 'Time format', 'Start page']);
      await shell.locator('.settings-tab', { hasText: 'Workspace' }).click();
      await shell.locator('.settings-page-title', { hasText: 'Workspace' }).waitFor();
      assert.doesNotMatch(await page.textContent('#main'), /Delete forever/, 'permanent delete moved to the Trash page');
    } finally { await page.close(); }
  });

  test('Preferences keep theme, week start, date format, time format and start page in this browser (Feature #382)', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await context.newPage();
    try {
      await page.goto(`${base}/#/settings`);
      await page.locator('#main .settings-shell').waitFor();
      await pick(page, 'Week starts on', 'Monday');
      await pick(page, 'Date format', 'European · 9.3.2026');
      await page.locator('#main .settings-seg [role="radio"]', { hasText: '24-hour' }).click();
      await page.locator('#main .settings-seg [role="radio"]', { hasText: 'Dark' }).click();
      const after = await page.evaluate(() => ({
        week: localStorage.getItem('weave-week-start'), clock: localStorage.getItem('weave-clock'), format: localStorage.getItem('weave-date-format'),
        viewer: weaveDateGrain.viewerDefaults(), theme: document.documentElement.dataset.bsTheme, last: localStorage.getItem('weave-last:/'),
      }));
      assert.deepEqual(after, { week: '1', clock: '24h', format: 'eu', viewer: { format: 'eu', clock: '24h' }, theme: 'dark', last: '#/settings' });
      assert.deepEqual(await page.locator('#main .settings-seg [aria-checked="true"]').allTextContents(), ['Dark', '24-hour']);
      assert.equal((await page.locator('#main .settings-sec', { hasText: 'Week starts on' }).locator('.picker-face').textContent()).trim(), 'Monday');
      const again = await context.newPage();
      await again.goto(`${base}/`);
      await again.locator('#main .settings-shell').waitFor();
      assert.equal(await again.evaluate(() => location.hash), '#/settings', 'a bare workspace load reopens the last page');
      await again.click('#ws-name');
      await again.waitForFunction(() => !location.hash.startsWith('#/settings') && document.querySelector('#main .view-header') && !document.querySelector('#main .settings-shell'));
      await again.goto(`${base}/#/settings`);
      await again.locator('#main .settings-shell').waitFor();
      await pick(again, 'Start page', 'Workspace home');
      const home = await context.newPage();
      await home.goto(`${base}/`);
      await home.waitForFunction(() => document.querySelector('#main .view-header'));
      assert.notEqual(await home.evaluate(() => location.hash), '#/settings', 'Workspace home opens home');
    } finally { await context.close(); }
  });
}
