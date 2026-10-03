/* Members with mail on (Feature #216): an invite the server emailed says
   Emailed and shows no link; one whose email failed shows the link to copy,
   says the email did not go out, and toasts the reason. Both themes. The
   copy-the-link flow with mail off is test/invites-browser.test.mjs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { createOidc } from '../src/oidc.js';

const sent = [];
const mail = async (msg) => {
  if (msg.to.startsWith('fail-')) throw new Error('Resend answered 403: domain not verified');
  sent.push(msg);
  return { id: 'em_1' };
};

const s = await launch('members invites by email', (weave) => {
  weave.updateWorkspace({ name: 'home' });
  weave.markOnboarded();
}, { server: () => ({ oidc: createOidc({ issuer: 'https://idp.test', clientId: 'weave' }), mail }) });

if (s) {
  const { base, browser } = s;
  for (const theme of ['light', 'dark']) {
    test(`an emailed invite says Emailed; a failed one shows the link (${theme})`, async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
      await page.click('.wv-members-box > summary');
      const send = async (email) => {
        await page.fill('.wv-invite-form input[type=email]', email);
        await page.click('.wv-invite-form button[type=submit]');
        await page.locator('.wv-invite-link-head', { hasText: email }).waitFor();
      };
      await send(`ok-${theme}@example.com`);
      assert.equal((await page.locator('.wv-invite-link-head').textContent()).trim(), `Emailed ok-${theme}@example.com`);
      assert.match(await page.locator('.wv-invite-note').textContent(), /weave emailed the sign-in link/);
      assert.equal(await page.locator('.wv-invite-link input').count(), 0, 'no link to copy');
      assert.ok(sent.some((m) => m.to === `ok-${theme}@example.com`));
      await send(`fail-${theme}@example.com`);
      assert.match(await page.locator('.wv-invite-link input').inputValue(), /\/api\/auth\/oidc\/start\?invite=wvi_/);
      assert.match(await page.locator('.wv-invite-note').textContent(), /the email did not go out/);
      assert.match(await page.locator('.toast, .wv-toast', { hasText: 'not sent' }).first().textContent(), /domain not verified/);
      await page.close();
    });
  }
}
