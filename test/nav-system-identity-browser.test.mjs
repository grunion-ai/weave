import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { launch } from './lib/browser.mjs';

let uno, ada, unoAda, wfId, usersId;
const s = await launch('nav system space and identity panel', (root) => {
  root.updateWorkspace({ name: 'root' });
  root.createSpace({ name: 'Work' });
  const t = root.createTable({ space: 'Work', name: 'Tasks' });
  for (let i = 0; i < 3; i++) root.createEntity(t.id, { Name: `task ${i}` });
  ada = root.createAccount({ name: 'Ada Lovelace', role: 'editor' }).account;
  wfId = root.getTable('System/Workflows').id;
  usersId = root.getTable('System/Users').id;
  uno = new Weave();
  uno.updateWorkspace({ name: 'uno' });
  uno.createSpace({ name: 'Agent' });
  unoAda = uno.createAccount({ name: 'Ada Lovelace', role: 'architect' }).account;
  uno.setRequireAuth(true);
}, { server: () => ({ workspaces: { uno } }) });

if (s) {
  const { base, browser, weave: root } = s;

  const open = async (path = '/', { account = ada, theme } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    if (account) {
      await ctx.addCookies([
        { name: `wv_session_${root.state.meta.id}`, value: root.createSession(account.id).token, url: base },
        { name: `wv_session_${uno.state.meta.id}`, value: uno.createSession(unoAda.id).token, url: base },
      ]);
    }
    if (theme) await ctx.addInitScript((t) => { try { localStorage.setItem('weave-theme', t); } catch {} }, theme);
    const page = await ctx.newPage();
    await page.goto(base + path, { waitUntil: 'load' });
    await page.waitForSelector('#ws-rail .nav-system a');
    await page.waitForSelector('#sidebar .nav-identity .nav-account[data-state]', { state: 'attached' });
    return { ctx, page };
  };

  for (const theme of ['light', 'dark']) {
    test(`System lives in the workspace rail while expanded, hidden and peeking (${theme})`, async () => {
      const { ctx, page } = await open('/', { theme });
      assert.equal(await page.locator('#sidebar .nav-system').count(), 0);
      const routes = page.locator('#ws-rail .nav-system a');
      assert.deepEqual(await routes.evaluateAll((as) => as.map((a) => [a.getAttribute('aria-label'), a.getAttribute('href')])), [
        ['Workflows', `#/table/${wfId}`], ['Users', `#/table/${usersId}`], ['Activity', '#/activity'], ['Trash', '#/trash'],
      ]);
      for (const route of await routes.all()) {
        assert.equal(await route.isVisible(), true);
        assert.equal(await route.getAttribute('title'), await route.getAttribute('aria-label'));
      }
      await page.evaluate(() => localStorage.setItem('weave-folded-spaces', '["system"]'));
      await page.reload({ waitUntil: 'networkidle' });
      assert.equal(await routes.count(), 4, 'legacy folded System preference cannot hide rail controls');
      await page.click('#nav-collapse');
      assert.equal(await routes.first().isVisible(), false);
      await page.mouse.move(700, 400);
      await page.mouse.move(4, 400);
      await page.waitForSelector('#app.nav-peek');
      assert.equal(await routes.first().isVisible(), true);
      await routes.filter({ hasText: 'Trash' }).click();
      await page.waitForSelector('#app:not(.nav-peek)');
      await page.click('#main .nav-menu');
      await page.waitForSelector('#ws-rail .nav-system a.active');
      assert.equal(await page.locator('#ws-rail .nav-system a[aria-current="page"]').getAttribute('aria-label'), 'Trash');
      await ctx.close();
    });
  }

  for (const theme of ['light', 'dark']) {
    test(`phone System controls remain reachable and close the drawer after navigation (${theme})`, async () => {
      const { ctx, page } = await open('/', { theme });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.click('#main .nav-menu');
      await page.waitForSelector('#app.nav-held');
      const trash = page.locator('#ws-rail .nav-system a[aria-label="Trash"]');
      await trash.scrollIntoViewIfNeeded();
      const bounds = await trash.boundingBox();
      assert.ok(bounds.width >= 44 && bounds.height >= 44);
      await trash.click();
      await page.waitForSelector('#app:not(.nav-peek):not(.nav-held)');
      await page.waitForFunction(() => location.hash === '#/trash');
      assert.equal(await page.locator('#main').evaluate((n) => n.inert), false);
      await ctx.close();
    });
  }

  test('the identity panel shows the name and the role in this workspace, and the role follows a workspace switch', async () => {
    const { ctx, page } = await open();
    const panel = page.locator('#sidebar .nav-identity');
    await panel.locator('.nav-account[data-state="signed-in"]').waitFor({ state: 'attached' });
    assert.equal((await panel.locator('.nav-account-name').innerText()).trim(), 'Ada Lovelace');
    assert.equal((await panel.locator('.nav-account-av').innerText()).trim(), 'AL');
    const role = panel.locator('.nav-account-role');
    assert.equal((await role.innerText()).trim(), 'Editor');
    assert.match(await role.getAttribute('class'), /\bhue-blue\b/);
    const sys = await page.locator('#sidebar .nav-foot').boundingBox();
    const box = await panel.boundingBox();
    assert.ok(box.y >= sys.y + sys.height - 1, 'the panel sits under New space, at the foot');
    await Promise.all([page.waitForURL(`**/w/${uno.state.meta.id}/`), page.locator('#ws-list a.ws-icon', { hasText: 'U' }).click()]);
    await page.waitForSelector('#sidebar .nav-identity .nav-account[data-state="signed-in"]', { state: 'attached' });
    const unoRole = page.locator('#sidebar .nav-identity .nav-account-role');
    assert.equal((await unoRole.innerText()).trim(), 'Architect');
    assert.match(await unoRole.getAttribute('class'), /\bhue-purple\b/);
    await ctx.close();
  });

  test('the rail has no ? or theme button; the ? key and the personal menu open shortcuts and switch the theme', async () => {
    const { ctx, page } = await open('/', { theme: 'auto' });
    assert.equal(await page.locator('#ws-rail #rail-help, #ws-rail #theme-toggle').count(), 0);
    await page.locator('#main').click({ position: { x: 600, y: 400 } });
    await page.keyboard.press('?');
    await page.waitForSelector('#modal.wv-keys');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#modal.wv-keys', { state: 'detached' });

    const more = page.locator('#sidebar .nav-identity .nav-identity-more');
    await more.click();
    const menu = page.locator('.nav-personal-menu');
    await menu.waitFor();
    const labels = (await menu.locator('[role="menuitem"] .wv-menu-label').allInnerTexts()).map((t) => t.trim());
    assert.deepEqual(labels, ['Theme', 'Keyboard shortcuts', 'Settings', 'Sign out', 'Sign out everywhere']);
    const version = (await page.evaluate(() => fetch('/api/health').then((r) => r.json()))).version;
    const signOut = menu.locator('[role="menuitem"]', { hasText: 'Sign out' }).first();
    assert.equal((await signOut.locator('.wv-menu-hint').innerText()).trim(), `v${version}`, 'the version sits quietly beside Sign out');
    await menu.locator('[role="menuitem"]', { hasText: 'Theme' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.bsTheme === 'dark');
    assert.equal(await page.evaluate(() => localStorage.getItem('weave-theme')), 'dark');
    await more.click();
    await menu.waitFor();
    await menu.locator('[role="menuitem"]', { hasText: 'Keyboard shortcuts' }).click();
    await page.waitForSelector('#modal.wv-keys');
    await ctx.close();
  });

  test('an open workspace with nobody signed in still shows the panel and its menu, never an empty gap', async () => {
    const { ctx, page } = await open('/', { account: null });
    const panel = page.locator('#sidebar .nav-identity');
    assert.equal(await panel.locator('.nav-account').getAttribute('data-state'), 'none');
    assert.equal((await panel.locator('.nav-account-name').innerText()).trim(), 'Open access');
    const box = await panel.boundingBox();
    assert.ok(box.height >= 28, `the panel holds its row: ${box.height}px`);
    await panel.locator('.nav-identity-more').click();
    const labels = (await page.locator('.nav-personal-menu [role="menuitem"] .wv-menu-label').allInnerTexts()).map((t) => t.trim());
    assert.deepEqual(labels, ['Theme', 'Keyboard shortcuts', 'Settings']);
    await ctx.close();
  });

  for (const theme of ['light', 'dark']) {
    test(`the System group and the identity panel read in the ${theme} theme`, async () => {
      const { ctx, page } = await open('/', { theme });
      for (const sel of ['#ws-rail .nav-system a', '#sidebar .nav-identity .nav-account-name', '#sidebar .nav-identity .nav-account-role']) {
        const [fg, bg] = await page.locator(sel).first().evaluate((n) => {
          let p = n;
          while (p && getComputedStyle(p).backgroundColor === 'rgba(0, 0, 0, 0)') p = p.parentElement;
          return [getComputedStyle(n).color, p ? getComputedStyle(p).backgroundColor : 'rgb(255, 255, 255)'];
        });
        assert.notEqual(fg, bg, `${theme}: ${sel} colour ${fg} differs from its background ${bg}`);
      }
      await ctx.close();
    });
  }
}
