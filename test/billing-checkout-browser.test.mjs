import test from 'node:test';
import assert from 'node:assert/strict';
import { createBilling } from '../src/billing.js';
import { launch } from './lib/browser.mjs';

const HOST = 'clerk.weave.example.com';
const KEY = `pk_test_${Buffer.from(`${HOST}$`).toString('base64')}`;
const nobody = async () => new Response('{"errors":[{"code":"resource_not_found"}]}', { status: 404 });
const billing = createBilling({ secretKey: 'sk_test_x', soloPlan: 'solo', teamPlan: 'team', publishableKey: KEY, fetch: nobody });

const CLERK_JS = `window.Clerk = {
  user: { id: 'user_k' },
  loadedWith: null,
  async load(opts) { this.loadedWith = opts ?? null; },
  mountPricingTable(el, props) {
    if (typeof this.loadedWith?.ui?.ClerkUI !== 'function') throw new Error('Clerk was not loaded with Ui components');
    el.dataset.pricingFor = props.for;
  },
};`;
const UI_JS = 'window.__internal_ClerkUICtor = function ClerkUI() {};';

const s = await launch('billing-checkout', () => {}, { server: () => ({ billing }) });
if (s) {
  const { base, browser } = s;
  test('the billing page loads Clerk with its UI bundle, so the pricing table mounts (Issue #922)', async () => {
    const page = await browser.newPage();
    const asked = [];
    await page.route(`https://${HOST}/npm/**`, (route) => {
      const url = route.request().url();
      asked.push(new URL(url).pathname);
      const body = url.includes('/@clerk/ui@1/dist/ui.browser.js') ? UI_JS : url.includes('/@clerk/clerk-js@6/dist/clerk.browser.js') ? CLERK_JS : null;
      return body ? route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body }) : route.fulfill({ status: 404, body: '' });
    });
    await page.goto(`${base}/billing`, { waitUntil: 'networkidle' });
    const mounted = page.locator('#checkout [data-pricing-for="user"]');
    await mounted.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
    const seen = await page.evaluate(() => ({ text: document.getElementById('checkout').textContent, mounted: !!document.querySelector('#checkout [data-pricing-for="user"]') }));
    assert.deepEqual(seen, { text: '', mounted: true });
    assert.deepEqual(asked.sort(), ['/npm/@clerk/clerk-js@6/dist/clerk.browser.js', '/npm/@clerk/ui@1/dist/ui.browser.js']);
    await page.close();
  });
}
