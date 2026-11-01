import test from 'node:test';
import assert from 'node:assert/strict';
import { createOidc } from '../src/oidc.js';
import { launch } from './lib/browser.mjs';

const s = await launch('start setup new', () => {}, { server: () => ({ oidc: createOidc({ issuer: 'https://idp.example.test', clientId: 'test', clientSecret: 'test', name: 'Test' }) }) });

const START = {
  signedIn: true,
  logins: [{ subject: 'user_1', email: 'architect@example.com' }],
  rows: [{ kind: 'workspace', name: 'net', title: 'Net', open: '/w/net/', role: 'architect' }],
  canCreate: true,
  waiting: false,
  openSignup: false,
  accountName: 'Architect',
  base: 'weave.grunion.ai',
  analytics: { key: 'phc_test_key', user: 'user_1' },
};

if (s) {
  const open = async ({ init = null } = {}) => {
    const page = await s.browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    await page.route('**/api/start', (route) => route.fulfill({ json: START }));
    if (init) await page.addInitScript(init);
    await page.goto(`${s.base}/start?setup=new`, { waitUntil: 'networkidle' });
    return page;
  };
  const loaderText = async (page) => {
    const status = page.locator('#start [role="status"]');
    return (await status.count()) ? (await status.first().textContent()) : '';
  };
  const reachesTheNameStep = async (page, how) => {
    assert.doesNotMatch(await loaderText(page), /Loading weave/, `${how}: the setup flow sat on its loader`);
    assert.equal(await page.locator('#start').getAttribute('data-step'), 'workspace', `${how}: the first step should be the workspace name step`);
    await page.locator('input[name="slug"]').waitFor({ timeout: 5000 });
  };

  test('New workspace setup shows its name step with analytics configured', async () => {
    const page = await open();
    try {
      await reachesTheNameStep(page, 'analytics configured');
      assert.deepEqual(page.errors, []);
    } finally { await page.close(); }
  });

  test('New workspace setup shows its name step when the browser refuses cookies', async () => {
    const page = await open({ init: () => {
      Object.defineProperty(document, 'cookie', { get() { throw new Error('blocked'); }, set() { throw new Error('blocked'); } });
    } });
    try {
      await reachesTheNameStep(page, 'cookies unreadable');
      assert.deepEqual(page.errors, [], 'reading the consent cookie must not throw');
    } finally { await page.close(); }
  });

  test('New workspace setup shows its name step when the analytics start throws', async () => {
    const page = await open({ init: () => {
      addEventListener('DOMContentLoaded', () => {
        if (globalThis.WeaveConsent) globalThis.WeaveConsent.start = () => { throw new Error('consent exploded'); };
      });
    } });
    try {
      await reachesTheNameStep(page, 'analytics throwing');
    } finally { await page.close(); }
  });
}
