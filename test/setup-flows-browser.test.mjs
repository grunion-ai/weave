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

async function hub({ open = true, limit = 2, clerk = false } = {}) {
  const idp = await startIdp();
  const dir = mkdtempSync(join(tmpdir(), 'weave-setup-flows-'));
  const taken = new Weave({ path: join(dir, 'harbor.db'), name: 'harbor' });
  taken.state.meta.name = 'harbor';
  taken.setRequireAuth(true);
  taken.save();
  taken.store.close?.();
  const oidc = createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' });
  const s = await launch(`setup flows, ${open ? 'open' : 'invite-only'} sign-up${clerk ? ', Clerk pane' : ''}`, (main) => {
    main.state.meta.name = 'Net';
    main.createAccount({ name: 'operator', role: 'architect' });
    main.setRequireAuth(true);
    main.save();
  }, {
    weave: () => new Weave({ path: join(dir, 'workspace.db'), name: 'Net' }),
    server: () => ({ oidc, openSignup: { on: open, limit }, ...(clerk ? { clerkKey: idp.publishableKey } : {}), limits: { options: 1000, failed: 1000, slugs: 1000 } }),
  });
  const stop = () => { idp.stop(); rmSync(dir, { recursive: true, force: true }); };
  if (!s) { stop(); return null; }
  const base = s.base.replace('127.0.0.1', 'localhost');
  const opened = (name) => new Weave({ path: join(dir, `${name}.db`) });
  return { idp, dir, base, browser: s.browser, opened, stop };
}

