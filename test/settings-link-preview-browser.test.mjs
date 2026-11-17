import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';

const s = await launch('settings link preview', (weave) => {
  weave.markOnboarded();
  weave.state.meta.name = 'main';
});

if (s) {
  const { base, browser, weave } = s;

  for (const theme of ['light', 'dark']) {
    test(`${theme}: Link preview before sign-in is a switch on the Settings page (Feature #347)`, async () => {
      weave.updateWorkspace({ linkPreview: false });
      const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
      try {
        await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
        await page.goto(`${base}/#/settings`);
        const card = page.locator('#main .settings-link-preview');
        await card.waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
        assert.equal((await card.locator('.card-title').textContent()).trim(), 'Link preview');
        const sw = card.getByRole('switch', { name: 'Link preview before sign-in' });
        assert.equal(await sw.isChecked(), false, 'off by default');
        await card.locator('.wv-toggle').click();
        await page.locator('.wv-toast', { hasText: 'Link preview before sign-in is on' }).waitFor();
        assert.equal(await eventually(() => weave.getWorkspace().linkPreview, true), true, 'the switch writes the workspace record');
        assert.equal(await sw.isChecked(), true);
        await card.locator('.wv-toggle').click();
        await page.locator('.wv-toast', { hasText: 'Link preview before sign-in is off' }).waitFor();
        assert.equal(await eventually(() => weave.getWorkspace().linkPreview, false), false, 'and turns it back off');
      } finally { await page.close(); }
    });
  }
}
