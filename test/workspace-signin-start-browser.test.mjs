import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { Weave } from '../src/engine.js';
import { createOidc } from '../src/oidc.js';
import { launch, phoneBrowser, phoneProfile, PHONE } from './lib/browser.mjs';
import { startIdp } from './lib/idp.mjs';
import { startConnectorPage, CHAT_APPS } from './lib/chat-client.mjs';

const idp = await startIdp({ sessions: true });
const oidc = createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' });
let harbor, deal;
const s = await launch('a signed-out workspace link signs in on the setup page', (main) => {
  main.state.meta.name = 'Net';
  main.createAccount({ name: 'operator', role: 'architect' });
  main.setRequireAuth(true);
  harbor = new Weave();
  harbor.state.meta.name = 'harbor';
  harbor.markOnboarded();
  harbor.createSpace({ name: 'Sales' });
  deal = harbor.createEntity(harbor.createTable({ space: 'Sales', name: 'Deals' }), { name: 'Acme Working Capital' });
  harbor.createAccount({ name: 'eve', role: 'editor' });
  harbor.redeemIdentityInvite(harbor.linkIdentity('eve', { issuer: idp.issuer }).code, { issuer: idp.issuer, subject: 'user_eve' });
  harbor.setRequireAuth(true);
}, { server: () => ({ oidc, clerkKey: idp.publishableKey, baseDomain: 'localhost', workspaces: { harbor }, openSignup: { on: true, limit: 1 }, limits: { options: 1000, failed: 1000, slugs: 1000 } }) });
test.after(() => idp.stop());

