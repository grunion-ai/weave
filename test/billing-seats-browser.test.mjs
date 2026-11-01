import test from 'node:test';
import assert from 'node:assert/strict';
import { createBilling } from '../src/billing.js';
import { launch, styleOf } from './lib/browser.mjs';

const ISSUER = 'https://clerk.weave.example.com';
const nobody = async () => new Response('{"errors":[{"code":"resource_not_found"}]}', { status: 404 });
const billing = createBilling({ secretKey: 'sk_test_x', plan: 'seat', issuer: ISSUER, publishableKey: null, fetch: nobody });

let ada, dylan;
const s = await launch('billing seats', (w) => {
  w.updateWorkspace({ name: 'ada-sales' });
  w.createSpace({ name: 'Sales' });
  for (const [name, role, subject, email] of [
    ['ada-sales', 'architect', 'user_ada', 'ada-sales@example.com'],
    ['dylan', 'editor', 'user_dylan', 'dylan@example.com'],
  ]) {
    const made = w.createAccount({ name, role }).account;
    w.redeemIdentityInvite(w.linkIdentity(name, { issuer: ISSUER }).code, { issuer: ISSUER, subject });
    w.accountForIdentity({ issuer: ISSUER, subject, email });
    if (name === 'dylan') dylan = made; else ada = made;
  }
  w.setRequireAuth(true);
}, { server: () => ({ billing }) });

if (s) {
  const { base, browser, weave } = s;
  const open = async (account, colorScheme) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...(colorScheme ? { colorScheme } : {}) });
    await ctx.addCookies([{ name: `wv_session_${weave.state.meta.id}`, value: weave.createSession(account.id).token, url: base }]);
    const page = await ctx.newPage();
    await page.goto(`${base}/billing`, { waitUntil: 'load' });
    await page.waitForSelector('#seats li', { state: 'attached' });
    return { ctx, page };
  };
  const seatRows = (page) => page.locator('#seats li').evaluateAll((ls) => ls.map((li) => ({
    name: li.querySelector('.seat-who')?.textContent?.trim() ?? '',
    mail: li.querySelector('.seat-mail')?.textContent?.trim() ?? '',
  })));

  test('the seats list names each holder by address, so a team workspace says who holds which seat (Issue #921)', async () => {
    const { ctx, page } = await open(ada);
    assert.deepEqual(await seatRows(page), [
      { name: 'ada-sales', mail: 'ada-sales@example.com' },
      { name: 'dylan', mail: 'dylan@example.com' },
    ]);
    await ctx.close();
  });

  test('a member who is no architect sees the seats without any address (Issue #921)', async () => {
    const { ctx, page } = await open(dylan);
    assert.deepEqual(await seatRows(page), [
      { name: 'ada-sales', mail: '' },
      { name: 'dylan', mail: '' },
    ]);
    await ctx.close();
  });

  for (const [scheme, muted, card] of [['light', 'rgb(95, 100, 116)', 'rgb(255, 255, 255)'], ['dark', 'rgb(138, 151, 171)', 'rgb(24, 27, 33)']]) {
    test(`the seat address reads against its card in ${scheme} (Issue #921)`, async () => {
      const { ctx, page } = await open(ada, scheme);
      const mail = page.locator('#seats li .seat-mail').first();
      await mail.waitFor({ state: 'visible' });
      assert.equal(await styleOf(mail, 'color', muted), muted, `the address is the muted token in ${scheme}`);
      assert.equal(await styleOf(page.locator('#seats').locator('xpath=ancestor::section[1]'), 'backgroundColor', card), card);
      const box = await mail.boundingBox();
      assert.ok(box && box.width > 0 && box.height > 0, `the address had no box in ${scheme}`);
      await ctx.close();
    });
  }
}
