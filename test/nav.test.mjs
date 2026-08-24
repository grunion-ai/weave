/* Sidebar navigation, driven through a real browser.
   Playwright is not a dependency (house rule: zero runtime deps); it is
   imported dynamically and the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(ROOT, 'public/index.html'), 'utf8');
const APP = readFileSync(join(ROOT, 'public/app.js'), 'utf8');
const CSS = readFileSync(join(ROOT, 'public/style.css'), 'utf8');

/* Source-level contracts, so the browser suite below is not the only thing
   holding the wordmark together on a bare checkout. */
test('the wordmark markup is a link and the rail points it at this workspace', () => {
  assert.match(HTML, /<a id="ws-name"[^>]*href="\/"/, 'the wordmark ships as an anchor');
  const rail = APP.slice(APP.indexOf('async function buildWsRail'), APP.indexOf('async function buildWsRail') + 1400);
  assert.match(rail, /wordmark\.href = wsHomeHref\(\)/,
    'a non-default workspace must link to its own home, not the hub root');
  assert.match(rail, /wordmark\.title = /, 'and say where it goes');
});

test('the wordmark reads as the wordmark until you point at it', () => {
  const rule = CSS.match(/\n\.ws-wordmark \{ color[^}]*\}/)?.[0] ?? '';
  assert.match(rule, /text-decoration: none/, 'no browser-blue underline on the brand');
  assert.match(rule, /cursor: pointer/, 'but it has to look clickable');
  const hover = CSS.match(/\.ws-wordmark:hover[^{]*\{[^}]*\}/)?.[0] ?? '';
  assert.match(hover, /text-decoration: underline/, 'hover is the affordance');
  assert.match(hover, /color: inherit/,
    'and it keeps the wordmark color — nav blue goes muddy on the dark sidebar');
  assert.match(hover, /:focus-visible/, 'the keyboard gets the same affordance');
});

const chromium = await import('playwright')
  .then((pw) => pw.chromium)
  .catch(() => null);

if (!chromium) {
  test('sidebar navigation (browser)', { skip: 'playwright not installed' }, () => {});
} else {
  let server, base, browser, weave, db, entity;

  test.before(async () => {
    weave = new Weave();
    weave.createSpace({ name: 'Scratch' });
    db = weave.createTable({ space: 'Scratch', name: 'Task' });
    entity = weave.createEntity(db.id, { name: 'Deep in the workspace' });
    ({ server } = await startServer(weave, { port: 0 }));
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
  });

  test.after(async () => {
    await browser?.close();
    server?.close();
  });

  /* Kyle, 2026-08-24: "allow clicking the workspace name to take you to the
     workspace entity page in addition to the workspace selector chip." The
     wordmark sat above every page as dead text; the only way home was the
     rail chip or a crumb. */
  test('the workspace wordmark opens the workspace page', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/#/entity/${entity.id}`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.querySelector('#ws-name')?.textContent);
      await page.click('#ws-name');
      await page.waitForSelector('#main .view-title');
      const title = await page.locator('#main .view-title').first().inputValue();
      assert.match(title.trim(), /weave/i, 'the workspace page is the workspace, by name');
      const listed = await page.locator('#main').textContent();
      assert.match(listed, /Activity/, 'and it is the page that carries the workspace-wide tables');
    } finally { await page.close(); }
  });

  test('the wordmark is a real link, so it opens in a new tab like any other', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.querySelector('#ws-name')?.textContent);
      const shape = await page.evaluate(() => {
        const el = document.querySelector('#ws-name');
        return { tag: el.tagName, href: el.getAttribute('href'), cursor: getComputedStyle(el).cursor };
      });
      assert.equal(shape.tag, 'A', 'the wordmark is an anchor, not a click handler on a span');
      assert.equal(shape.href, '/', 'pointing at this workspace home');
      assert.equal(shape.cursor, 'pointer', 'and it looks clickable');
    } finally { await page.close(); }
  });
}
