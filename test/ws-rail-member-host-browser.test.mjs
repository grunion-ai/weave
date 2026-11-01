import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { launch } from './lib/browser.mjs';

const svg = (fill) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="${fill}"/></svg>`);

let member;
const s = await launch('workspace rail on a member-workspace host', (weave) => {
  weave.markOnboarded();
  weave.state.meta.name = 'net';
  weave.setWorkspaceLogo({ name: 'net.svg', mime: 'image/svg+xml', bytes: svg('navy') });
  member = new Weave();
  member.markOnboarded();
  member.state.meta.name = 'scratch';
}, { server: () => ({ workspaces: { scratch: member }, baseDomain: 'localhost' }) });

if (s) {
  const { weave: net, base, browser } = s;
  const port = new URL(base).port;
  const memberBase = `http://scratch.localhost:${port}`;
  const netId = net.state.meta.id;
  const chip = (page, name) => page.locator(`#ws-list .ws-icon[title^="${name} "]`);

  async function open(theme) {
    const page = await browser.newPage();
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${memberBase}/`);
    await page.waitForSelector('#ws-list .ws-icon');
    await page.waitForLoadState('networkidle');
    return page;
  }

  for (const theme of ['light', 'dark']) {
    test(`${theme}: the default workspace's tile on another workspace's host shows its logo and links home (Issue #907)`, async () => {
      const page = await open(theme);
      try {
        assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
        const img = chip(page, 'net').locator('img');
        assert.equal(await img.count(), 1, 'the net tile keeps its logo image, no letter fallback');
        assert.ok(await img.evaluate((n) => n.complete && n.naturalWidth > 0), `the logo loads from ${await img.getAttribute('src')}`);
        assert.equal(await chip(page, 'net').evaluate((n) => n.classList.contains('ws-letter')), false);
        const href = await chip(page, 'net').evaluate((n) => new URL(n.href).pathname);
        assert.equal(href, '/api/auth/open/net', 'the net tile hops to the net host, not the host workspace (Issue #1263)');
        assert.equal((await page.locator('#ws-name').textContent()).trim(), 'scratch', 'the wordmark names the host workspace');
        assert.ok(await chip(page, 'scratch').evaluate((n) => n.classList.contains('active')), 'the host workspace tile is the active one');
        assert.equal(await chip(page, 'net').evaluate((n) => n.classList.contains('active')), false);
      } finally { await page.close(); }
    });
  }

  test('the default workspace\'s rail menu on another workspace\'s host reads its own record (Issue #907)', async () => {
    const page = await open('light');
    try {
      const read = page.waitForResponse((r) => r.request().method() === 'GET' && /\/api\/workspace$/.test(new URL(r.url()).pathname));
      await chip(page, 'net').click({ button: 'right' });
      const res = await read;
      assert.equal(res.status(), 200);
      assert.equal((await res.json()).id, netId, `the menu read ${res.url()}`);
      await page.waitForSelector('.ws-ctx .wv-menu-row');
    } finally { await page.close(); }
  });
}
