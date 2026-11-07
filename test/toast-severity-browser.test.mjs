import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { inkOn } from './lib/contrast.mjs';

const s = await launch('toast severity', (weave) => {
  weave.createSpace({ name: 'Product' });
  weave.createTable({ space: 'Product', name: 'Deck' });
});

const isRed = ([r, g, b]) => r > g + 60 && r > b + 50;
const isAmber = ([r, g, b]) => r >= g && g > b + 30 && r > b + 80;

if (s) {
  const { base, browser } = s;
  for (const theme of ['light', 'dark']) {
    test(`err toasts read red and warn toasts read amber, both at WCAG AA (${theme})`, async () => {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      try {
        await page.goto(`${base}/`, { waitUntil: 'networkidle' });
        await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
        await page.evaluate(() => {
          toast('The server returned an error, so deck.pdf was not saved.', true, { label: 'Retry', run: () => {} });
          toast('2 of 3 files uploaded. b.pdf was not saved: server error.', false, { label: 'Retry', run: () => {} }, { kind: 'warn' });
          toast('3 files uploaded.', false, null, { kind: 'success' });
        });
        const looks = {};
        for (const kind of ['err', 'warn', 'success']) {
          const node = page.locator(`.wv-toast.${kind}`);
          await node.waitFor();
          const text = await node.locator('.wv-toast-msg').evaluate(inkOn);
          const accent = await node.evaluate(inkOn, 'borderLeftColor');
          const icon = await node.locator('.wv-toast-icon').evaluate(inkOn);
          const action = kind === 'success' ? null : await node.locator('.wv-toast-action').evaluate(inkOn);
          looks[kind] = { text, accent, icon, action };
          assert.ok(text.ratio >= 4.5, `${kind} message reads at ${text.ratio.toFixed(2)}:1`);
          if (action) assert.ok(action.ratio >= 4.5, `${kind} action reads at ${action.ratio.toFixed(2)}:1`);
        }
        for (const kind of ['err', 'warn']) {
          const { accent, icon } = looks[kind];
          assert.ok(accent.ratio >= 3, `${kind} accent bar sits at ${accent.ratio.toFixed(2)}:1 against its toast`);
          assert.ok(icon.ratio >= 3, `${kind} icon sits at ${icon.ratio.toFixed(2)}:1 against its toast`);
          const hue = kind === 'err' ? isRed : isAmber;
          assert.ok(hue(accent.ink), `${kind} accent is rgb(${accent.ink.join(', ')})`);
          assert.ok(hue(icon.ink), `${kind} icon is rgb(${icon.ink.join(', ')})`);
        }
        assert.notDeepEqual(looks.err.text.base, looks.success.text.base, 'an err toast wears the same ground as a success toast, so only its icon says red');
        assert.notDeepEqual(looks.warn.accent.ink, looks.err.accent.ink, 'warn and err share one accent');
        await page.waitForFunction(() => document.getElementById('wv-live-alert')?.textContent?.startsWith('The server returned an error'));
        await page.waitForFunction(() => document.getElementById('wv-live-status')?.textContent === '3 files uploaded.');
      } finally { await page.close(); }
    });
  }

  test('a warn toast is announced politely and outlives an info toast', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    try {
      await page.clock.install();
      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      await page.evaluate(() => {
        toast('Saved');
        toast('notes.txt is empty and was saved anyway. Remove it if that was a mistake.', false, null, { kind: 'warn' });
      });
      await page.waitForFunction(() => document.getElementById('wv-live-status')?.textContent?.startsWith('notes.txt is empty'));
      assert.equal(await page.evaluate(() => document.getElementById('wv-live-alert')?.textContent ?? ''), '', 'a warning interrupted as an alert');
      await page.clock.fastForward(7000);
      await page.locator('.wv-toast.info').waitFor({ state: 'detached' });
      assert.equal(await page.locator('.wv-toast.warn').count(), 1, 'the warning left with the info toast');
    } finally { await page.close(); }
  });
}