const openHub = await hub();
const closedHub = openHub && await hub({ open: false });
const clerkHub = openHub && await hub({ clerk: true });
if (openHub) {
  const { browser } = openHub;
  test.after(() => { openHub.stop(); closedHub.stop(); clerkHub.stop(); });

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
    await p.click(`.card[data-template="${id}"]`);
    await go(p, 'next');
  };
  const mapped = (p) => p.waitForFunction(() => {
    const m = document.querySelector('#work-details .map');
    return !!m && m.querySelectorAll('.map-lines path').length === Number(m.dataset.edges);
  });
  const donut = (p) => p.locator('#progress').evaluate((n) => (n.hidden ? null : { at: Number(n.getAttribute('aria-valuenow')), name: n.querySelector('.progress-name').textContent }));
  const stageArt = (p) => p.locator('#stage').evaluate((n) => n.innerHTML);
  const catalog = (p, edit) => p.route('**/starter-core.js', async (r) => {
    const res = await r.fetch();
    await r.fulfill({ response: res, body: `${await res.text()}\n(${edit})(globalThis.WeaveStarters);` });
  });

  test('guided, desktop: sign up, name, pick sales, watch the build, connect Claude like claude.ai does, land on the first table', async () => {
    const p = await page({ motion: 'no-preference' });
    person(openHub);
    await p.goto(`${openHub.base}/start`);
    await step(p, 'account');
    const art = await stageArt(p);
    assert.match(art, /picture class="radiate"/, 'the right pane carries the radiating-rings asset');
    assert.deepEqual(await donut(p), { at: 25, name: 'Account' }, 'the donut starts at a quarter');
    await go(p, 'signin');
    await nameIt(p, 'Ada Sales', 'ada-sales');
    await step(p, 'work');
    assert.equal((await donut(p)).at, 75);
    assert.ok(!/template/i.test(await p.locator('#progress').textContent()), 'the step is not called Template');
    assert.ok(await p.locator('.card[data-template]').count() >= 4, 'a gallery of kinds of work');
    assert.equal(await p.locator('#work-details').count(), 0, 'no details before a pick');
    await p.click('.card[data-template="crm"]');
    const details = p.locator('#work-details');
    await details.waitFor();
    await mapped(p);
    assert.deepEqual((await details.locator('.map-node').allTextContents()).sort(), ['Companies', 'Contacts'], 'the preview maps the tables the pick creates');
    assert.equal(await details.locator('.map-lines path').count(), 1, 'one line for the one relation');
    assert.equal(await details.locator('.details-like').textContent(), 'Like HubSpot CRM', 'and it says what the template is like');
    assert.equal(await details.locator('.tables, .details-count, small').count(), 0, 'no field lists and no counts');
    assert.doesNotMatch(await details.textContent(), /Website|Stage|sample rows/, 'no field names or stats');
    assert.match(await p.locator('main [data-go="next"]').textContent(), /Sales and clients/, 'the primary button names the pick');
    assert.ok(await p.locator('main [data-go="next"]').isVisible(), 'Continue stays in view under a long gallery');
    assert.equal(await stageArt(p), art, 'the right pane never changes');
    assert.equal(await p.locator('#stage img').evaluate((n) => n.complete && n.naturalWidth > 0), true, 'and it loads');
    await go(p, 'next');
    await step(p, 'build');
    assert.equal(await stageArt(p), art, 'no build animation on the right');
    await p.waitForSelector('.checklist li[data-done]');
    const mid = await donut(p);
    assert.ok(mid.at > 75 && mid.at <= 100, `the donut carries the build (${mid.at})`);
    assert.match(mid.name, /Ada Sales/);
    await step(p, 'agent');
    assert.equal((await donut(p)).at, 100);
    assert.equal(await stageArt(p), art);
    const chat = await p.locator('.app[data-tool]').evaluateAll((ns) => ns.slice(0, 2).map((n) => n.dataset.tool));
    assert.deepEqual(chat, ['claude', 'claude-code'], 'Claude leads the list');
    assert.equal(await p.locator('.app[data-tool="chatgpt"], .app[data-tool="perplexity"], .app[data-tool="gemini"]').count(), 0, 'agents most accounts cannot finish are cut');
    assert.match(await p.locator('main .limits').textContent(), /ChatGPT, the Gemini app and Perplexity/, 'and the page says why');
    assert.match(await p.locator('main .lead').textContent(), /you bring the agent/);
    assert.equal(await p.locator('main [data-go="next"]').count(), 0, 'no way forward but a tool or skip');
    await p.click('.app[data-tool="claude"]');
    assert.equal(await p.locator('.chosen b').textContent(), 'Claude', 'the chosen app heads the step');
    await p.click('main [data-go="change"]');
    await p.click('.app[data-tool="claude"]');
    assert.equal(await p.locator('main .btn-primary[data-copy]').count(), 1, 'one primary copy action before the connection');
    assert.equal(await p.locator('.steps li[data-at] [data-copy="address"]').count(), 1, 'the copy sits on the step that asks for the address');
    assert.equal(await p.locator('main [data-go="skip"]').count(), 1, 'one way to skip');
    assert.equal(await p.locator('.payoff[data-ready]').count(), 0, 'the first message waits for the connection');
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
    await p.waitForSelector('.link .check', { state: 'visible' });
    assert.equal(await p.locator('.payoff[data-ready] .btn-primary[data-copy="first message"]').count(), 1, 'the first message is the payoff once connected');
    assert.equal(await stageArt(p), art);
    await go(p, 'next');
    await step(p, 'done');
    await go(p, 'open');
    await p.waitForURL(/\/w\/ada-sales\/#\/table\//);
    await p.waitForSelector('.wv-grid tbody tr.entity-row');
    assert.equal(await p.locator('.wv-onboard').count(), 0, 'the in-app welcome does not ask the name again');
    await p.context().close();
  });

  test('guided, phone: Empty with a description, Claude Code and the setup prompt, connect like ChatGPT, open', async () => {
    const p = await page({ phone: true });
    person(openHub);
    await signIn(p, openHub);
    await nameIt(p, 'Dog Rescue', 'dog-rescue');
    await step(p, 'work');
    await p.click('.card[data-template="empty"]');
    assert.equal(await p.locator('#work-details #work-other').count(), 1, 'Empty opens an optional description inside its details');
    await p.fill('#work-other', 'dog adoptions, with families and visits');
    await go(p, 'next');
    await step(p, 'agent');
    const fits = () => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    assert.ok(await fits(), 'the app grid fits the phone');
    await p.click('.app[data-tool="claude-code"]');
    assert.match(await p.locator('ol.steps').textContent(), /Run \/mcp/);
    const prompt = await p.locator('.steps pre.prompt').textContent();
    assert.match(prompt, /^Connect yourself to my weave workspace\./);
    assert.ok(prompt.includes(`Its MCP address is ${openHub.base}/w/dog-rescue/mcp`), 'the setup prompt carries this workspace address');
    assert.equal(await p.locator('main .btn-primary[data-copy="address"]').textContent(), 'Copy setup prompt');
    assert.ok(await fits(), 'the steps fit the phone');
    const copy = await p.locator('main [data-copy="address"]').boundingBox();
    assert.ok(copy.x + copy.width <= p.viewportSize().width, 'the copy button fits the phone');
    assert.match(await p.locator('.copybox code.message').textContent(), /for this: dog adoptions, with families and visits/);
    const w = await connectLikeChatApp(`${openHub.base}/w/dog-rescue/mcp`, CHAT_APPS.chatgpt);
    assert.equal(w.trace[0], 'initialize 401');
    await p.waitForSelector('.status[data-state="connected"]', { timeout: 10000 });
    assert.ok(await fits(), 'the connected state fits the phone');
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
    await p.click('.app[data-tool="cursor"]');
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
    await p.click('.card[data-template="tasks"]');
    await go(p, 'next');
    await step(p, 'work');
    assert.match(await p.locator('.alert').textContent(), /weave did not answer/);
    assert.equal(await p.locator('.card[data-template="tasks"]').getAttribute('aria-pressed'), 'true', 'the choice survives');
    await p.waitForSelector('#work-details .map');
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
    assert.equal(await p.locator('#progress').isHidden(), true, 'no donut off the setup steps');
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

  test('Clerk in the pane: account creation renders inside the left pane, styled, switches to sign-in and returns to the next step', async () => {
    const p = await page();
    person(clerkHub);
    await p.goto(`${clerkHub.base}/start`);
    await step(p, 'account');
    await p.waitForSelector('.pane #clerk-pane [data-fake-clerk="signup"]');
    assert.equal(await p.locator('main [data-go="signin"]').isHidden(), true, 'the provider button steps aside for the mounted form');
    const options = () => p.evaluate(() => ({ mounted: window.__clerkMounted, ...window.__clerkOptions, appearance: !!window.__clerkOptions.appearance?.variables?.colorPrimary, footer: window.__clerkOptions.appearance?.elements?.footerAction?.display }));
    const up = await options();
    assert.deepEqual([up.mounted, up.appearance, up.footer], ['signup', true, 'none'], 'account creation first, in weave colours, with weave\'s own switch');
    assert.equal(await p.evaluate(() => window.__clerkLoadedWithUi), true, 'clerk-js 6 is loaded with its UI bundle (Issue #922)');
    assert.match(up.forceRedirectUrl, /^\/api\/auth\/oidc\/start\?start=1&next=%2Fstart$/);
    assert.equal(up.signInForceRedirectUrl, up.forceRedirectUrl);
    const h1 = await p.locator('main h1').textContent();
    assert.equal(await p.locator('main [data-go="switch"]').getAttribute('data-to'), 'signin');
    await p.click('main [data-go="switch"]');
    await p.waitForSelector('#clerk-pane [data-fake-clerk="signin"]');
    const inn = await options();
    assert.equal(inn.mounted, 'signin');
    assert.equal(inn.signUpForceRedirectUrl, inn.forceRedirectUrl);
    assert.notEqual(await p.locator('main h1').textContent(), h1, 'the heading follows the form');
    await p.click('main [data-go="switch"]');
    await p.waitForSelector('#clerk-pane [data-fake-clerk="signup"]');
    await p.click('main [data-go="bypass"]');
    await p.waitForFunction(() => /setup%3Dskip/.test(window.__clerkOptions.forceRedirectUrl));
    assert.equal(await p.evaluate(() => window.__clerkMounted), 'signup', 'the bypass keeps the form the person chose');
    await p.click('main [data-go="bypass"]');
    await p.waitForFunction(() => !/setup%3Dskip/.test(window.__clerkOptions.forceRedirectUrl));
    await p.click('#clerk-pane [data-fake-clerk="google"]');
    await step(p, 'workspace');
    assert.equal((await donut(p)).at, 50);
    await p.context().close();
  });

  test('Clerk in the pane: a Clerk build with no sign-up form mounts sign-in and hides the switch', async () => {
    const p = await page();
    person(clerkHub);
    await p.route('**/clerk.browser.js', async (r) => {
      const res = await r.fetch();
      await r.fulfill({ response: res, body: `${await res.text()}\ndelete window.Clerk.mountSignUp;` });
    });
    await p.goto(`${clerkHub.base}/start`);
    await p.waitForSelector('#clerk-pane [data-fake-clerk="signin"]');
    assert.equal(await p.locator('main [data-go="switch"]').isHidden(), true);
    await p.context().close();
  });

  test('Clerk in the pane: without the UI bundle Clerk cannot mount, so the provider button stays (Issue #922)', async () => {
    const p = await page();
    person(clerkHub);
    await p.route('**/ui.browser.js', (r) => r.abort());
    await p.goto(`${clerkHub.base}/start`);
    await step(p, 'account');
    await p.waitForSelector('main [data-go="signin"]:visible');
    assert.equal(await p.locator('#clerk-pane').isHidden(), true);
    await p.context().close();
  });

  test('Clerk in the pane: a blocked Clerk script falls back to the provider button', async () => {
    const p = await page();
    person(clerkHub);
    await p.route('**/clerk.browser.js', (r) => r.abort());
    await p.goto(`${clerkHub.base}/start`);
    await step(p, 'account');
    await p.waitForSelector('main [data-go="signin"]:visible');
    assert.equal(await p.locator('#clerk-pane').isHidden(), true);
    assert.equal(await p.locator('main [data-go="switch"]').isHidden(), true, 'no switch without the form');
    await go(p, 'signin');
    await step(p, 'workspace');
    await p.context().close();
  });

  test('gallery: categories become chips, a chip narrows the cards, and the details follow the pick', async () => {
    const p = await page();
    await catalog(p, `(S) => {
      S.CATEGORIES = [{ id: 'personal', label: 'Personal', icon: 'lucide:user', blurb: 'Your own life' }, { id: 'team', label: 'Teams', icon: 'lucide:users', blurb: 'Work with others' }];
      S.TEMPLATES.forEach((t, i) => { t.category = i % 2 ? 'team' : 'personal'; t.details = 'Details for ' + t.id + '.'; });
    }`);
    person(openHub);
    await signIn(p, openHub);
    await nameIt(p, 'Gallery', 'gallery-chips');
    await step(p, 'work');
    assert.deepEqual(await p.locator('.chip').allTextContents(), ['All', 'Personal', 'Teams']);
    assert.deepEqual(await p.locator('.shelf:not(.fallback) h2').allTextContents(), ['Personal', 'Teams'], 'All shows each category as its own shelf');
    const all = await p.locator('.card[data-template]:visible').count();
    await p.click('.chip[data-category="team"]');
    const team = await p.locator('.card[data-template]:visible').count();
    assert.ok(team < all && team > 1, `${team} of ${all} cards`);
    assert.equal(await p.locator('.shelf[data-category="personal"]').isHidden(), true);
    await p.click('.shelf[data-category="team"] .card[data-template]');
    const picked = await p.locator('.card[aria-pressed="true"]').getAttribute('data-template');
    assert.equal(await p.locator('#work-details .details-lead').textContent(), `Details for ${picked}.`, 'the details text comes from the catalog');
    await p.click('.chip[data-category="all"]');
    assert.equal(await p.locator('#work-details').isVisible(), true, 'the pick stays open across chips');
    await go(p, 'next');
    await step(p, 'build');
    await p.context().close();
  });

  test('the pick preview is a small table map that fits above the Start button on desktop and on a 375 px phone (Issue #949)', async () => {
    for (const phone of [false, true]) {
      const p = await page({ phone });
      if (phone) await p.setViewportSize({ width: 375, height: 812 });
      const where = phone ? 'phone' : 'desktop';
      person(openHub);
      await signIn(p, openHub);
      await nameIt(p, `Map ${where}`, `map-${where}`);
      await step(p, 'work');
      for (const id of ['projects', 'finance', 'tasks']) {
        await p.click(`.card[data-template="${id}"]`);
        const details = p.locator('#work-details');
        await details.waitFor();
        await mapped(p);
        const box = await p.evaluate(() => {
          const r = (n) => n.getBoundingClientRect();
          const d = r(document.getElementById('work-details'));
          const bar = r(document.querySelector('main .actions.sticky'));
          const nodes = [...document.querySelectorAll('#work-details .map-node')].map(r);
          return { top: d.top, bottom: d.bottom, left: d.left, right: d.right, bar: bar.top, nodes, wide: document.documentElement.scrollWidth, vw: innerWidth };
        });
        assert.ok(box.top >= 0 && box.bottom <= box.bar + 0.5, `${where} ${id}: the whole preview shows above the Start button (${Math.round(box.top)}..${Math.round(box.bottom)}, bar at ${Math.round(box.bar)})`);
        assert.ok(box.nodes.every((n) => n.left >= box.left && n.right <= box.right && n.bottom <= box.bottom), `${where} ${id}: every table sits inside the preview`);
        assert.ok(box.wide <= box.vw, `${where} ${id}: no sideways scroll`);
        assert.equal(await details.locator('.tables, .details-count, small').count(), 0, `${where} ${id}: no field lists and no counts`);
      }
      await p.click('.card[data-template="projects"]');
      await mapped(p);
      const details = p.locator('#work-details');
      assert.deepEqual((await details.locator('.map-node').allTextContents()).sort(), ['Members', 'Projects', 'Tasks']);
      assert.equal(await details.locator('.map-lines path').count(), 3, 'Projects, Tasks and Members link to each other');
      assert.equal(await details.locator('.map-node .glyph').count(), 3, 'each table shows its icon');
      assert.equal(await details.locator('.details-lead').textContent(), 'For a team running several projects at once.');
      assert.equal(await details.locator('.details-like').textContent(), 'Like Asana');
      assert.doesNotMatch(await details.textContent(), /Task count|Status|Lead/, 'no field names');
      assert.ok(await p.locator('main [data-go="next"]').isVisible(), 'Start stays in view');
      await p.context().close();
    }
  });

  test('gallery: a catalog without categories shows one shelf, no chips, and the blurb as details', async () => {
    const p = await page();
    await catalog(p, `(S) => { delete S.CATEGORIES; S.TEMPLATES.forEach((t) => { delete t.category; delete t.details; }); }`);
    person(openHub);
    await signIn(p, openHub);
    await nameIt(p, 'Plain', 'gallery-plain');
    await step(p, 'work');
    assert.equal(await p.locator('.chip').count(), 0);
    assert.equal(await p.locator('.shelf:not(.fallback)').count(), 1);
    await p.click('.card[data-template="tasks"]');
    assert.equal(await p.locator('#work-details .details-lead').textContent(), 'Tasks with status, due date and priority');
    await p.context().close();
  });

  test('billing: a workspace waiting on a plan shows before the next one is named, and the trial shows on the last step', async () => {
    const p = await page();
    const who = person(openHub, { email: 'waits@example.com' });
    await signIn(p, openHub, 'bypass');
    await p.waitForURL(/\/w\/waits\/$/, { timeout: 15000 });
    openHub.idp.signInBrowserAs(who);
    await p.route('**/api/start', async (r) => {
      const res = await r.fetch();
      await r.fulfill({ response: res, json: { ...(await res.json()), waiting: 'waits' } });
    });
    await p.goto(`${openHub.base}/start`);
    await step(p, 'list');
    const note = p.locator('.alert[data-code="waiting"]');
    assert.match(await note.textContent(), /waits needs a plan/);
    assert.match(await note.locator('a[data-go="billing"]').getAttribute('href'), /^\/api\/start\/open\/waits\?to=billing$/);
    assert.equal(await p.locator('main [data-go="new"]').count(), 0, 'no create while the first workspace waits');
    await p.goto(`${openHub.base}/start?setup=new`);
    await step(p, 'workspace');
    assert.equal(await p.locator('.alert[data-code="waiting"]').count(), 1);
    assert.equal(await p.locator('input[name="name"]').count(), 0, 'nothing to name until the plan is in');
    await p.unroute('**/api/start');
    await p.route('**/api/start/workspaces', async (r) => {
      const res = await r.fetch();
      await r.fulfill({ response: res, json: { ...(await res.json()), trial: { endsAt: '2026-10-30T00:00:00Z', daysLeft: 13 } } });
    });
    await p.goto(`${openHub.base}/start?setup=new`);
    await nameIt(p, 'Trial', 'trial-days');
    await pickWork(p, 'tasks');
    await step(p, 'agent');
    await go(p, 'skip');
    await step(p, 'done');
    assert.equal(await p.locator('.trial').textContent(), '13 days left in your trial');
    await p.context().close();
  });

  const visibleCards = (p) => p.locator('.card[data-template]:visible').evaluateAll((ns) => ns.map((n) => n.dataset.template));

  test('gallery search: words match across titles, blurbs, categories and table names, ignoring case and accents, and keep the grouping', async () => {
    const p = await page();
    await catalog(p, `(S) => {
      S.CATEGORIES = [{ id: 'personal', label: 'Personal', icon: 'lucide:user', blurb: 'Your own life' }, { id: 'business', label: 'Business', icon: 'lucide:briefcase', blurb: 'Work' }];
      S.TEMPLATES.forEach((t) => { t.category = ['finance', 'tasks', 'home'].includes(t.id) ? 'personal' : 'business'; });
      delete S.searchText;
    }`);
    person(openHub);
    await signIn(p, openHub);
    await nameIt(p, 'Search', 'gallery-search');
    await step(p, 'work');
    const all = (await visibleCards(p)).length;
    await p.fill('#work-search', 'RÉCRUITING interviews');
    const hits = (await visibleCards(p)).filter((id) => id !== 'empty' && id !== 'basic');
    assert.ok(hits.includes('recruiting') && hits.length < all - 2, `every word must match, case and accents folded, table names included (${hits})`);
    assert.ok(!hits.includes('finance') && !hits.includes('tasks'));
    assert.ok((await p.locator('.shelf:not(.fallback):visible h2').allTextContents()).every((h) => h === 'Business'), 'matches keep their category');
    await p.fill('#work-search', 'personal');
    assert.ok((await visibleCards(p)).includes('finance'), 'the category label is searchable');
    await p.press('#work-search', 'Escape');
    assert.equal(await p.inputValue('#work-search'), '');
    assert.equal((await visibleCards(p)).length, all, 'Escape clears the search');
    assert.equal((await visibleCards(p)).at(-1 - (await p.locator('.card[data-template="basic"]').count())), 'empty', 'the fallbacks stay pinned at the end');
    await p.context().close();
  });

  test('gallery search: no match leaves only Empty and Basic, and Empty carries the query', async () => {
    const p = await page();
    await catalog(p, `(S) => { S.TEMPLATES.push({ ...S.TEMPLATES.find((t) => t.id === 'tasks'), id: 'basic', title: 'Basic', work: 'Basic', blurb: 'Notes and tasks in one table' }); }`);
    person(openHub);
    await signIn(p, openHub);
    await nameIt(p, 'Nothing', 'gallery-nothing');
    await step(p, 'work');
    assert.equal(await p.locator('.shelf:not(.fallback) .card[data-template="basic"]').count(), 0, 'Basic sits with the fallbacks, not in a category');
    await p.fill('#work-search', 'submarine sonar');
    assert.deepEqual(await visibleCards(p), ['empty', 'basic'], 'only the two fallbacks');
    assert.match(await p.locator('.no-match').textContent(), /submarine sonar/);
    await p.click('.card[data-template="empty"]');
    assert.equal(await p.inputValue('#work-other'), 'submarine sonar', 'the query becomes the description');
    await go(p, 'next');
    await step(p, 'build');
    await p.context().close();
  });

  test('gallery search: a catalog without Basic shows Empty alone as the fallback', async () => {
    const p = await page();
    await catalog(p, `(S) => { S.TEMPLATES.splice(0, S.TEMPLATES.length, ...S.TEMPLATES.filter((t) => t.id !== 'basic')); }`);
    person(openHub);
    await signIn(p, openHub);
    await nameIt(p, 'No basic', 'gallery-nobasic');
    await step(p, 'work');
    await p.fill('#work-search', 'zzzz');
    assert.deepEqual(await visibleCards(p), ['empty']);
    await p.context().close();
  });

  test('gallery search: pick from the keyboard, Enter picks the first match and arrows move between cards', async () => {
    const p = await page({ phone: true });
    person(openHub);
    await signIn(p, openHub);
    await nameIt(p, 'Keys', 'gallery-keys');
    await step(p, 'work');
    await p.focus('#work-search');
    await p.waitForFunction(() => { const top = document.getElementById('work-search').getBoundingClientRect().top; return top >= 0 && top < innerHeight / 3; });
    await p.keyboard.type('candidates');
    assert.ok(await p.locator('.card[data-template]:visible').first().evaluate((n) => n.getBoundingClientRect().top < innerHeight * 0.55), 'the first match shows above where the keyboard rises');
    const top = (await visibleCards(p))[0];
    await p.keyboard.press('Enter');
    assert.equal(await p.locator('.card[aria-pressed="true"]').getAttribute('data-template'), top, 'Enter picks the first match');
    assert.equal(await p.evaluate(() => document.activeElement.dataset.template), top);
    await p.keyboard.press('ArrowDown');
    assert.notEqual(await p.evaluate(() => document.activeElement.dataset.template), top, 'ArrowDown moves on');
    await p.keyboard.press('ArrowUp');
    await p.keyboard.press('ArrowUp');
    assert.equal(await p.evaluate(() => document.activeElement.id), 'work-search', 'ArrowUp from the first card returns to the search');
    await p.keyboard.press('Escape');
    await p.keyboard.press('ArrowDown');
    const first = await p.evaluate(() => document.activeElement.dataset.template);
    await p.keyboard.press('Enter');
    assert.equal(await p.locator('.card[aria-pressed="true"]').getAttribute('data-template'), first, 'Enter on a card picks it');
    await go(p, 'next');
    await step(p, 'build');
    await p.close();
  });
}
