import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { launch, styleOf } from './lib/browser.mjs';

let uno, ada, grace;
const s = await launch('account chip', (root) => {
  root.updateWorkspace({ name: 'root' });
  root.createSpace({ name: 'Docs' });
  ada = root.createAccount({ name: 'Ada Lovelace', role: 'editor' }).account;
  root.state.meta.accounts[ada.id].role = 'writer';
  grace = root.createAccount({ name: 'grace@example.com', role: 'observer' }).account;
  uno = new Weave();
  uno.updateWorkspace({ name: 'uno' });
  uno.createSpace({ name: 'Agent' });
  uno.setRequireAuth(true);
}, { server: () => ({ workspaces: { uno } }) });

if (s) {
  const { base, browser, weave: root } = s;
  const unoPath = () => `/w/${uno.state.meta.id}`;

  const open = async (path, { account = ada, theme } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    if (account) await ctx.addCookies([{ name: `wv_session_${root.state.meta.id}`, value: root.createSession(account.id).token, url: base }]);
    if (theme) await ctx.addInitScript((t) => { try { localStorage.setItem('weave-theme', t); } catch {} }, theme);
    const page = await ctx.newPage();
    await page.goto(base + path, { waitUntil: 'load' });
    await page.waitForSelector('#sidebar .nav-account[data-state]', { state: 'attached' });
    return { ctx, page };
  };
  const logoutCalls = (page) => {
    const seen = [];
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/api/auth/logout')) { const u = new URL(r.url()); seen.push(u.pathname + u.search); } });
    return seen;
  };

  test('the identity panel at the sidebar foot shows the account name, initials and role in this workspace', async () => {
    const { ctx, page } = await open('/');
    const chip = page.locator('#sidebar .nav-account-chip');
    assert.equal(await page.locator('#sidebar .nav-account').getAttribute('data-state'), 'signed-in');
    assert.equal((await chip.locator('.nav-account-name').innerText()).trim(), 'Ada Lovelace');
    assert.equal((await chip.locator('.nav-account-role').innerText()).trim(), 'Editor');
    assert.match(await chip.locator('.nav-account-role').getAttribute('class'), /\bk-select\b.*\bhue-blue\b|\bhue-blue\b.*\bk-select\b/, 'the role is a blue chip');
    assert.equal((await chip.locator('.nav-account-av').innerText()).trim(), 'AL');
    assert.equal(await chip.evaluate((n) => n.closest('.nav-pinned')?.lastElementChild?.matches('.nav-identity') && !!n.closest('.nav-identity')), true, 'the panel closes the pinned strip');
    await ctx.close();
  });

  test('the chip never shows an email, even when the account is named by one', async () => {
    const { ctx, page } = await open('/', { account: grace });
    const text = await page.locator('#sidebar .nav-account-chip').innerText();
    assert.ok(!text.includes('@'), `chip text was ${JSON.stringify(text)}`);
    assert.match(text, /grace/);
    assert.match(text, /Observer/);
    await ctx.close();
  });

  test('the menu opens from the keyboard, moves with the arrows and closes on Escape and an outside click', async () => {
    const { ctx, page } = await open('/');
    const chip = page.locator('#sidebar .nav-identity .nav-identity-more');
    await chip.focus();
    await page.keyboard.press('Enter');
    const menu = page.locator('.nav-personal-menu');
    await menu.waitFor();
    assert.equal(await chip.getAttribute('aria-expanded'), 'true');
    const rows = menu.locator('[role="menuitem"]');
    assert.deepEqual((await rows.locator('.wv-menu-label').allInnerTexts()).map((t) => t.trim()), ['Theme', 'Keyboard shortcuts', 'Settings', 'Sign out', 'Sign out everywhere']);
    assert.equal(await rows.nth(3).getAttribute('title'), 'Sign out of root');
    assert.equal(await rows.nth(0).evaluate((n) => n === document.activeElement), true);
    await page.keyboard.press('ArrowDown');
    assert.equal(await rows.nth(1).evaluate((n) => n === document.activeElement), true);
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'detached' });
    assert.equal(await chip.evaluate((n) => n === document.activeElement), true);
    assert.equal(await chip.getAttribute('aria-expanded'), 'false');

    await chip.click();
    await menu.waitFor();
    assert.equal(await styleOf(menu, 'opacity', '1'), '1');
    const m = await menu.boundingBox();
    const vp = page.viewportSize();
    assert.ok(m.x + m.width < vp.width - 120, `menu right edge ${m.x + m.width} stays out of the bottom-right corner reserve`);
    assert.ok(m.y + m.height <= vp.height, 'menu stays on screen');
    await page.locator('#main').click({ position: { x: 400, y: 300 } });
    await menu.waitFor({ state: 'detached' });
    await ctx.close();
  });

  test('sign out of one workspace posts only that workspace\'s logout and lands on its sign-in page', async () => {
    const { ctx, page } = await open(`${unoPath()}/`);
    const calls = logoutCalls(page);
    await page.locator('#sidebar .nav-identity .nav-identity-more').click();
    const row = page.locator('.nav-personal-menu [role="menuitem"][title="Sign out of uno"]');
    await Promise.all([page.waitForURL(`**${unoPath()}/auth?signed-out=1`), row.click()]);
    assert.deepEqual(calls, [`${unoPath()}/api/auth/logout`]);
    await ctx.close();
  });

  test('sign out everywhere sends one logout?everywhere=1 call, whatever the rail holds (Issue #719)', async () => {
    const { ctx, page } = await open('/');
    const calls = logoutCalls(page);
    await page.locator('#sidebar .nav-identity .nav-identity-more').click();
    const row = page.locator('.nav-personal-menu [role="menuitem"]', { hasText: 'Sign out everywhere' });
    await Promise.all([page.waitForURL('**/auth?signed-out=1'), row.click()]);
    assert.deepEqual(calls, ['/api/auth/logout?everywhere=1']);
    await ctx.close();
  });

  test('sign out everywhere falls back to one logout per workspace when the single call answers 404 (Issue #719)', async () => {
    const { ctx, page } = await open('/');
    const calls = logoutCalls(page);
    await page.route('**/api/auth/logout?everywhere=1', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Not found"}' }));
    await page.locator('#sidebar .nav-identity .nav-identity-more').click();
    const row = page.locator('.nav-personal-menu [role="menuitem"]', { hasText: 'Sign out everywhere' });
    await Promise.all([page.waitForURL('**/auth?signed-out=1'), row.click()]);
    assert.equal(calls[0], '/api/auth/logout?everywhere=1');
    assert.deepEqual(calls.slice(1).sort(), ['/api/auth/logout', '/w/uno/api/auth/logout']);
    await ctx.close();
  });

  test('a signed-out walled workspace shows Sign in linking to its sign-in page', async () => {
    const { ctx, page } = await open(`${unoPath()}/`);
    await ctx.clearCookies();
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForSelector('#sidebar .nav-account[data-state="signed-out"]', { state: 'attached' });
    const link = page.locator('#sidebar .nav-account-signin');
    assert.equal((await link.innerText()).trim(), 'Sign in');
    const href = await link.getAttribute('href');
    assert.ok(href.startsWith(`${unoPath()}/auth?next=`), href);
    assert.equal(decodeURIComponent(href.split('next=')[1]), `${unoPath()}/`);
    assert.equal(await page.locator('#sidebar button.nav-account-chip').count(), 0);
    await ctx.close();
  });

  test('an open workspace with nobody signed in says Open access, never an empty gap', async () => {
    const { ctx, page } = await open('/', { account: null });
    const slot = page.locator('#sidebar .nav-account');
    assert.equal(await slot.getAttribute('data-state'), 'none');
    assert.equal((await slot.locator('.nav-account-name').innerText()).trim(), 'Open access');
    assert.notEqual(await styleOf(slot, 'display', 'block'), 'none');
    assert.equal(await page.locator('#sidebar button.nav-account-chip').count(), 0, 'nothing to open: the menu lives on the dots button');
    await ctx.close();
  });

  test('the chip reads in both themes', async () => {
    for (const theme of ['light', 'dark']) {
      const { ctx, page } = await open('/', { theme });
      assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-bs-theme')), theme);
      const name = page.locator('#sidebar .nav-account-name');
      const [fg, bg] = await name.evaluate((n) => {
        const c = getComputedStyle(n).color;
        let p = n;
        while (p && getComputedStyle(p).backgroundColor === 'rgba(0, 0, 0, 0)') p = p.parentElement;
        return [c, p ? getComputedStyle(p).backgroundColor : 'rgb(255, 255, 255)'];
      });
      assert.notEqual(fg, bg, `${theme}: name colour ${fg} differs from its background ${bg}`);
      await ctx.close();
    }
  });
}
