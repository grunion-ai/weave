/* Issue #313, in a real browser: the deferred boot still boots, in order, and
   a warm load of `/` asks the server for none of the shell's assets.
   Before the fix a warm load revalidated every one of them (32 requests, 24
   answered 304); with content-versioned URLs sent `immutable`, only the
   document itself goes back to the server. Playwright is NOT a dependency of
   weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const s = await launch('asset cache', (weave) => {
  weave.createSpace({ name: 'Sales' });
  weave.createTable({ space: 'Sales', name: 'Deals' });
});

if (s) {
  const { base, browser, server } = s;
  const hits = [];
  server.on('request', (req) => hits.push(req.url));

  test('the deferred boot runs every script in order and renders the home page', async () => {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.home-map');
    const boot = await page.evaluate(() => ({
      blocking: [...document.querySelectorAll('script[src]')].filter((el) => !el.defer && el.type !== 'module').map((el) => el.src),
      globals: ['Vditor', 'chipCore', 'WeaveTerm', 'leanQR'].filter((g) => !(g in window)),
      name: document.querySelector('#ws-name')?.textContent,
    }));
    assert.deepEqual(boot.blocking, [], 'no classic script blocks the parser');
    assert.deepEqual(boot.globals, [], 'every boot global is in place');
    assert.ok(boot.name, 'the workspace name painted');
    assert.deepEqual(errors, []);
    await page.close();
  });

  test('a warm load of / sends only the document back to the server', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    const shell = await page.evaluate(() => [
      ...[...document.querySelectorAll('script[src], link[rel~="stylesheet"][href]')].map((el) => el.src || el.href),
    ].map((u) => new URL(u).pathname + new URL(u).search));
    assert.ok(shell.length >= 25 && shell.every((u) => /\?v=[0-9a-f]{12}$/.test(u)), `every shell asset is versioned: ${shell.join(' ')}`);
    hits.length = 0;
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.home-map');
    const warm = hits.filter((u) => shell.includes(u));
    assert.deepEqual(warm, [], 'a warm load revalidates none of the shell');
    assert.ok(hits.includes('/'), 'the document itself still revalidates');
    await ctx.close();
  });
}
