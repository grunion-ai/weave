import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Weave } from '../src/engine.js';
import { createOidc } from '../src/oidc.js';
import { startIdp } from './lib/idp.mjs';
import { launch, phoneBrowser, phoneProfile, PHONE } from './lib/browser.mjs';
import { startConnectorPage, CHAT_APPS } from './lib/chat-client.mjs';
import { tempDir } from './lib/temp.mjs';

const FILE = 'test/onboarding-steps.json';
const baseline = JSON.parse(readFileSync(new URL('./onboarding-steps.json', import.meta.url), 'utf8'));
const METRICS = ['pages', 'signIns', 'consents', 'clicks'];

const idp = await startIdp({ sessions: true, host: 'localhost' });
const dir = tempDir('weave-onboarding-gate-');
const oidc = createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' });
const s = await launch('onboarding gate, sign-up to the first tool call', (main) => {
  main.state.meta.name = 'Net';
  main.createAccount({ name: 'operator', role: 'architect' });
  main.setRequireAuth(true);
  main.save();
}, {
  weave: () => new Weave({ path: join(dir, 'workspace.db'), name: 'Net' }),
  server: () => ({ oidc, openSignup: { on: true, limit: 2 }, clerkKey: idp.publishableKey, limits: { options: 1000, failed: 1000, slugs: 1000 } }),
});
const connector = await startConnectorPage(CHAT_APPS.claude);
test.after(() => { idp.stop(); connector.stop(); rmSync(dir, { recursive: true, force: true }); });

async function walk(ctx, { who, name, slug }) {
  const base = s.base.replace('127.0.0.1', 'localhost');
  let clicks = 0;
  let pages = 0;
  let paneSignIns = 0;
  const signInPagesBefore = idp.seen.signInPages;
  const consentPagesBefore = idp.seen.consentPages;
  const tap = async (locator) => { await locator.click(); clicks += 1; };
  ctx.on('page', (p) => { pages += 1; p.on('pageerror', (err) => { throw err; }); });
  await ctx.addInitScript(() => {
    window.Notification = class {
      static permission = 'granted';
      static requestPermission = async () => 'granted';
      constructor(title, options = {}) { (window.__notified ??= []).push({ title, body: options.body ?? null }); }
    };
  });
  idp.signInBrowserAs({ sub: who, email: `${who}@example.com`, email_verified: true });

  const setup = await ctx.newPage();
  await setup.goto(`${base}/start`);
  await setup.waitForSelector('main[data-step="account"] [data-fake-clerk="google"]');
  paneSignIns += 1;
  await tap(setup.locator('[data-fake-clerk="google"]'));
  await setup.waitForSelector('main[data-step="workspace"]', { timeout: 15000 });
  await setup.fill('input[name="name"]', name);
  await setup.fill('input[name="slug"]', slug);
  await setup.waitForSelector('.ws-slug-status[data-state="available"]');
  await tap(setup.locator('main [data-go="next"]'));
  await setup.waitForSelector('main[data-step="work"]');
  await tap(setup.locator('.card[data-template="crm"]'));
  await tap(setup.locator('main [data-go="next"]'));
  await setup.waitForSelector('main[data-step="agent"] .app[data-tool="claude"]', { timeout: 15000 });
  await tap(setup.locator('.app[data-tool="claude"]'));
  assert.match(await setup.locator('main .handback').textContent(), /sign-in tab/, 'the AI app step says a sign-in tab opens and to come back');
  await tap(setup.locator('main [data-copy="address"]'));
  const address = (await setup.locator('.copybox code').first().textContent()).trim();
  assert.equal(address, `${base}/w/${slug}/mcp`);
  const titleBefore = await setup.title();
  let reloads = 0;
  setup.on('framenavigated', (f) => { if (f === setup.mainFrame()) reloads += 1; });

  const chat = await ctx.newPage();
  await chat.goto(connector.url);
  await chat.fill('input[name="url"]', address);
  await tap(chat.locator('#add'));
  await chat.waitForSelector('#connect');
  const opened = ctx.waitForEvent('page');
  await tap(chat.locator('#connect'));
  const auth = await opened;
  await auth.waitForLoadState();
  const askedToSignIn = await auth.locator('#idp-sign-in').count();
  if (askedToSignIn) await tap(auth.locator('#idp-sign-in'));
  await auth.waitForSelector('#idp-allow');
  await tap(auth.locator('#idp-allow'));
  await auth.waitForSelector('[data-connected]');
  const done = connector.connected.at(-1);
  assert.deepEqual(done.trace.slice(0, 5), ['initialize 401', 'discovered', 'registered', 'authorized', 'token']);
  assert.ok(done.tools.includes('weave_schema') && done.tools.length > 10, 'tools/list answers with weave tools');
  assert.ok(done.schema && !done.schema.isError, 'and one tool call reads the workspace');

  await setup.bringToFront();
  await setup.waitForSelector('.status[data-state="connected"]', { timeout: 10000 });
  assert.equal(reloads, 0, 'the setup tab turns connected on its own, no reload');
  assert.match(await setup.locator('.status').textContent(), new RegExp(`Claude is connected to ${name}`), 'the connected confirmation stays');
  const titleAfter = await setup.title();
  assert.notEqual(titleAfter, titleBefore, 'the setup tab retitles itself once connected');
  assert.equal(titleAfter, '✓ Claude connected');
  const notified = await setup.evaluate(() => window.__notified ?? []);
  assert.equal(notified.length, 1, 'one notification when connected');
  assert.equal(notified[0].title, `Claude connected to ${name}`);
  assert.match(notified[0].body, /weave setup tab/);

  return {
    carried: !askedToSignIn,
    steps: {
      pages,
      signIns: paneSignIns + idp.seen.signInPages - signInPagesBefore,
      consents: idp.seen.consentPages - consentPagesBefore,
      clicks,
    },
  };
}

function ratchet(profile, steps) {
  const pinned = baseline[profile];
  assert.ok(pinned, `${FILE} has no ${profile} row`);
  const rose = METRICS.filter((m) => steps[m] > pinned[m]).map((m) => `${m} ${pinned[m]} -> ${steps[m]}`);
  assert.deepEqual(rose, [], `onboarding on ${profile} got longer: fix it; ${FILE} never goes up`);
  const fell = METRICS.filter((m) => steps[m] < pinned[m]).map((m) => `${m} ${pinned[m]} -> ${steps[m]}`);
  assert.deepEqual(fell, [], `onboarding on ${profile} got shorter: lower ${FILE} to the new counts in this change`);
}

if (s) {
  test('desktop: sign up, set up, connect Claude through a new sign-in tab, first tool call, back to a connected setup tab', async () => {
    const ctx = await s.browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 860 } });
    const run = await walk(ctx, { who: 'gate_desktop', name: 'Gate Desk', slug: 'gate-desk' });
    assert.equal(run.carried, true, 'the sign-in tab reuses the setup session: no second weave sign-in');
    ratchet('desktop', run.steps);
    await ctx.close();
  });

  test(`${PHONE}: the same walk on the phone profile`, async () => {
    const browser = await phoneBrowser();
    if (!browser) throw new Error(`the ${PHONE} engine did not launch`);
    const ctx = await browser.newContext({ ...phoneProfile().page, reducedMotion: 'reduce' });
    const run = await walk(ctx, { who: 'gate_phone', name: 'Gate Phone', slug: 'gate-phone' });
    assert.equal(run.carried, true, 'the sign-in tab reuses the setup session: no second weave sign-in');
    ratchet('phone', run.steps);
    await ctx.close();
  });
}
