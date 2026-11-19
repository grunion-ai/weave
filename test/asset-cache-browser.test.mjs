import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from './lib/browser.mjs';
import { HTML, ROOT, read } from './lib/source.mjs';

const LAZY_CALL = /(?<!function )\blazyScript\(\s*(?:'([^']*)'|"([^"]*)"|(\S))/g;
const lazyCalls = readdirSync(join(ROOT, 'public')).filter((f) => f.endsWith('.js')).flatMap((f) =>
  [...read(`public/${f}`).matchAll(LAZY_CALL)].map((m) => ({ file: f, src: m[1] ?? m[2] ?? null, arg: m[3] })));
const lazyCalled = [...new Set(lazyCalls.filter((c) => c.src).map((c) => c.src))].sort();
const lazyListed = [...(/<template id="lazy-assets">([^]*?)<\/template>/.exec(HTML)?.[1] ?? '').matchAll(/<script src="([^"?]+)"><\/script>/g)].map((m) => m[1]).sort();

test('every script lazyScript loads is listed in the lazy-assets template, so the server stamps its version (Issue #1818)', () => {
  assert.ok(lazyCalled.length >= 17, `the scan finds the lazy loads: ${lazyCalled.join(' ')}`);
  const dynamic = lazyCalls.filter((c) => !c.src);
  assert.deepEqual(dynamic, [], 'every lazyScript call names its file as a literal');
  assert.deepEqual(lazyCalled.filter((src) => !lazyListed.includes(src)), [], 'no lazy load falls back to a bare path');
  assert.deepEqual(lazyListed.filter((src) => !lazyCalled.includes(src)), [], 'the template lists nothing that is never loaded');
});

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
    await page.waitForSelector('.space-home');
    const boot = await page.evaluate(() => ({
      blocking: [...document.querySelectorAll('script[src]')].filter((el) => !el.defer && !el.async && el.type !== 'module').map((el) => el.src),
      globals: ['chipCore', 'WeaveTerm'].filter((g) => !(g in window)),
      name: document.querySelector('#ws-name')?.textContent,
    }));
    const prePaint = /\/(?:theme-boot|ws-boot)\.js/;
    assert.deepEqual(boot.blocking.filter((u) => !prePaint.test(u)), [], 'no classic script blocks the parser');
    assert.deepEqual(boot.blocking.filter((u) => prePaint.test(u)).map((u) => new URL(u).pathname), ['/theme-boot.js', '/ws-boot.js'],
      'the theme (Issue #1714) and the workspace rail (Issue #1283) run before first paint, so they alone block the parser');
    assert.deepEqual(boot.globals, [], 'every boot global is in place');
    assert.equal(await page.waitForFunction(() => 'Vditor' in window, null, { timeout: 15000 }).then(() => true), true, 'the document editor arrives after boot (Issue #989)');
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
    await page.waitForSelector('.space-home');
    const warm = hits.filter((u) => shell.includes(u));
    assert.deepEqual(warm, [], 'a warm load revalidates none of the shell');
    assert.ok(hits.includes('/'), 'the document itself still revalidates');
    await ctx.close();
  });

  test('every lazily loaded script arrives by its versioned name (Issue #1818)', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    const loaded = await page.evaluate(async (files) => {
      await Promise.allSettled(files.map((f) => lazyScript(f)));
      return [...document.querySelectorAll('head > script[src]')].map((el) => new URL(el.src))
        .filter((u) => files.includes(u.pathname)).map((u) => u.pathname + u.search);
    }, lazyCalled);
    assert.deepEqual(loaded.map((u) => u.split('?')[0]).sort(), lazyCalled, 'every lazy script loaded');
    assert.deepEqual(loaded.filter((u) => !/\?v=[0-9a-f]{12}$/.test(u)), [], 'no lazy script loads by its bare path');
    await page.close();
  });
}
