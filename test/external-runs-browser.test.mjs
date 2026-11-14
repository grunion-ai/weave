import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { runEmail } from '../src/mail.js';

const s = await launch('external runs', (w) => {
  w.createSpace({ name: 'Work' });
  w.createTable({ space: 'Work', name: 'Jobs' });
  const run = w.startRun({ name: 'Daily review' });
  w.updateRun(run.id, { status: 'succeeded', summary: 'Reviewed three items.', sessionUrl: 'https://claude.ai/code/session_example' });
  return { run, runs: w.getTable('System/Runs') };
});

if (s) for (const theme of ['light', 'dark']) {
  test(`Runs opens from System and keeps lifecycle cells read-only (${theme})`, async () => {
    const page = await s.browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(s.base);
    const link = page.locator('.nav-system a').filter({ hasText: /^Runs$/ });
    await link.waitFor();
    await link.click();
    const row = page.locator(`[data-eid="${s.run.id}"]`).first();
    await row.waitFor();
    assert.ok((await row.innerText()).includes('Daily review'));
    assert.equal(await page.locator('#main .add-entity-btn').count(), 0);
    assert.equal(await row.locator('input:not([type=checkbox]),select,textarea,.chip-trigger').count(), 0);
    if (process.env.WEAVE_SHOTS) await page.screenshot({ path: `${process.env.WEAVE_SHOTS}/runs-${theme}.png`, fullPage: true });
    await page.close();
  });

  test(`run email fits a phone and links to the session (${theme})`, async () => {
    const page = await s.browser.newPage({ viewport: { width: 375, height: 850 } });
    const message = runEmail({ name: 'Daily review', status: 'failed', summary: 'Reviewed three items.', error: 'One item could not be read.', startedAt: '2026-11-10T14:00:00Z', finishedAt: '2026-11-10T14:03:00Z', sessionUrl: 'https://claude.ai/code/session_example', runUrl: `${s.base}/e/${s.run.id}`, origin: s.base, theme });
    await page.setContent(message.html);
    assert.equal(await page.locator('a[href="https://claude.ai/code/session_example"]').count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.ok(await page.locator('h1').isVisible());
    if (process.env.WEAVE_SHOTS) await page.screenshot({ path: `${process.env.WEAVE_SHOTS}/run-email-${theme}.png`, fullPage: true });
    await page.close();
  });
}
