import test from 'node:test';
import assert from 'node:assert/strict';
import { createBilling, CLERK_API } from '../src/billing.js';
import { launch } from './lib/browser.mjs';
const ISSUER = 'https://clerk.weave.example.com';
const PERIOD_END = Date.now() + 20 * 86_400_000;
const CLERK = {
  '/billing/plans': { data: [{ id: 'cplan_x', slug: 'seat', fee: { amount: 799, amount_formatted: '$7.99', currency: 'USD', currency_symbol: '$' } }], total_count: 1 },
  '/organizations/org_1/billing/subscription': { subscription_items: [{ status: 'active', plan: { slug: 'seat' }, period_end: PERIOD_END }] },
  '/organizations/org_1/memberships': { data: [{ role: 'org:admin', public_user_data: { user_id: 'user_ada' } }] },
};
const clerk = async (url) => {
  const body = CLERK[String(url).slice(CLERK_API.length).split('?')[0]];
  return new Response(JSON.stringify(body ?? { errors: [{ code: 'resource_not_found' }] }), { status: body ? 200 : 404 });
};
const billing = createBilling({ secretKey: 'sk_test_x', plan: 'seat', issuer: ISSUER, publishableKey: null, fetch: clerk });
let ada;
const s = await launch('billing price', (w) => {
  w.updateWorkspace({ name: 'ada-sales' });
  w.createSpace({ name: 'Sales' });
  ada = w.createAccount({ name: 'ada', role: 'architect' }).account;
  w.redeemIdentityInvite(w.linkIdentity('ada', { issuer: ISSUER }).code, { issuer: ISSUER, subject: 'user_ada' });
  w.linkBillingOrg('org_1');
  w.setRequireAuth(true);
}, { server: () => ({ billing }) });
if (s) {
  const { base, browser, weave } = s;
  test('the billing page states the seat price its Clerk plan holds, never a typed one (Issue #1556)', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addCookies([{ name: `wv_session_${weave.state.meta.id}`, value: weave.createSession(ada.id).token, url: base }]);
    const page = await ctx.newPage();
    await page.goto(`${base}/billing`, { waitUntil: 'load' });
    await page.waitForSelector('#seats li', { state: 'attached' });
    for (const id of ['summary', 'setup-why']) {
      const text = (await page.locator(`#${id}`).textContent()) ?? '';
      assert.match(text, /\$7\.99/, `#${id} states the plan's price`);
      assert.doesNotMatch(text, /\$4\.99/, `#${id} still types the old price`);
    }
    await ctx.close();
  });
}
