/* Sidebar navigation, driven through a real browser.
   Playwright is not a dependency (house rule: zero runtime deps); it is
   imported dynamically and the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { launch } from './lib/browser.mjs';

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

/* ---------- the nav kebab (Kyle, 2026-08-31) ----------
   The table row's right edge is a ⋮ menu carrying the table verbs, not the
   entity count. Source and CSS contracts, since Playwright is optional. */

const fnBodyOf = (name) => {
  const at = APP.indexOf(`function ${name}(`);
  assert.ok(at > -1, `app.js has no ${name}()`);
  const next = APP.indexOf('\nfunction ', at + 1);
  return APP.slice(at, next === -1 ? APP.length : next);
};
const CSS_BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const rulesFor = (selector) => {
  const out = {};
  for (const [, sels, body] of CSS_BARE.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!sels.split(',').map((x) => x.trim()).includes(selector)) continue;
    for (const decl of body.split(';')) {
      const i = decl.indexOf(':');
      if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
    }
  }
  return out;
};

test('the sidebar has no relation-map row; the map lives on the workspace and space pages', () => {
  const nav = APP.slice(APP.indexOf('function renderNav()'), APP.indexOf('function renderNav()') + 2400);
  assert.doesNotMatch(nav, /nav-map|#\/map|Relation map/, 'no map link in the nav');
  assert.doesNotMatch(CSS, /\.nav-map\b/, 'and no orphan rule for it');
  assert.match(APP, /hash\.startsWith\('#\/map'\)/, 'the #/map route still resolves for deep links');
  assert.equal((APP.match(/relationMapCard\('Relation map'/g) ?? []).length, 2, 'workspace page and space page each draw the map');
});

test('a table row carries the kebab instead of a count, and registry tables carry neither', () => {
  const nav = fnBodyOf('renderNav');
  const row = nav.slice(nav.indexOf("class: 'nav-db'"), nav.indexOf('nav.append(row)'));
  assert.ok(!/class: 'count'/.test(row), 'the entity count is gone from the row');
  assert.ok(!/entityCount/.test(row), 'and nothing else on the row reads it');
  assert.match(row, /if \(!db\.system\) row\.append\(navTableMenu\(db, space, row\)\)/,
    'the kebab hangs on user tables only — Workspace/Tables and friends take none of its verbs');
});

test('the kebab menu wires every verb to its route', () => {
  const menu = fnBodyOf('navTableMenu');
  const verbs = [
    ['Rename table…', /api\('PATCH', `\/tables\/\$\{db\.id\}`, \{ name \}\)/],
    ['Change icon…', /api\('PATCH', `\/tables\/\$\{db\.id\}`, \{ icon: o\.id \|\| '' \}\)/],
    ['Move to space…', /api\('POST', `\/tables\/\$\{db\.id\}\/move`, \{ space: o\.id \}\)/],
    ['Duplicate table', /api\('POST', `\/tables\/\$\{db\.id\}\/duplicate`\)/],
  ];
  for (const [label, call] of verbs) {
    assert.ok(menu.includes(`label: '${label}'`), `menu lists ${label}`);
    assert.match(menu, call, `${label} reaches its route`);
  }
  assert.match(menu, /hold: 'Delete table'/, 'delete is the house hold-to-confirm, not a plain button');
  assert.match(menu, /api\('DELETE', `\/tables\/\$\{db\.id\}`\)/);
  assert.match(menu, /await loadSchema\(\)/, 'every verb re-reads the schema so the nav redraws');
  assert.match(menu, /location\.hash = `#\/table\/\$\{copy\.id\}`/, 'duplicate opens the copy');
  assert.match(menu, /if \(state\.route\?\.dbId === db\.id\) location\.hash = `#\/space\/\$\{space\.spaceId\}`/,
    'deleting the open table lands on its space, not a dead route');
});

test('the move picker offers other user spaces only', () => {
  const menu = fnBodyOf('navTableMenu');
  assert.match(menu, /state\.schema\.filter\(\(s\) => s\.space !== space\.space && !s\.system\)/);
});

test('the kebab sits inside the row link without following it', () => {
  const menu = fnBodyOf('navTableMenu');
  assert.match(menu, /align: 'right', extraClass: 'nav-db-menu'/, 'right-aligned so the panel stays inside the sidebar');
  assert.match(menu, /wrap\.addEventListener\('click', \(e\) => e\.preventDefault\(\), true\)/,
    'capture-phase preventDefault: the dots button stops propagation, so bubble would never see the click');
});

test('an abandoned rename puts the row back', () => {
  const menu = fnBodyOf('navTableMenu');
  const rename = menu.slice(menu.indexOf("label: 'Rename table…'"), menu.indexOf("label: 'Change icon…'"));
  assert.match(rename, /row\.style\.display = 'none'/, 'the row hides behind the input');
  assert.match(rename, /input\.addEventListener\('blur', \(\) => \{ if \(!input\.disabled && input\.isConnected\) \{ input\.remove\(\); renderNav\(\); \} \}\)/,
    'a blur that is not a commit removes the input and redraws the nav (the shared input only cancels when EMPTY, and a rename starts full)');
});

test('the kebab is hidden until hover, the active row, keyboard focus, or an open menu', () => {
  const base = rulesFor('.nav-db .nav-db-menu');
  assert.equal(base.opacity, '0');
  assert.equal(base['margin-left'], 'auto', 'it takes the right edge the count used to hold');
  for (const sel of ['.nav-db:hover .nav-db-menu', '.nav-db.active .nav-db-menu', '.nav-db .nav-db-menu:focus-within', '.nav-db .nav-db-menu:has(.dl-menu:not(.hidden))']) {
    assert.equal(rulesFor(sel).opacity, '1', `${sel} reveals it`);
  }
  assert.deepEqual(rulesFor('.nav-db .count'), {}, 'the count rule is gone with the count');
});

test('the kebab paints in both themes by inheriting the house menu tokens', () => {
  // The nav rules only place and reveal; every colour comes from .dots-btn /
  // .dl-menu, which read Tabler tokens that flip with data-bs-theme.
  for (const sel of ['.nav-db .nav-db-menu', '.nav-db-menu .dots-btn']) {
    const r = rulesFor(sel);
    for (const k of Object.keys(r)) assert.ok(!/color|background/.test(k), `${sel} must not hard-code ${k}`);
  }
  assert.match(rulesFor('.dl-menu').background ?? '', /var\(--tblr-bg-surface\)/);
  assert.match(rulesFor('.dl-menu .dropdown-item').color ?? '', /var\(--tblr-body-color\)/);
  assert.match(rulesFor('.dl-menu').border ?? '', /var\(--tblr-border-color\)/);
});

let db, entity;

const s = await launch('sidebar navigation', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  db = weave.createTable({ space: 'Scratch', name: 'Task' });
  entity = weave.createEntity(db.id, { name: 'Deep in the workspace' });
});
if (s) {
  const { base, browser, weave } = s;
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
