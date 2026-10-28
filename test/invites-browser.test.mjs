import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually, hold } from './lib/browser.mjs';
import { createOidc } from '../src/oidc.js';

const s = await launch('members and invites', (weave) => {
  weave.updateWorkspace({ name: 'home' });
  weave.markOnboarded();
}, { server: () => ({ oidc: createOidc({ issuer: 'https://idp.test', clientId: 'weave' }) }) });

const strayNull = (page) => page.evaluate(() => {
  const root = document.querySelector('#modal');
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const hits = [];
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (/\bnull\b/.test(n.textContent)) hits.push(n.textContent);
  return hits;
});

if (s) {
  const { base, browser, weave } = s;

  for (const theme of ['light', 'dark']) {
    test(`the home header carries Invite beside the workspace dots, and home has no Members box (${theme}, Issue #759)`, async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
      const invite = page.locator('#main .view-header .wv-invite-btn');
      await invite.waitFor();
      assert.equal((await invite.textContent()).trim(), 'Invite');
      const order = await page.evaluate(() => {
        const head = document.querySelector('#main .view-header');
        const btn = head.querySelector('.wv-invite-btn').getBoundingClientRect();
        const dots = head.querySelector('.dots-btn[title="Workspace actions"]').getBoundingClientRect();
        return { gap: dots.left - btn.right, top: Math.abs((btn.top + btn.bottom) / 2 - (dots.top + dots.bottom) / 2) };
      });
      assert.ok(order.gap >= 0 && order.gap <= 16, `Invite sits just left of the dots (${order.gap}px)`);
      assert.ok(order.top <= 2, `on the same line (${order.top}px)`);
      assert.equal(await page.locator('.wv-members-box').count(), 0, 'no collapsed Members box on home');
      assert.equal(await page.locator('#main .wv-invite-form').count(), 0, 'no invite form on the home page itself');
      await page.close();
    });

    test(`invite, copy the link, revoke from the Invite dialog (${theme}, Issue #759)`, async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
      await page.click('#main .view-header .wv-invite-btn');
      await page.locator('#modal .wv-invite-form').waitFor();
      assert.equal((await page.locator('#modal h2').textContent()).trim(), 'Invite people');
      const top = await page.evaluate(() => {
        const m = document.querySelector('#modal');
        const y = (q) => m.querySelector(q)?.getBoundingClientRect().top ?? null;
        return { form: y('.wv-invite-form'), members: y('.wv-members-sub') };
      });
      assert.ok(top.form < top.members, 'email, role and Invite sit above the lists');
      assert.match(await page.locator('#modal').textContent(), /No one else has joined yet/);
      assert.match(await page.locator('#modal').textContent(), /No pending invites/);
      assert.deepEqual(await strayNull(page), [], 'no stray null in the dialog');
      const face = page.locator('#modal .wv-invite-form .picker-face');
      assert.equal((await face.textContent()).trim(), 'Editor, paid seat', 'Editor is the default');
      await page.fill('#modal .wv-invite-form input[type=email]', `${theme}@example.com`);
      await face.click();
      const opts = page.locator('.chip-pop .chip-pop-row');
      await opts.first().waitFor();
      assert.deepEqual((await opts.allTextContents()).map((t) => t.replace(/^\d+|✓/g, '').trim()), ['Editor, paid seat', 'Observer, free', 'Architect, paid']);
      await opts.filter({ hasText: 'Observer, free' }).click();
      await page.click('#modal .wv-invite-form .wv-invite-send');
      const link = page.locator('#modal .wv-invite-link input');
      await link.waitFor();
      assert.match(await link.inputValue(), /\/api\/auth\/oidc\/start\?invite=wvi_[\w-]+$/);
      assert.match(await page.locator('#modal .wv-invite-note', { hasText: 'Send this link' }).textContent(), /does not send email/);
      assert.deepEqual(await strayNull(page), [], 'no stray null after an invite');
      const row = page.locator('#modal .wv-members .list-row', { hasText: `${theme}@example.com` });
      assert.match(await row.textContent(), /Observer, free/);
      assert.deepEqual(weave.listInvites().map((i) => [i.email, i.role]), [[`${theme}@example.com`, 'observer']]);
      await row.locator('button', { hasText: 'Revoke' }).click();
      assert.equal(weave.listInvites().length, 1, 'a click alone revokes nothing');
      await hold(row.locator('button', { hasText: 'Revoke' }));
      await row.waitFor({ state: 'detached' });
      assert.deepEqual(await eventually(() => weave.listInvites().length, 0), 0);
      assert.deepEqual(await strayNull(page), [], 'no stray null after a revoke');
      await page.close();
    });

    test(`the Workspace actions menu opens the same Invite dialog (${theme}, Issue #759)`, async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
      await page.click('#main .view-header .dots-btn[title="Workspace actions"]');
      const item = page.locator('.wv-menu .wv-menu-row', { hasText: 'Invite people…' });
      await item.waitFor();
      await item.click();
      await page.locator('#modal .wv-invite-form input[type=email]').waitFor();
      assert.equal((await page.locator('#modal h2').textContent()).trim(), 'Invite people');
      await page.fill('#modal .wv-invite-form input[type=email]', `enter-${theme}@example.com`);
      await page.press('#modal .wv-invite-form input[type=email]', 'Enter');
      await page.locator('#modal .wv-invite-link input').waitFor();
      assert.ok(await page.locator('#modal').isVisible(), 'Return invites and keeps the dialog open');
      assert.ok(weave.listInvites().some((i) => i.email === `enter-${theme}@example.com`));
      for (const i of weave.listInvites()) weave.revokeInvite(i.id);
      await page.close();
    });
  }
}
