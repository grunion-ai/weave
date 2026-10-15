import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { createOidc } from '../src/oidc.js';
import { startIdp } from './lib/idp.mjs';
import { launch, phoneBrowser, phonePage } from './lib/browser.mjs';
import { connectLikeChatApp, CHAT_APPS } from './lib/chat-client.mjs';

async function hub({ open = true, limit = 2 } = {}) {
  const idp = await startIdp();
  const dir = mkdtempSync(join(tmpdir(), 'weave-setup-flows-'));
  const taken = new Weave({ path: join(dir, 'harbor.db'), name: 'harbor' });
  taken.state.meta.name = 'harbor';
  taken.setRequireAuth(true);
  taken.save();
  taken.store.close?.();
  const oidc = createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' });
  const s = await launch(`setup flows, ${open ? 'open' : 'invite-only'} sign-up`, (main) => {
    main.state.meta.name = 'Net';
    main.createAccount({ name: 'operator', role: 'architect' });
    main.setRequireAuth(true);
    main.save();
  }, {
    weave: () => new Weave({ path: join(dir, 'workspace.db'), name: 'Net' }),
    server: () => ({ oidc, openSignup: { on: open, limit }, limits: { options: 1000, failed: 1000, slugs: 1000 } }),
  });
  const stop = () => { idp.stop(); rmSync(dir, { recursive: true, force: true }); };
  if (!s) { stop(); return null; }
  const base = s.base.replace('127.0.0.1', 'localhost');
  const opened = (name) => new Weave({ path: join(dir, `${name}.db`) });
  return { idp, dir, base, browser: s.browser, opened, stop };
}

