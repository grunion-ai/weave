/* The Members section on a workspace's home (Issue #569, bullet 3): an
   architect invites a new person by email, picks the role, copies the
   one-time sign-in link, and revokes a pending invite, in both themes.
   With no account on the workspace yet, the open caller may manage
   accounts, which is how this suite reaches the section. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';
import { createOidc } from '../src/oidc.js';

const s = await launch('members and invites', (weave) => {
  weave.updateWorkspace({ name: 'home' });
  // Onboarded already: the welcome (Feature #248) would sit over the home page.
  weave.markOnboarded();
}, { server: () => ({ oidc: createOidc({ issuer: 'https://idp.test', clientId: 'weave' }) }) });

if (s) {
  const { base, browser, weave } = s;

  for (const theme of ['light', 'dark']) {
    test(`invite, copy the link, revoke (${theme})`, async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
      await page.click('.wv-members-box > summary');
      const face = page.locator('.wv-invite-form .picker-face');
      assert.equal((await face.textContent()).trim(), 'Editor, paid seat', 'Editor is the default');
      await page.fill('.wv-invite-form input[type=email]', `${theme}@example.com`);
      await face.click();
      const opts = page.locator('.chip-pop .chip-pop-row');
      await opts.first().waitFor();
      assert.deepEqual((await opts.allTextContents()).map((t) => t.replace(/^\d+|✓/g, '').trim()), ['Editor, paid seat', 'Observer, free', 'Architect, paid']);
      await opts.filter({ hasText: 'Observer, free' }).click();
      await page.click('.wv-invite-form button[type=submit]');
      const link = page.locator('.wv-invite-link input');
      await link.waitFor();
      assert.match(await link.inputValue(), /\/api\/auth\/oidc\/start\?invite=wvi_[\w-]+$/);
      assert.match(await page.locator('.wv-invite-note').textContent(), /does not send email/);
      const row = page.locator('.wv-members .list-row', { hasText: `${theme}@example.com` });
      assert.match(await row.textContent(), /Observer, free/);
      assert.deepEqual(weave.listInvites().map((i) => [i.email, i.role]), [[`${theme}@example.com`, 'observer']]);
      await row.locator('button', { hasText: 'Revoke' }).click();
      await row.waitFor({ state: 'detached' });
      assert.deepEqual(await eventually(() => weave.listInvites().length, 0), 0);
      await page.close();
    });
  }
}