if (s) {
  const base = s.base.replace('127.0.0.1', 'localhost');
  const link = `/w/harbor/e/${deal.id}`;
  const arrive = async () => {
    const ctx = await s.browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    page.on('pageerror', (err) => { throw err; });
    const res = await page.goto(`${base}${link}`);
    const landed = new URL(res.url());
    assert.equal(landed.pathname, '/start', `the workspace link lands on the setup page, not ${res.url()}`);
    assert.equal(landed.searchParams.get('next'), link, 'the return path rides along');
    await page.waitForSelector('main#start[data-step="account"] #clerk-pane [data-fake-clerk="signin"]');
    return page;
  };
  const options = (page) => page.evaluate(() => ({ mounted: window.__clerkMounted, ...window.__clerkOptions }));

  test('sign-in from a workspace link happens in the setup pane and returns to the linked row (Issue #994)', async () => {
    idp.signInBrowserAs({ sub: 'user_eve' });
    const page = await arrive();
    try {
      await page.reload();
      await page.waitForSelector('#clerk-pane [data-fake-clerk="signin"]');
      const inn = await options(page);
      assert.equal(inn.forceRedirectUrl, `/w/harbor/api/auth/oidc/start?door=1&next=${encodeURIComponent(link)}`, 'a sign-in goes on to the workspace');
      assert.equal(inn.signUpForceRedirectUrl, '/api/auth/oidc/start?start=1&next=%2Fstart', 'a sign-up goes to onboarding');
      await page.click('#clerk-pane [data-fake-clerk="google"]');
      await page.waitForFunction(() => document.querySelector('#main .name-edit')?.value === 'Acme Working Capital');
      assert.match(new URL(page.url()).pathname, /^\/w\/harbor\//, 'the person is back on the workspace');
      assert.equal(idp.seen.signInPages, 0, 'the provider\'s hosted sign-in page never showed');
    } finally { await page.context().close(); }
  });

  test('already signed in on the setup page, a workspace link goes straight on to the row (Issue #994)', async () => {
    idp.signInBrowserAs({ sub: 'user_eve' });
    const ctx = await s.browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    try {
      await page.goto(`${base}/start?pick=1`);
      await page.waitForSelector('#clerk-pane [data-fake-clerk="signin"]');
      await page.click('#clerk-pane [data-fake-clerk="google"]');
      await page.waitForSelector('main#start[data-step="list"] .rows li');
      await page.goto(`${base}${link}`);
      await page.waitForFunction(() => document.querySelector('#main .name-edit')?.value === 'Acme Working Capital');
      assert.match(new URL(page.url()).pathname, /^\/w\/harbor\//);
      assert.equal(idp.seen.signInPages, 0);
    } finally { await ctx.close(); }
  });

  test('a signed-out start link signs in on the setup pane and goes on to the workspace (Issue #1284)', async () => {
    idp.signInBrowserAs({ sub: 'user_eve' });
    const ctx = await s.browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    try {
      page.on('pageerror', (err) => { throw err; });
      const res = await page.goto(`${base}/api/start/open/harbor`);
      const landed = new URL(res.url());
      assert.equal(landed.pathname, '/start', `the start link lands on the setup page, not ${res.url()}`);
      assert.equal(landed.searchParams.get('next'), '/api/start/open/harbor', 'the link rides along');
      await page.waitForSelector('#clerk-pane [data-fake-clerk="signin"]');
      const inn = await options(page);
      assert.equal(inn.forceRedirectUrl, '/api/auth/oidc/start?start=1&next=%2Fapi%2Fstart%2Fopen%2Fharbor', 'a sign-in goes on to the link');
      const trail = [];
      page.on('request', (r) => { if (r.isNavigationRequest()) trail.push(r.url()); });
      await page.route(/^http:\/\/harbor\.localhost[:/]/, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: 'harbor' }));
      const handed = page.waitForRequest((r) => r.url().includes('/api/auth/handoff'), { timeout: 10_000 }).catch(() => null);
      await page.click('#clerk-pane [data-fake-clerk="google"]');
      const hit = await handed;
      assert.ok(hit, `the sign-in never handed off; navigations: ${trail.join(' -> ')}`);
      const to = new URL(hit.url());
      assert.equal(to.pathname, '/api/auth/handoff', 'the signed-in link hands off to the workspace host');
      assert.ok(to.searchParams.get('code'));
      assert.equal(idp.seen.signInPages, 0, 'the provider\'s hosted sign-in page never showed');
    } finally { await ctx.close(); }
  });

  test('sign-up from a workspace link walks onboarding (Issue #994)', async () => {
    idp.signInBrowserAs({ sub: 'user_new', email: 'new@example.com', email_verified: true });
    const page = await arrive();
    try {
      await page.click('main [data-go="switch"]');
      await page.waitForSelector('#clerk-pane [data-fake-clerk="signup"]');
      await page.reload();
      await page.waitForSelector('#clerk-pane [data-fake-clerk="signup"]');
      const up = await options(page);
      assert.equal(up.forceRedirectUrl, '/api/auth/oidc/start?start=1&next=%2Fstart', 'a new account goes to the setup steps');
      assert.equal(up.signInForceRedirectUrl, `/w/harbor/api/auth/oidc/start?door=1&next=${encodeURIComponent(link)}`, 'switching back to sign-in still returns to the workspace');
      await page.click('#clerk-pane [data-fake-clerk="google"]');
      await page.waitForSelector('main#start[data-step="workspace"]');
      assert.equal(new URL(page.url()).pathname, '/start');
      assert.equal(idp.seen.signInPages, 0, 'the provider\'s hosted sign-up page never showed');
    } finally { await page.context().close(); }
  });
}