const openHub = await hub();
const closedHub = openHub && await hub({ open: false });
if (openHub) {
  const { browser } = openHub;
  test.after(() => { openHub.stop(); closedHub.stop(); });

  let people = 0;
  const person = (h, extra = {}) => {
    people += 1;
    const claims = { sub: `user_${people}`, email: `person${people}@example.com`, email_verified: true, ...extra };
    h.idp.signInBrowserAs(claims);
    return claims;
  };
  const page = async ({ motion = 'reduce', phone = false, theme = 'light' } = {}) => {
    const ctx = phone ? null : await browser.newContext({ reducedMotion: motion, colorScheme: theme, viewport: { width: 1280, height: 860 } });
    const p = phone ? await phonePage(await phoneBrowser(), { reducedMotion: motion, colorScheme: theme }) : await ctx.newPage();
    p.on('pageerror', (err) => { throw err; });
    return p;
  };
  const step = (p, name) => p.waitForSelector(`main[data-step="${name}"]`, { timeout: 15000 });
  const go = (p, what) => p.click(`main [data-go="${what}"]`);
  const signIn = async (p, h, how = 'signin') => {
    await p.goto(`${h.base}/start`);
    await step(p, 'account');
    await go(p, how);
  };
  const nameIt = async (p, name, slug) => {
    await step(p, 'workspace');
    await p.fill('input[name="name"]', name);
    if (slug) await p.fill('input[name="slug"]', slug);
    await p.waitForSelector('.ws-slug-status[data-state="available"]');
    await go(p, 'next');
  };
  const pickWork = async (p, id) => {
    await step(p, 'work');
    await p.click(`.pick[data-template="${id}"]`);
    await go(p, 'next');
  };

  test('guided, desktop: sign up, name, pick sales, watch the build, connect Claude like claude.ai does, land on the first table', async () => {
    const p = await page({ motion: 'no-preference' });
    person(openHub);
    await signIn(p, openHub);
    await nameIt(p, 'Ada Sales', 'ada-sales');
    await step(p, 'work');
    assert.match(await p.locator('main h1').textContent(), /What kind of work will you track/);
    assert.match(await p.locator('main .lead').textContent(), /template/, 'the step says it is a template setup');
    assert.ok(await p.locator('.pick[data-template]').count() >= 4, 'a list of kinds of work, not three cards');
    await p.click('.pick[data-template="crm"]');
    assert.ok(await p.locator('#stage .loom text').count() >= 2, 'the stage previews the template tables');
    await go(p, 'next');
    await step(p, 'build');
    assert.equal(await p.locator('#stage .loom.weaving').count(), 1, 'the weave setup animation runs while the workspace builds');
    await step(p, 'agent');
    const chat = await p.locator('.pick[data-tool]').evaluateAll((ns) => ns.slice(0, 2).map((n) => n.dataset.tool));
    assert.deepEqual(chat, ['claude', 'chatgpt'], 'chat apps lead the list');
    assert.equal(await p.locator('main [data-go="next"]').count(), 0, 'no way forward but a tool or skip');
    await p.click('.pick[data-tool="claude"]');
    const url = (await p.locator('.copybox code').first().textContent()).trim();
    assert.equal(url, `${openHub.base}/w/ada-sales/mcp`);
    assert.match(await p.locator('.copybox code').nth(1).textContent(), /walk me through the Sales|walk me through the People|walk me through/);
    assert.equal(await p.locator('main [data-go="next"]').isDisabled(), true, 'Continue waits for the agent');
    assert.equal(await p.locator('.status').getAttribute('data-state'), 'waiting');
    const seen = await connectLikeChatApp(url, CHAT_APPS.claude);
    assert.deepEqual(seen.trace.slice(0, 5), ['initialize 401', 'discovered', 'registered', 'authorized', 'token']);
    assert.ok(seen.tools.includes('weave_schema') && seen.tools.length > 10, 'the chat app sees weave tools');
    assert.ok(!seen.schema?.isError, 'and can read the workspace');
    await p.waitForSelector('.status[data-state="connected"]', { timeout: 10000 });
    assert.match(await p.locator('.status').textContent(), /Claude is connected to Ada Sales/);
    await go(p, 'next');
    await step(p, 'done');
    await go(p, 'open');
    await p.waitForURL(/\/w\/ada-sales\/#\/table\//);
    await p.waitForSelector('.wv-grid tbody tr.entity-row');
    assert.equal(await p.locator('.wv-onboard').count(), 0, 'the in-app welcome does not ask the name again');
    await p.context().close();
  });

  test('guided, phone: something else, ChatGPT steps and its own first message, connect, open', async () => {
    const p = await page({ phone: true });
    person(openHub);
    await signIn(p, openHub);
    await nameIt(p, 'Dog Rescue', 'dog-rescue');
    await step(p, 'work');
    await p.click('.pick[data-template="other"]');
    await go(p, 'next');
    assert.equal(await p.locator('#work-other[aria-invalid="true"]').count(), 1, 'an empty description is refused in place');
    await p.fill('#work-other', 'dog adoptions, with families and visits');
    await go(p, 'next');
    await step(p, 'agent');
    await p.click('.pick[data-tool="chatgpt"]');
    assert.match(await p.locator('ol.steps').textContent(), /Add custom MCP server/);
    assert.match(await p.locator('.copybox code').nth(1).textContent(), /for this: dog adoptions, with families and visits/);
    const w = await connectLikeChatApp(`${openHub.base}/w/dog-rescue/mcp`, CHAT_APPS.chatgpt);
    assert.equal(w.trace[0], 'initialize 401');
    await p.waitForSelector('.status[data-state="connected"]', { timeout: 10000 });
    await go(p, 'next');
    await step(p, 'done');
    const box = await p.locator('main [data-go="open"]').boundingBox();
    assert.ok(box.width <= p.viewportSize().width, 'the open button fits the phone');
    await p.close();
  });

  test('bypass: "set it up myself" skips every managed step and opens an empty workspace', async () => {
    const p = await page();
    const who = person(openHub, { email: 'bypass@example.com' });
    await signIn(p, openHub, 'bypass');
    await p.waitForURL(/\/w\/bypass\/$/, { timeout: 15000 });
    const w = openHub.opened('bypass');
    assert.equal(w.listTables().filter((t) => !t.system).length, 0);
    assert.equal(w.listAccounts()[0].identities[0].subject, who.sub);
    w.store.close?.();
    await p.context().close();
  });

  for (const at of ['workspace', 'work']) {
    test(`skip setup on the ${at} step finishes with an empty workspace and opens it`, async () => {
      const p = await page();
      person(openHub, { email: `skip-${at}@example.com` });
      await signIn(p, openHub);
      if (at === 'work') await nameIt(p, `Skip ${at}`, `skip-${at}-chosen`);
      await step(p, at);
      await go(p, 'skip');
      await p.waitForURL(at === 'work' ? /\/w\/skip-work-chosen\/$/ : /\/w\/skip-workspace\/$/, { timeout: 15000 });
      await p.context().close();
    });
  }

  test('skip the agent step: the workspace opens with a note that an agent can connect later', async () => {
    const p = await page();
    person(openHub);
    await signIn(p, openHub);
    await nameIt(p, 'No Agent', 'no-agent');
    await pickWork(p, 'tasks');
    await step(p, 'agent');
    await p.click('.pick[data-tool="cursor"]');
    assert.match(await p.locator('main [data-go="install"]').getAttribute('href'), /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=weave&config=/);
    await go(p, 'skip');
    await step(p, 'done');
    assert.match(await p.locator('main .lead').textContent(), /To connect an AI app later, add this connection address to it: http:\/\/localhost:\d+\/w\/no-agent\/mcp/);
    await p.context().close();
  });

  test('errors: a refused sign-in comes back to the pane, a taken address blocks Continue, a dropped build keeps the choice', async () => {
    const p = await page();
    openHub.idp.signInBrowserAs({ deny: true });
    await signIn(p, openHub);
    await step(p, 'account');
    assert.match(await p.locator('.alert').textContent(), /Sign-in did not finish/);
    assert.equal(new URL(p.url()).search, '', 'the error does not survive a refresh');
    person(openHub);
    await go(p, 'signin');
    await step(p, 'workspace');
    await p.fill('input[name="name"]', 'Harbor');
    await p.waitForSelector('.ws-slug-status[data-state="taken"]');
    assert.equal(await p.locator('main [data-go="next"]').isDisabled(), true);
    await p.fill('input[name="slug"]', 'harbor-dropped');
    await p.waitForSelector('.ws-slug-status[data-state="available"]');
    await go(p, 'next');
    await step(p, 'work');
    await p.route('**/api/start/workspaces', (r) => r.abort());
    await p.click('.pick[data-template="tasks"]');
    await go(p, 'next');
    await step(p, 'work');
    assert.match(await p.locator('.alert').textContent(), /weave did not answer/);
    assert.equal(await p.locator('.pick[data-template="tasks"]').getAttribute('aria-pressed'), 'true', 'the choice survives');
    await p.unroute('**/api/start/workspaces');
    await p.route('**/api/start/workspaces', async (r) => {
      const res = await r.fetch();
      await r.fulfill({ response: res, json: { ...(await res.json()), table: null, templateError: 'simulated' } });
    });
    await go(p, 'next');
    await step(p, 'agent');
    assert.match(await p.locator('.alert').textContent(), /template did not build, so your workspace starts empty/);
    await p.context().close();
  });

  test('returning: someone with a workspace sees it listed, can start another, and Back returns to the list', async () => {
    const p = await page();
    const who = person(openHub, { email: 'twice@example.com' });
    await signIn(p, openHub, 'bypass');
    await p.waitForURL(/\/w\/twice\/$/, { timeout: 15000 });
    openHub.idp.signInBrowserAs(who);
    await p.goto(`${openHub.base}/start`);
    await step(p, 'list');
    assert.deepEqual(await p.locator('.rows a').allTextContents(), ['twice']);
    await go(p, 'new');
    await step(p, 'workspace');
    await p.click('main button:has-text("Back")');
    await step(p, 'list');
    await p.context().close();
  });

  test('closed sign-up: a stranger gets an invite-only page, not a 403', async () => {
    const p = await page();
    person(closedHub);
    await signIn(p, closedHub);
    await step(p, 'closed');
    assert.match(await p.locator('main h1').textContent(), /invite only/);
    assert.equal(await p.locator('#rail').isHidden(), true);
    await p.context().close();
  });

  for (const theme of ['light', 'dark']) {
    test(`${theme}: every step keeps text off its own ground and carries no em dash`, async () => {
      const p = await page({ theme });
      person(openHub);
      await p.goto(`${openHub.base}/start`);
      await step(p, 'account');
      const check = async (where) => {
        const [fg, bg] = await p.locator('.pane').evaluate((n) => [getComputedStyle(n).color, getComputedStyle(n).backgroundColor]);
        assert.notEqual(fg, bg, `${theme} ${where}`);
        assert.ok(!/—/.test(await p.locator('body').innerText()), `${theme} ${where}: no em dash`);
      };
      await check('account');
      await go(p, 'signin');
      await nameIt(p, `Theme ${theme}`, `theme-${theme}`);
      await check('work');
      await pickWork(p, 'finance');
      await step(p, 'agent');
      await check('agent');
      await p.context().close();
    });
  }
}
