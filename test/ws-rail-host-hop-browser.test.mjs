import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { launch } from './lib/browser.mjs';

let member;
let kyle, owner;
const s = await launch('workspace rail hops to each workspace host', (weave) => {
  weave.markOnboarded();
  weave.state.meta.name = 'net';
  kyle = weave.createAccount({ name: 'kyle', role: 'architect' }).account;
  weave.markOnboarded(kyle.id);
  weave.setRequireAuth(true);
  member = new Weave();
  member.markOnboarded();
  member.state.meta.name = 'bandito';
  owner = member.createAccount({ name: 'owner', role: 'architect' }).account;
  member.markOnboarded(owner.id);
  member.setRequireAuth(true);
}, { server: () => ({ workspaces: { bandito: member }, baseDomain: 'localhost' }) });

if (s) {
  const { weave: net, base, browser } = s;
  const port = new URL(base).port;

  async function signedInOnNet({ memberSession = true } = {}) {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: `wv_session_${net.state.meta.id}`, value: net.createSession(kyle.id).token, url: `http://net.localhost:${port}` }]);
    await ctx.addCookies([{ name: 'wv_rail', value: 'bandito', url: `http://net.localhost:${port}` }]);
    if (memberSession) await ctx.addCookies([{ name: `wv_session_${member.state.meta.id}`, value: member.createSession(owner.id).token, url: `http://net.localhost:${port}` }]);
    await ctx.route(/\/api\/auth\/open\//, async (route) => {
      const response = await route.fetch({ maxRedirects: 0 });
      const to = new URL(response.headers().location);
      to.port = port;
      await route.fulfill({ response, headers: { ...response.headers(), location: to.href } });
    });
    const page = await ctx.newPage();
    await page.goto(`http://net.localhost:${port}/`);
    await page.waitForSelector('#ws-list .ws-icon');
    return { ctx, page };
  }

  test('a session on net alone cannot open bandito', async () => {
    const { ctx, page } = await signedInOnNet({ memberSession: false });
    try {
      const tile = page.locator('#ws-list .ws-icon[title^="bandito "]');
      assert.equal(await tile.count(), 0, 'another workspace is absent without its own session or an identity provider');
      const denied = await page.goto(`http://net.localhost:${port}/api/auth/open/bandito`);
      assert.equal(new URL(page.url()).hostname, 'bandito.localhost');
      assert.equal(denied.status(), 401);
      assert.match(await page.textContent('body'), /This workspace requires authentication/);
      assert.equal(await page.locator('#ws-name').count(), 0);
      const schema = await page.request.get(`http://bandito.localhost:${port}/api/schema`);
      assert.equal(schema.status(), 401);
      const there = await ctx.cookies(`http://bandito.localhost:${port}`);
      assert.equal(there.some((c) => c.name.startsWith('wv_session_')), false, 'no session is minted from the other workspace architect');
    } finally { await ctx.close(); }
  });

  test('clicking another workspace in the rail opens it on its own host, still signed in (Issue #1263)', async () => {
    const { ctx, page } = await signedInOnNet();
    try {
      assert.equal((await page.locator('#ws-name').textContent()).trim(), 'net');
      const tile = page.locator('#ws-list .ws-icon[title^="bandito "]');
      assert.equal(await tile.evaluate((n) => n.classList.contains('ws-held')), false, 'bandito opens with its own explicit session');
      await Promise.all([page.waitForURL((u) => u.hostname === 'bandito.localhost' && u.pathname === '/'), tile.click()]);
      await page.waitForFunction(() => document.querySelector('#ws-name')?.textContent.trim() === 'bandito');
      assert.equal(new URL(page.url()).hostname, 'bandito.localhost', 'the address bar names the bandito host');
      const there = await ctx.cookies(`http://bandito.localhost:${port}`);
      assert.ok(there.some((c) => c.name.startsWith('wv_session_')), 'the bandito host holds its own session cookie');
      assert.equal(await page.locator('#ws-list .ws-icon.active').getAttribute('title').then((t) => t.split(' ')[0]), 'bandito');
    } finally { await ctx.close(); }
  });
}