{
  const port = await new Promise((resolve) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
  const idp = await startIdp({ sessions: true, host: 'localhost' });
  const oidc = createOidc({ issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret, name: 'Clerk' });
  let harbor, row;
  const s = await launch('one sign-in page behind every door', (main) => {
    main.state.meta.name = 'Net';
    main.markOnboarded();
    main.createAccount({ name: 'owner', role: 'architect' });
    main.createSpace({ name: 'Sales' });
    row = main.createEntity(main.createTable({ space: 'Sales', name: 'Deals' }), { name: 'Acme Working Capital' });
    main.createAccount({ name: 'eve', role: 'editor' });
    main.redeemIdentityInvite(main.linkIdentity('eve', { issuer: idp.issuer }).code, { issuer: idp.issuer, subject: 'user_eve', email: 'eve@example.com' });
    main.setRequireAuth(true);
    main.save();
    harbor = new Weave();
    harbor.state.meta.name = 'harbor';
    harbor.markOnboarded();
    harbor.createAccount({ name: 'skipper', role: 'architect' });
    harbor.setRequireAuth(true);
  }, { server: () => ({ port, origin: `http://localhost:${port}`, oidc, clerkKey: idp.publishableKey, baseDomain: 'localhost', workspaces: { harbor }, openSignup: { on: true, limit: 5 }, limits: { options: 10000, failed: 10000, slugs: 10000 } }) });
  const connector = await startConnectorPage(CHAT_APPS.claude);
  test.after(() => { idp.stop(); connector.stop(); });

  if (s) {
    const apex = `http://localhost:${port}`;
    const net = `http://net.localhost:${port}`;
    const PROFILES = [
      { label: 'desktop light', phone: false, colorScheme: 'light' },
      { label: 'desktop dark', phone: false, colorScheme: 'dark' },
      { label: `${PHONE} light`, phone: true, colorScheme: 'light' },
      { label: `${PHONE} dark`, phone: true, colorScheme: 'dark' },
    ];
    const CANVAS = { light: 'rgb(236, 239, 243)', dark: 'rgb(15, 17, 21)' };
    const PANEL = { light: 'rgb(255, 255, 255)', dark: 'rgb(24, 27, 33)' };
    let serial = 0;

    async function open(profile) {
      const browser = profile.phone ? await phoneBrowser() : s.browser;
      assert.ok(browser, `the ${profile.label} engine did not launch`);
      const ctx = await browser.newContext({ ...(profile.phone ? phoneProfile().page : { viewport: { width: 1280, height: 860 } }), colorScheme: profile.colorScheme, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      page.on('pageerror', (err) => { throw err; });
      return page;
    }

    async function assertPanels(page, profile) {
      await page.waitForSelector('main#start[data-step="account"] #clerk-pane [data-fake-clerk]');
      const look = await page.evaluate(() => {
        const stage = document.getElementById('stage');
        return {
          path: location.pathname,
          host: location.hostname,
          body: getComputedStyle(document.body).backgroundColor,
          pane: getComputedStyle(document.querySelector('.pane')).backgroundColor,
          stage: stage ? getComputedStyle(stage).display : null,
          art: document.querySelector('.radiate img')?.currentSrc ?? '',
          h1: document.querySelector('main h1')?.textContent ?? '',
          email: !!document.querySelector('#clerk-pane input[type="email"]'),
          google: !!document.querySelector('#clerk-pane [data-fake-clerk="google"]'),
        };
      });
      assert.equal(look.path, '/start', 'every door lands on the start page');
      assert.equal(look.host, 'localhost', 'on the apex, never a workspace host');
      assert.equal(look.body, CANVAS[profile.colorScheme], 'the canvas follows the theme');
      assert.equal(look.pane, PANEL[profile.colorScheme], 'the left panel follows the theme');
      if (profile.phone) assert.equal(look.stage, 'none', 'the phone hides the rings panel');
      else {
        assert.notEqual(look.stage, 'none', 'the rings panel shows on desktop');
        assert.match(look.art, new RegExp(`weave-radiate-${profile.colorScheme}\\.svg`), 'the rings match the theme');
      }
      assert.ok(look.google && look.email, 'the pane offers Google and email');
      return look;
    }

    const google = (page) => page.click('#clerk-pane [data-fake-clerk="google"]');
    const eve = () => idp.signInBrowserAs({ sub: 'user_eve', email: 'eve@example.com', email_verified: true });

    for (const profile of PROFILES) {
      test(`${profile.label}: a workspace link opens the start page and returns to the workspace host (Issue #1342)`, async () => {
        eve();
        const page = await open(profile);
        try {
          await page.goto(`${net}/`);
          const look = await assertPanels(page, profile);
          assert.equal(look.h1, 'Sign in to weave');
          const hosted = idp.seen.signInPages;
          await google(page);
          await page.waitForURL((u) => u.hostname === 'net.localhost', { timeout: 15000 });
          await page.waitForSelector('#main');
          assert.equal(idp.seen.signInPages, hosted, 'the hosted page never showed');
        } finally { await page.context().close(); }
      });

      test(`${profile.label}: a row link returns to the exact row`, async () => {
        eve();
        const page = await open(profile);
        try {
          await page.goto(`${net}/e/${row.id}`);
          await assertPanels(page, profile);
          await page.reload();
          await assertPanels(page, profile);
          await google(page);
          await page.waitForFunction(() => document.querySelector('#main .name-edit')?.value === 'Acme Working Capital', null, { timeout: 15000 });
          assert.equal(new URL(page.url()).hostname, 'net.localhost');
        } finally { await page.context().close(); }
      });

      test(`${profile.label}: a hash route survives the door`, async () => {
        eve();
        const page = await open(profile);
        try {
          await page.goto(`${net}/#/settings`);
          await assertPanels(page, profile);
          assert.equal(new URL(page.url()).hash, '#/settings', 'the start page keeps the fragment');
          await google(page);
          await page.waitForURL((u) => u.hostname === 'net.localhost', { timeout: 15000 });
          assert.equal(new URL(page.url()).hash, '#/settings');
        } finally { await page.context().close(); }
      });

      test(`${profile.label}: /auth on a host opens the same page`, async () => {
        const page = await open(profile);
        try {
          await page.goto(`${net}/auth`);
          await assertPanels(page, profile);
        } finally { await page.context().close(); }
      });

      test(`${profile.label}: /start on a host opens the same page (Issue #1343)`, async () => {
        const page = await open(profile);
        try {
          await page.goto(`${net}/start?mode=signup`);
          const look = await assertPanels(page, profile);
          assert.equal(look.h1, 'Create your weave account');
        } finally { await page.context().close(); }
      });

      test(`${profile.label}: switching sign-in and sign-up keeps the destination, and both offer the same methods`, async () => {
        const page = await open(profile);
        try {
          await page.goto(`${net}/e/${row.id}`);
          await assertPanels(page, profile);
          const next = new URL(page.url()).searchParams.get('next');
          assert.match(next, /^\/api\/start\/open\/net\?path=/);
          await page.click('main [data-go="switch"]');
          await page.waitForSelector('#clerk-pane [data-fake-clerk="signup"]');
          await assertPanels(page, profile);
          let at = new URL(page.url());
          assert.deepEqual([at.searchParams.get('mode'), at.searchParams.get('next')], ['signup', next]);
          await page.reload();
          await page.waitForSelector('#clerk-pane [data-fake-clerk="signup"]');
          await page.click('main [data-go="switch"]');
          await page.waitForSelector('#clerk-pane [data-fake-clerk="signin"]');
          at = new URL(page.url());
          assert.deepEqual([at.searchParams.get('mode'), at.searchParams.get('next')], ['signin', next]);
        } finally { await page.context().close(); }
      });

      test(`${profile.label}: an invite link with no login opens the start page, then the chooser, and joins`, async () => {
        serial += 1;
        const sub = `user_invited_${serial}`;
        const email = `${sub}@example.com`;
        idp.signInBrowserAs({ sub, email, email_verified: true });
        const code = s.weave.inviteMember({ email, role: 'editor', issuer: idp.issuer }).code;
        const page = await open(profile);
        try {
          await page.goto(`${net}/api/auth/oidc/start?invite=${code}`);
          await assertPanels(page, profile);
          const hosted = idp.seen.signInPages;
          await page.click('main [data-go="switch"]');
          await page.waitForSelector('#clerk-pane [data-fake-clerk="signup"]');
          const up = await page.evaluate(() => window.__clerkOptions.forceRedirectUrl);
          assert.match(up, /^\/api\/auth\/oidc\/start\?start=1&next=/, 'a new account resumes the invite too');
          assert.ok(decodeURIComponent(up).includes(`invite=${code}`));
          await google(page);
          const accept = page.getByRole('link', { name: new RegExp(email) });
          await accept.waitFor({ timeout: 15000 });
          await accept.click();
          await page.waitForURL((u) => u.hostname === 'net.localhost', { timeout: 15000 });
          assert.ok(s.weave.listAccounts().some((a) => (a.identities ?? []).some((i) => i.subject === sub)), 'the invite was redeemed');
          assert.equal(idp.seen.signInPages, hosted, 'the hosted page never showed');
        } finally { await page.context().close(); }
      });

      test(`${profile.label}: a signed-in person with no access gets a notice naming the workspace (Issue #1331)`, async () => {
        serial += 1;
        idp.signInBrowserAs({ sub: `user_out_${serial}`, email: `out${serial}@example.com`, email_verified: true });
        const page = await open(profile);
        try {
          await page.goto(`${apex}/w/harbor/`);
          await assertPanels(page, profile);
          await google(page);
          const notice = page.locator('.alert[data-code="no_access"]');
          await notice.waitFor({ timeout: 15000 });
          assert.match(await notice.textContent(), /has no access to harbor/);
          assert.equal(new URL(page.url()).pathname, '/start');
          await page.goto(`${net}/e/${row.id}`);
          const again = page.locator('.alert[data-code="no_access"]');
          await again.waitFor({ timeout: 15000 });
          assert.match(await again.textContent(), /has no access to net/);
        await page.goto(`${apex}/start?next=${encodeURIComponent('/w/%E0%A4%A/')}`);
        const malformed = page.locator('.alert[data-code="no_access"]');
        await malformed.waitFor({ timeout: 15000 });
        assert.match(await malformed.textContent(), /has no access to %E0%A4%A/, 'a malformed name shows as typed and the page still boots');
        } finally { await page.context().close(); }
      });

      test(`${profile.label}: the AI app's sign-in shows the weave page and returns through redirect_url`, async () => {
        serial += 1;
        idp.endBrowserSessions();
        idp.sendSignInTo(`${apex}/start`);
        idp.signInBrowserAs({ sub: 'user_eve', email: 'eve@example.com', email_verified: true });
        const page = await open(profile);
        const ctx = page.context();
        try {
          await page.goto(connector.url);
          await page.fill('input[name="url"]', `${apex}/w/Net/mcp`);
          await page.click('#add');
          await page.waitForSelector('#connect');
          const opened = ctx.waitForEvent('page');
          await page.click('#connect');
          const auth = await opened;
          await auth.waitForLoadState();
          await assertPanels(auth, profile);
          const sent = new URL(auth.url()).searchParams.get('redirect_url');
          assert.ok(sent?.startsWith(`${idp.issuer}/oauth/authorize?`), 'Clerk\'s return address rides along');
          const options = await auth.evaluate(() => window.__clerkOptions);
          assert.equal(options.forceRedirectUrl, new URL(sent).href);
          assert.equal(options.signUpForceRedirectUrl, new URL(sent).href);
          await google(auth);
          await auth.waitForSelector('#idp-allow', { timeout: 15000 });
          await auth.click('#idp-allow');
          await auth.waitForSelector('[data-connected]', { timeout: 15000 });
          const done = connector.connected.at(-1);
          assert.deepEqual(done.trace.slice(0, 5), ['initialize 401', 'discovered', 'registered', 'authorized', 'token']);
          assert.ok(done.tools.includes('weave_schema'), 'the trip finishes and the tools answer');
        } finally {
          idp.sendSignInTo(null);
          await ctx.close();
        }
      });
    }

    test('a provider return asking for a fresh login drops the prompt so the pane cannot loop', async () => {
      idp.signInBrowserAs({ sub: 'user_eve', email: 'eve@example.com', email_verified: true });
      const page = await open(PROFILES[0]);
      try {
        const sent = `${idp.issuer}/oauth/authorize?client_id=x&prompt=${encodeURIComponent('login select_account')}&state=y`;
        await page.goto(`${apex}/start?redirect_url=${encodeURIComponent(sent)}`);
        await assertPanels(page, PROFILES[0]);
        const forced = new URL(await page.evaluate(() => window.__clerkOptions.forceRedirectUrl));
        assert.equal(forced.searchParams.get('prompt'), null);
        assert.equal(forced.searchParams.get('state'), 'y');
      } finally { await page.context().close(); }
    });
  }
}
