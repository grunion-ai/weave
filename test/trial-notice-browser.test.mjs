import test from 'node:test';
import assert from 'node:assert/strict';
import { createBilling } from '../src/billing.js';
import { launch } from './lib/browser.mjs';

const DAY = 86_400_000;
const nobody = async () => new Response('{"errors":[{"code":"resource_not_found"}]}', { status: 404 });
const billing = createBilling({ secretKey: 'sk_test_x', soloPlan: 'solo', teamPlan: 'team', fetch: nobody });
const shots = process.env.WEAVE_TRIAL_SHOTS;

for (const [daysAgo, shown] of [[12, true], [5, false]]) {
  const s = await launch(`trial-notice-${daysAgo}`, (weave) => {
    weave.createSpace({ name: 'S' });
    weave.createTable({ space: 'S', name: 'T' });
    weave.state.meta.trialFrom = new Date(Date.now() - daysAgo * DAY).toISOString();
  }, { server: () => ({ billing }) });
  if (s) {
    const { base, browser } = s;
    test(`a trial ${daysAgo} days in ${shown ? 'shows' : 'hides'} the sidebar notice linking to billing`, async () => {
      const page = await browser.newPage();
      await page.goto(base, { waitUntil: 'networkidle' });
      const chip = page.locator('#sidebar .nav-trial');
      if (!shown) {
        assert.equal(await chip.isHidden(), true);
        await page.close();
        return;
      }
      await chip.waitFor({ state: 'visible', timeout: 5000 });
      assert.equal(await chip.textContent(), 'Free trial ends in 2 days');
      assert.equal(new URL(await chip.evaluate((a) => a.href)).pathname, '/billing');
      for (const theme of ['light', 'dark']) {
        await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
        const look = await chip.evaluate((a) => ({ color: getComputedStyle(a).color, line: getComputedStyle(a).textDecorationLine }));
        assert.equal(look.line, 'none', theme);
        if (shots) await page.locator('#sidebar .nav-pinned').screenshot({ path: `${shots}/trial-chip-${theme}.png` });
      }
      await page.close();
    });
  }
}
