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
import { tempDir } from './lib/temp.mjs';

async function hub({ open = true, limit = 2, clerk = false } = {}) {
  const idp = await startIdp();
  const dir = tempDir('weave-setup-flows-');
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
    await p.goto(`${h.base}/start${how === 'bypass' ? '?setup=skip' : ''}`);
    await step(p, 'account');
    await go(p, 'signin');
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
    assert.equal(await donut(p), null, 'signing in shows no setup donut (Issue #987)');
    await go(p, 'signin');
    await step(p, 'workspace');
    assert.deepEqual(await donut(p), { at: 50, name: 'Workspace' }, 'the donut appears on the workspace step');
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
    assert.deepEqual(await p.locator('main h2').allTextContents(), ['Chat apps', 'Desktop and terminal tools'], 'chat apps lead; desktop clients are disclosed separately');
    const listed = (i) => p.locator('main .apps').nth(i).locator('.app[data-tool] b').allTextContents();
    assert.deepEqual(await listed(0), ['Claude', 'ChatGPT', 'Gemini'], 'Claude leads the chat apps');
    assert.deepEqual(await listed(1), ['Claude Code', 'Codex', 'Antigravity', 'Gemini CLI', 'Something else']);
    assert.equal(await p.locator('.app[data-tool="cursor"], .app[data-tool="vscode"], .app[data-tool="perplexity"]').count(), 0, 'Cursor and VS Code are gone');
    const logos = await p.locator('.app[data-tool]').evaluateAll((apps) => apps.map((a) => { const img = a.querySelector('.app-tile img.logo'); return [a.dataset.tool, img ? img.complete && img.naturalWidth > 0 && new URL(img.src).pathname : null]; }));
    assert.deepEqual(Object.fromEntries(logos), { claude: '/vendor/brands/claude-color.svg', chatgpt: '/vendor/brands/openai.svg', gemini: '/vendor/brands/gemini-color.svg', 'claude-code': '/vendor/brands/claudecode-color.svg', codex: '/vendor/brands/codex-color.svg', antigravity: '/vendor/brands/antigravity-color.svg', 'gemini-cli': '/vendor/brands/geminicli-color.svg', other: null }, 'each named tool shows its own loaded logo; Something else keeps a glyph (Issue #958)');
    assert.equal(await p.locator('main .limits').count(), 0, 'no page-wide plan note: each tile says its own limit (Issue #954)');
    assert.match(await p.locator('.app[data-tool="chatgpt"] small').textContent(), /Business, Enterprise or Edu/, 'the ChatGPT tile names its plans');
    assert.match(await p.locator('.app[data-tool="gemini"] small').textContent(), /US only/, 'the Gemini tile names its accounts');
    const lead = await p.locator('main .lead').textContent();
    assert.match(lead, /agent you already use/);
    assert.ok(lead.trim().split(/\s+/).length <= 16, `the lead is one short line (${lead})`);
    assert.equal(await p.locator('main [data-go="next"]').count(), 0, 'AI setup has no misleading Continue action before a connection');
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
    await p.waitForSelector(':is(tbody tr.entity-row, .wv-list .list-row)');
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
    await p.locator('main details summary').click();
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

  test('login cannot be skipped: the sign-in step offers no skip, and /start?setup=skip still asks for sign-in first, then opens an empty workspace', async () => {
    const p = await page();
    const who = person(openHub, { email: 'bypass@example.com' });
    await p.goto(`${openHub.base}/start`);
    await step(p, 'account');
    assert.equal(await p.locator('main [data-go="bypass"], main [data-go="skip"]').count(), 0, 'nothing on the sign-in step skips it');
    await p.goto(`${openHub.base}/start?setup=skip`);
    await step(p, 'account');
    await go(p, 'signin');
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
      if (at === 'workspace') await p.waitForSelector('.ws-slug-status[data-state="available"]');
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
    await p.mouse.move(0, 0);
    await p.locator('main details summary').click();
    await p.click('.app[data-tool="codex"]');
    assert.match(await p.locator('.steps li[data-at] code').textContent(), /^codex mcp add weave --url http:\/\/localhost:\d+\/w\/no-agent\/mcp$/, 'Codex copies its add command');
    assert.equal(await p.locator('main .btn-primary[data-copy="address"]').textContent(), 'Copy command');
    assert.equal(await p.locator('main [data-go="install"]').count(), 0, 'no install deeplink');
    await go(p, 'skip');
    await step(p, 'done');
    assert.match(await p.locator('main .lead').textContent(), /To connect an AI app later, add this connection address to it: http:\/\/localhost:\d+\/w\/no-agent\/mcp/);
    await p.context().close();
  });

  const artCover = (p) => p.evaluate(() => {
    const stage = document.getElementById('stage');
    const page = document.documentElement;
    if (getComputedStyle(stage).display === 'none') return { hidden: true, fits: page.scrollWidth <= innerWidth };
    const img = stage.querySelector('img');
    const s = stage.getBoundingClientRect();
    const i = img.getBoundingClientRect();
    const pane = document.querySelector('.pane').getBoundingClientRect();
    const style = getComputedStyle(img);
    return {
      hidden: false,
      column: s.left <= pane.right + 1 && s.top <= 0 && s.right >= innerWidth - 1 && s.bottom >= Math.max(innerHeight, page.scrollHeight) - 1,
      art: i.left <= s.left + 0.5 && i.top <= s.top + 0.5 && i.right >= s.right - 0.5 && i.bottom >= s.bottom - 0.5,
      fit: style.objectFit,
      at: style.objectPosition,
    };
  });
  const scrollAll = (p, end) => p.evaluate(async (end) => {
    for (const n of [document.scrollingElement, ...document.querySelectorAll('.setup, .pane')]) n.scrollTop = end ? n.scrollHeight : 0;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, end);
  const artInView = (p) => p.evaluate(() => {
    const s = document.getElementById('stage').getBoundingClientRect();
    return s.top <= 1 && s.bottom >= innerHeight - 1 ? true : JSON.stringify({ top: s.top, bottom: s.bottom, view: innerHeight });
  });

  test('the art fills its whole panel, centered, on every setup step at every desktop size, and hides on a phone (Issue #954)', async () => {
    const p = await page();
    person(openHub);
    const check = async (where) => {
      await p.waitForFunction(() => { const i = document.querySelector('#stage img'); return i.complete && i.naturalWidth > 0; });
      for (const [width, height] of [[1440, 900], [1280, 720], [1440, 1200]]) {
        await p.setViewportSize({ width, height });
        await scrollAll(p, false);
        assert.deepEqual(await artCover(p), { hidden: false, column: true, art: true, fit: 'cover', at: '50% 50%' }, `${where} at ${width}x${height}: the art covers its column from the top of the page to the bottom`);
        await scrollAll(p, true);
        assert.equal(await artInView(p), true, `${where} at ${width}x${height}: scrolled to the end, the art still fills the view`);
        await scrollAll(p, false);
      }
      await p.setViewportSize({ width: 375, height: 812 });
      assert.deepEqual(await artCover(p), { hidden: true, fits: true }, `${where}: a 375 px phone hides the art and nothing scrolls sideways`);
      await p.setViewportSize({ width: 1280, height: 860 });
    };
    await p.goto(`${openHub.base}/start`);
    await step(p, 'account');
    await check('account');
    await go(p, 'signin');
    await step(p, 'workspace');
    await check('workspace');
    await nameIt(p, 'Art Check', 'art-check');
    await step(p, 'work');
    await p.click('.card[data-template="crm"]');
    await check('work');
    await go(p, 'next');
    await step(p, 'agent');
    await check('agent');
    await p.click('.app[data-tool="chatgpt"]');
    await check('agent, ChatGPT chosen');
    await p.context().close();
  });

  test('every link on the connect step has a real target, internal ones resolve to the page they name, and the address is the MCP server (Issue #954)', async () => {
    const p = await page();
    person(openHub);
    await signIn(p, openHub);
    await nameIt(p, 'Link Check', 'link-check');
    await pickWork(p, 'tasks');
    await step(p, 'agent');
    const ids = await p.locator('.app[data-tool]').evaluateAll((b) => b.map((x) => x.dataset.tool));
    const read = () => p.evaluate(() => ({
      anchors: [...document.querySelectorAll('a')].map((a) => ({ text: a.textContent.trim() || a.getAttribute('aria-label') || '', href: a.getAttribute('href') ?? '', abs: a.href })),
      unlabelled: [...document.querySelectorAll('main button')].filter((b) => !(b.textContent.trim() || b.getAttribute('aria-label'))).length,
    }));
    const anchors = new Map();
    const views = [['list', await read()]];
    for (const id of ids) {
      if (await p.locator(`.app[data-tool="${id}"]`).isHidden()) await p.locator("main details summary").click();
      await p.click(`.app[data-tool="${id}"]`);
      await p.waitForSelector('.chosen');
      views.push([id, await read()]);
      if (['claude', 'chatgpt', 'gemini'].includes(id)) {
        assert.equal((await p.locator('.steps li[data-at] code').textContent()).trim(), `${openHub.base}/w/link-check/mcp`, `${id} shows this workspace's MCP address`);
      }
      await go(p, 'change');
      await p.waitForSelector('.app[data-tool]');
    }
    for (const [view, { anchors: list, unlabelled }] of views) {
      assert.equal(unlabelled, 0, `${view}: every button says what it does`);
      for (const a of list) {
        assert.ok(a.text, `${view}: ${a.href} has a label`);
        assert.ok(a.href && a.href !== '#' && !/^javascript:/i.test(a.href), `${view}: "${a.text}" has a real href`);
        anchors.set(a.abs, a.text);
      }
    }
    const mcp = await p.request.get(`${openHub.base}/w/link-check/mcp`);
    assert.equal(mcp.status(), 401, 'the address answers as an MCP server asking for sign-in');
    assert.match(mcp.headers()['www-authenticate'] ?? '', /resource_metadata=/);
    const promise = { weave: /weave/i, Privacy: /<title>Privacy/, Terms: /<title>Terms/ };
    for (const [abs, text] of anchors) {
      if (new URL(abs).origin !== new URL(openHub.base).origin) continue;
      const res = await p.request.get(abs);
      assert.ok(res.status() < 400, `"${text}" (${abs}) answers ${res.status()}`);
      assert.match(await res.text(), promise[text] ?? /./, `"${text}" lands on the page it names`);
    }
    assert.deepEqual([...anchors.values()].sort(), ['Open workspace', 'Privacy', 'Terms', 'weave'], 'the created workspace can be opened before AI setup');
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
    await p.goto(`${openHub.base}/start?pick=1`);
    await step(p, 'list');
    assert.deepEqual(await p.locator('.rows .ws-title').allTextContents(), ['twice']);
    const row = await p.locator('.rows a.ws-row').evaluate((a) => ({
      tile: !!a.querySelector('.ws-tile img, .ws-tile.ws-letter'),
      meta: a.querySelector('.ws-meta').textContent,
      chevron: !!a.querySelector('.ws-go.glyph'),
      height: a.getBoundingClientRect().height,
    }));
    assert.ok(row.tile && row.chevron, 'each row shows the workspace tile and an open affordance (Issue #964)');
    assert.match(row.meta, /\/w\/twice · Architect$/, 'and its address and role');
    assert.ok(row.height >= 44, `the row is a 44px target: ${row.height}`);
    assert.match(await p.locator('.signed-in').textContent(), /Signed in as twice@example\.com/);
    assert.equal(await p.locator('main .btn-primary').count(), 1, 'one primary action');
    await p.setViewportSize({ width: 375, height: 812 });
    const phone = await p.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      small: [...document.querySelectorAll('main a, main button')].filter((n) => n.getBoundingClientRect().height < 44).map((n) => n.textContent.trim()),
    }));
    assert.deepEqual(phone, { overflow: false, small: [] }, 'at 375px nothing scrolls sideways and every target is 44px tall');
    await p.setViewportSize({ width: 1280, height: 860 });
    await go(p, 'new');
    await step(p, 'workspace');
    await p.click('main button:has-text("Back")');
    await step(p, 'list');
    await p.reload();
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
      await p.click('.app[data-tool="chatgpt"]');
      const marks = await p.evaluate(() => [...document.querySelectorAll('#brand-mark svg, .weave-tile svg')]
        .filter((s) => s.getBoundingClientRect().width > 0)
        .map((s) => ({ theme: s.classList.contains('mark-dark') ? 'dark' : 'light', masks: s.querySelectorAll('mask').length, width: Math.round(s.getBoundingClientRect().width) })));
      assert.deepEqual(marks, [{ theme, masks: 2, width: 34 }, { theme, masks: 2, width: 30 }], 'the header and the weave tile each show one masked brand mark in the page theme (Issue #963)');
      await p.context().close();
    });
  }

  test('Clerk in the pane: sign-in comes first, first-time SSO creates the account, Create an account switches forms, and it returns to the next step', async () => {
    const p = await page();
    person(clerkHub);
    await p.goto(`${clerkHub.base}/start#/settings`);
    await step(p, 'account');
    await p.waitForSelector('.pane #clerk-pane [data-fake-clerk="signin"]');
    assert.equal(await p.locator('#clerk-pane').getAttribute('aria-busy'), null, 'the loaded sign-in form is no longer busy');
    assert.equal(await p.evaluate(() => location.hash), '', 'a leftover hash is cleared before Clerk mounts (Issue #933)');
    assert.equal(await p.locator('main [data-go="signin"]').isHidden(), true, 'the provider button steps aside for the mounted form');
    const options = () => p.evaluate(() => ({ mounted: window.__clerkMounted, ...window.__clerkOptions, appearance: !!window.__clerkOptions.appearance?.variables?.colorPrimary, footer: window.__clerkOptions.appearance?.elements?.footerAction?.display }));
    const inn = await options();
    assert.deepEqual([inn.mounted, inn.withSignUp, inn.routing, inn.appearance, inn.footer], ['signin', true, 'virtual', true, 'none'], 'sign-in first; a first-time SSO login becomes a sign-up; Clerk never reads the page hash');
    assert.equal(await p.evaluate(() => window.__clerkLoadedWithUi), true, 'clerk-js 6 is loaded with its UI bundle (Issue #922)');
    assert.match(inn.forceRedirectUrl, /^\/api\/auth\/oidc\/start\?start=1&next=%2Fstart$/);
    assert.equal(inn.signUpForceRedirectUrl, inn.forceRedirectUrl);
    assert.equal(await p.locator('main h1').textContent(), 'Sign in to weave');
    assert.equal(await donut(p), null, 'a returning visitor signs in with no setup donut (Issue #987)');
    assert.equal(await p.locator('main [data-go="switch"]').textContent(), 'Create an account');
    assert.equal(await p.locator('main [data-go="bypass"], main [data-go="skip"]').count(), 0, 'login cannot be skipped');
    await p.click('main [data-go="switch"]');
    await p.waitForSelector('#clerk-pane [data-fake-clerk="signup"]');
    const up = await options();
    assert.deepEqual([up.mounted, up.routing], ['signup', 'virtual']);
    assert.equal(up.signInForceRedirectUrl, up.forceRedirectUrl);
    assert.equal(await p.locator('main h1').textContent(), 'Create your weave account');
    assert.equal(await donut(p), null, 'the create-account form carries no donut either');
    await p.click('main [data-go="switch"]');
    await p.waitForSelector('#clerk-pane [data-fake-clerk="signin"]');
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
    const creating = p.waitForRequest((request) => new URL(request.url()).pathname === '/api/start/workspaces' && request.method() === 'POST');
    await go(p, 'next');
    assert.equal((await creating).postDataJSON().template, picked);
    await step(p, 'agent');
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
    await p.goto(`${openHub.base}/start?pick=1`);
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
    assert.equal((await visibleCards(p))[0], 'empty', 'simple setups are available first');
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
    const creating = p.waitForRequest((request) => new URL(request.url()).pathname === '/api/start/workspaces' && request.method() === 'POST');
    await go(p, 'next');
    assert.equal(Object.hasOwn((await creating).postDataJSON(), 'template'), false, 'Empty creates a workspace without a template');
    await step(p, 'agent');
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
    assert.equal(top, 'recruiting', 'search results precede the simple setup alternatives');
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
    await step(p, 'agent');
    assert.equal(await p.locator('main [data-go="open"]').isVisible(), true, 'keyboard selection creates an accessible workspace');
    await p.close();
  });
  for (const phone of [false, true]) {
    for (const theme of ['light', 'dark']) {
      test(`onboarding recovery and second workspace (${phone ? 'phone' : 'desktop'}, ${theme})`, async () => {
        const p = await page({ phone, theme });
        const suffix = `${phone ? 'phone' : 'desktop'}-${theme}`;
        person(openHub, { email: `recovery-${suffix}@example.com` });
        try {
          await signIn(p, openHub);
          await nameIt(p, `Recovery ${suffix}`, `custom-${suffix}`);
          await p.click('.card[data-template="tasks"]');
          await p.reload();
          await step(p, 'work');
          assert.equal(await p.locator('.card[data-template="tasks"]').getAttribute('aria-pressed'), 'true');
          await p.getByRole('button', { name: 'Back', exact: true }).click();
          await step(p, 'workspace');
          assert.equal(await p.inputValue('input[name="slug"]'), `custom-${suffix}`);
          await p.waitForSelector('.ws-slug-status[data-state="available"]');
          await go(p, 'next');
          await step(p, 'work');
          await go(p, 'next');
          await step(p, 'agent');
          await p.reload();
          await step(p, 'agent');
          assert.equal(await p.locator('main [data-go="open"]').isVisible(), true);
          assert.equal(await p.locator('.app[data-tool="codex"]').isHidden(), true);
          assert.ok(await p.locator('main [data-go="open"]').evaluate((n) => n.getBoundingClientRect().bottom < innerHeight));
          await go(p, 'open');
          await p.waitForSelector('#ws-new', { state: 'attached' });
          if (phone) await p.getByRole('button', { name: 'Open navigation', exact: true }).click();
          await p.locator('#ws-new').click();
          await p.locator('.wv-menu.ws-plus .wv-menu-row', { hasText: 'New workspace' }).click();
          await step(p, 'workspace');
          assert.equal(await p.inputValue('input[name="name"]'), '');
          await p.fill('input[name="name"]', `Second ${suffix}`);
          await p.fill('input[name="slug"]', `second-${suffix}`);
          await p.waitForSelector('.ws-slug-status[data-state="available"]');
          await go(p, 'skip');
          await p.waitForURL(new RegExp(`/w/second-${suffix}/$`));
          assert.equal(await p.locator('.wv-start-new').count(), 1);
        } finally { await p.close(); }
      });
    }
  }

  for (const phone of [false, true]) test(`signup intent survives refresh, login switching and workspace creation (${phone ? 'phone' : 'desktop'})`, async () => {
    const p = await page({ phone });
    person(clerkHub, { email: `intent-${phone ? 'phone' : 'desktop'}@example.com` });
    try {
      await p.goto(`${clerkHub.base}/start?mode=signup`);
      await p.waitForSelector('#clerk-pane[data-mode="signup"]');
      await p.reload();
      await p.waitForSelector('#clerk-pane[data-mode="signup"]');
      await go(p, 'switch');
      await p.waitForSelector('#clerk-pane[data-mode="signin"]');
      await p.reload();
      await p.waitForSelector('#clerk-pane[data-mode="signin"]');
      await go(p, 'switch');
      await p.waitForSelector('#clerk-pane[data-mode="signup"]');
      await p.click('#clerk-pane [data-fake-clerk="google"]');
      await nameIt(p, `Intent ${phone ? 'phone' : 'desktop'}`, `intent-${phone ? 'phone' : 'desktop'}`);
      await go(p, 'skip');
      await p.waitForURL(new RegExp(`/w/intent-${phone ? 'phone' : 'desktop'}/$`));
    } finally { await p.close(); }
  });

  test('blocked session storage does not prevent setup', async () => {
    const p = await page();
    person(openHub, { email: 'blocked-storage@example.com' });
    await p.addInitScript(() => Object.defineProperty(window, 'sessionStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } }));
    try {
      await signIn(p, openHub);
      await nameIt(p, 'Blocked storage', 'blocked-storage');
      await pickWork(p, 'tasks');
      await step(p, 'agent');
      assert.equal(await p.locator('main [data-go="open"]').isVisible(), true);
    } finally { await p.close(); }
  });

  for (const role of ['architect', 'editor', 'observer']) {
    for (const { phone, populated } of [{ phone: false, populated: false }, { phone: true, populated: false }, { phone: false, populated: true }, { phone: true, populated: true }]) {
      test(`invited ${role} in a ${populated ? 'populated' : 'empty'} workspace (${phone ? 'phone' : 'desktop'})`, async () => {
        const suffix = `${role}-${phone ? 'phone' : 'desktop'}-${populated ? 'full' : 'empty'}`;
        const owner = await page();
        person(openHub, { email: `owner-${suffix}@example.com` });
        await signIn(owner, openHub);
        await nameIt(owner, `Invite ${suffix}`, `invite-${suffix}`);
        if (populated) {
          await pickWork(owner, 'tasks');
          await step(owner, 'agent');
          await go(owner, 'open');
        } else await go(owner, 'skip');
        await owner.waitForURL(new RegExp(`/w/invite-${suffix}/`));
        await owner.close();
        const w = openHub.opened(`invite-${suffix}`);
        const email = `invited-${suffix}@example.com`;
        const invite = w.inviteMember({ email, role, issuer: openHub.idp.issuer });
        w.store.close();
        const p = await page({ phone, theme: phone ? 'dark' : 'light' });
        person(openHub, { email });
        try {
          await p.goto(`${openHub.base}/w/invite-${suffix}/api/auth/oidc/start?invite=${invite.code}`);
          await p.waitForSelector('#main .view-header');
          const onboarding = await p.evaluate(async () => (await fetch('api/onboarding')).json());
          assert.equal(onboarding.show, false, 'invited members do not rename the workspace');
          if (populated) assert.equal(await p.locator('.wv-start').count(), 0);
          else if (role === 'architect') assert.equal(await p.locator('.wv-start-new').count(), 1);
          else {
            assert.equal(await p.locator('.wv-start-new, .wv-start-template').count(), 0);
            assert.match(await p.locator('.wv-start').textContent(), /Ask a workspace architect/);
            assert.match(await p.locator('.wv-start').textContent(), new RegExp(`As an ${role}`));
            assert.equal(await p.locator('.nav-add-table:visible').count(), 0);
          }
          assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        } finally { await p.close(); }
      });
    }
  }

  test('expired setup sign-in resumes only after the same identity authenticates', async () => {
    const p = await page();
    const who = person(openHub, { email: 'expired-draft@example.com' });
    try {
      await signIn(p, openHub);
      await nameIt(p, 'Draft team', 'expired-draft');
      await p.context().clearCookies();
      await p.reload();
      await step(p, 'account');
      openHub.idp.signInBrowserAs(who);
      await go(p, 'signin');
      await step(p, 'work');
      await p.getByRole('button', { name: 'Back', exact: true }).click();
      await step(p, 'workspace');
      assert.equal(await p.inputValue('input[name="slug"]'), 'expired-draft');
    } finally { await p.close(); }
  });

}
