import test from 'node:test';
import assert from 'node:assert/strict';
import { createOidc } from '../src/oidc.js';
import { launch } from './lib/browser.mjs';
import { startIdp } from './lib/idp.mjs';

const idp = await startIdp();
const oidc = createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' });
const s = await launch('a failed sign-in never loops back into the same failure', (w) => {
  w.state.meta.name = 'harbor';
  w.markOnboarded();
  w.createSpace({ name: 'Sales' });
  w.createTable({ space: 'Sales', name: 'Deals' });
  w.createAccount({ name: 'eve', role: 'editor' });
  w.redeemIdentityInvite(w.linkIdentity('eve', { issuer: idp.issuer }).code, { issuer: idp.issuer, subject: 'user_eve' });
  w.setRequireAuth(true);
}, { server: () => ({ oidc, limits: { options: 1000, failed: 1000, slugs: 1000 } }) });
test.after(() => idp.stop());

if (s) {
  const base = s.base.replace('127.0.0.1', 'localhost');
  const card = (page) => page.evaluate(() => ({
    title: document.querySelector('h1')?.textContent ?? '',
    text: document.querySelector('.card')?.textContent ?? '',
    links: [...document.querySelectorAll('a')].map((a) => ({ label: a.textContent.trim(), href: a.getAttribute('href') })),
  }));

  test('a provider that refuses weave\'s own client shows a page with nothing to retry (Issue #1179)', async () => {
    const was = console.error;
    console.error = () => {};
    const ctx = await s.browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    try {
      idp.signInBrowserAs({ sub: 'user_eve' });
      idp.tamper('invalid_client');
      const res = await page.goto(`${base}/api/auth/oidc/start`);
      assert.equal(res.status(), 503);
      const seen = await card(page);
      assert.equal(seen.title, 'Sign-in is broken on weave\'s side');
      assert.match(seen.text, /Clerk refused weave's own credentials \(invalid_client\)/);
      assert.deepEqual(seen.links, [], 'no button leads back into the loop');
      assert.ok(await page.locator('.card').isVisible());
    } finally { idp.tamper(null); console.error = was; await ctx.close(); }
  });

  test('a sign-in that fails verification offers a different account, and that account signs in instead of looping (Issue #1179)', async () => {
    const ctx = await s.browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    try {
      idp.signInBrowserAs({ sub: 'user_eve' });
      idp.tamper('signature');
      const res = await page.goto(`${base}/api/auth/oidc/start`);
      assert.equal(res.status(), 401);
      const seen = await card(page);
      assert.match(seen.title, /sign-in could not be verified/);
      assert.deepEqual(seen.links.map((l) => l.label), ['Use a different account', 'Back to sign in']);
      assert.ok(seen.links[0].href.startsWith('/api/auth/oidc/start?fresh=1'), seen.links[0].href);
      idp.tamper(null);
      const authorized = idp.seen.authorized;
      await page.click('text=Use a different account');
      await page.waitForURL((u) => !u.pathname.startsWith('/api/auth/') && !u.pathname.endsWith('/auth'));
      assert.equal(idp.seen.authorized, authorized + 1, 'one trip to the provider, no loop');
      const cookies = await ctx.cookies();
      assert.ok(cookies.some((c) => c.name.startsWith('wv_session_')), 'the different account signed in');
    } finally { idp.tamper(null); await ctx.close(); }
  });
}
