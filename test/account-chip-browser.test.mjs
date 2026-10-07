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
    if (account) await ctx.addCookies([{ name: 'wv_session', value: root.createSession(account.id).token, url: base }]);
    if (theme) await ctx.addInitScript((t) => { try { localStorage.setItem('weave-theme', t); } catch {} }, theme);
    const page = await ctx.newPage();
    await page.goto(base + path, { waitUntil: 'load' });
    await page.waitForSelector('#sidebar .nav-account[data-state]', { state: 'attached' });
    return { ctx, page };
  };
  const logoutCalls = (page) => {
    const seen = [];
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/api/auth/logout')) seen.push(new URL(r.url()).pathname); });
    return seen;
  };

  test('the chip at the sidebar foot shows the account name, initials and role in this workspace', async () => {
    const { ctx, page } = await open('/');
    const chip = page.locator('#sidebar .nav-account-chip');
    assert.equal(await page.locator('#sidebar .nav-account').getAttribute('data-state'), 'signed-in');
    assert.equal((await chip.locator('.nav-account-name').innerText()).trim(), 'Ada Lovelace');
    assert.equal((await chip.locator('.nav-account-role').innerText()).trim(), 'Editor');
    assert.equal((await chip.locator('.av').innerText()).trim(), 'AL');
    const line = await page.locator('#sidebar .nav-stats-line').boundingBox();
    const box = await chip.boundingBox();
    assert.ok(box.y >= line.y + line.height, `chip top ${box.y} sits below the stats line bottom ${line.y + line.height}`);
    assert.equal(await chip.evaluate((n) => n.closest('.nav-stats')?.lastElementChild?.contains(n)), true);
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
    const chip = page.locator('#sidebar .nav-account-chip');
    await chip.focus();
    await page.keyboard.press('Enter');
    const menu = page.locator('.nav-account-menu');
    await menu.waitFor();
    assert.equal(await chip.getAttribute('aria-expanded'), 'true');
    const rows = menu.locator('[role="menuitem"]');
    assert.deepEqual((await rows.allInnerTexts()).map((t) => t.trim()), ['Sign out of root', 'Sign out everywhere']);
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
    await page.locator('#sidebar .nav-account-chip').click();
    const row = page.locator('.nav-account-menu [role="menuitem"]', { hasText: 'Sign out of uno' });
    await Promise.all([page.waitForURL(`**${unoPath()}/auth?signed-out=1`), row.click()]);
    assert.deepEqual(calls, [`${unoPath()}/api/auth/logout`]);
    await ctx.close();
  });

  test('sign out everywhere posts the logout of every workspace in the rail', async () => {
    const { ctx, page } = await open('/');
    const calls = logoutCalls(page);
    await page.locator('#sidebar .nav-account-chip').click();
    const row = page.locator('.nav-account-menu [role="menuitem"]', { hasText: 'Sign out everywhere' });
    await Promise.all([page.waitForURL('**/auth?signed-out=1'), row.click()]);
    assert.deepEqual([...calls].sort(), ['/api/auth/logout', '/w/uno/api/auth/logout']);
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

  test('an open workspace with nobody signed in shows no chip', async () => {
    const { ctx, page } = await open('/', { account: null });
    const slot = page.locator('#sidebar .nav-account');
    assert.equal(await slot.getAttribute('data-state'), 'none');
    assert.equal(await slot.evaluate((n) => n.childElementCount), 0);
    assert.equal(await styleOf(slot, 'display', 'none'), 'none');
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
