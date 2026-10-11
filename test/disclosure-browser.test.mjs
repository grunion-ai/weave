import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch, styleOf } from './lib/browser.mjs';

const APP = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('no text-glyph carets and no per-site caret drawing are left', () => {
  assert.doesNotMatch(APP, /[▾▸▴▼]/, 'app.js draws no text-glyph caret');
  assert.doesNotMatch(CSS, /[▾▸▴▼]/, 'style.css draws no text-glyph caret');
  assert.doesNotMatch(CSS, /\.(doc-fold|doc-caret|nav-caret)[^{]*::before/, 'no caret is drawn by a ::before glyph');
  assert.doesNotMatch(CSS, /summary::before/, 'no summary draws its own triangle');
  assert.doesNotMatch(CSS, /\.(doc-fold|doc-caret|nav-caret)[.\w-]*\s*\{[^}]*rotate/, 'only the shared class rotates');
  assert.match(CSS, /:is\(\.wv-disclosure\[aria-expanded="true"\], details\[open\] > summary > \.wv-disclosure\) > \.wv-icon \{ transform: rotate\(90deg\); \}/);
});

let deals, acme;
const s = await launch('disclosure', (weave) => {
  weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deal' });
  weave.addField(deals, { name: 'Amount', type: 'number' });
  acme = weave.createEntity(deals, { name: 'Acme Working Capital', values: { Amount: 1200 } });
  weave.setDoc(acme.id, '# Terms\n\nNet 30.\n\n## Pricing\n\nFlat.\n');
});

const SITES = {
  nav: '#sidebar .nav-caret',
  section: '.doc-section .doc-section-head .doc-caret',
  fields: '.block-head .doc-caret',
  heading: '.doc-fold-layer .doc-fold',
  schema: '.wv-schema > summary > .wv-disclosure',
};

const read = (sel) => {
  const n = document.querySelector(sel);
  if (!n) return null;
  const box = n.getBoundingClientRect();
  const icon = n.querySelector(':scope > .wv-icon');
  const g = icon.querySelector('svg').getBoundingClientRect();
  const ib = icon.getBoundingClientRect();
  return {
    shared: n.classList.contains('wv-disclosure'),
    lucide: icon.classList.contains('mi-chevron-right'),
    w: box.width, h: box.height, gw: Math.round(ib.width), gh: Math.round(ib.height),
    dx: Math.round(((g.left + g.width / 2) - (box.left + box.width / 2)) * 100) / 100,
    dy: Math.round(((g.top + g.height / 2) - (box.top + box.height / 2)) * 100) / 100,
    turn: getComputedStyle(icon).transform,
    color: getComputedStyle(n).color,
    expanded: n.getAttribute('aria-expanded'),
  };
};

const OPEN = 'matrix(0, 1, -1, 0, 0, 0)';

if (s) {
  const { base, browser } = s;

  const settle = (page) => page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));

  test('the four disclosure sites share one 16px chevron in a 24px box, open and closed alike', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      await page.waitForSelector(SITES.schema);
      const schemaClosed = await page.evaluate(read, SITES.schema);
      await page.locator('.wv-schema > summary').click();
      await page.waitForSelector('.wv-schema[open]');
      await settle(page);
      const schemaOpen = await page.evaluate(read, SITES.schema);
      const navOpen = await page.evaluate(read, SITES.nav);

      await page.goto(`${base}/#/entity/${acme.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector(SITES.heading, { timeout: 20000 });
      await page.waitForSelector(SITES.section);
      const open = { schema: schemaOpen, nav: navOpen };
      for (const k of ['section', 'fields', 'heading']) open[k] = await page.evaluate(read, SITES[k]);
      await page.evaluate((sel) => document.querySelector(sel).click(), SITES.heading);
      await page.waitForSelector(`${SITES.heading}.folded`);
      await settle(page);
      const closed = { schema: schemaClosed, heading: await page.evaluate(read, SITES.heading) };
      for (const k of ['section', 'fields']) {
        await page.evaluate((sel) => document.querySelector(sel).click(), SITES[k]);
        await page.waitForSelector(`${SITES[k]}[aria-expanded="false"]`);
      }
      await settle(page);
      for (const k of ['section', 'fields']) closed[k] = await page.evaluate(read, SITES[k]);
      await page.locator(SITES.nav).first().click();
      await page.waitForSelector('#sidebar .nav-caret[aria-expanded="false"]');
      await settle(page);
      closed.nav = await page.evaluate(read, SITES.nav);

      for (const [k, m] of Object.entries(open)) {
        assert.ok(m, `${k}: the disclosure is on the page`);
        assert.ok(m.shared && m.lucide, `${k}: the shared class holds the lucide chevron`);
        assert.deepEqual([m.w, m.h, m.gw, m.gh], [24, 24, 16, 16], `${k}: a 16px chevron in a 24px box`);
        assert.ok(Math.abs(m.dx) <= 0.5 && Math.abs(m.dy) <= 0.5, `${k}: the chevron sits on the box centre (${m.dx}, ${m.dy})`);
        assert.equal(m.turn, OPEN, `${k}: open turns the chevron down`);
        assert.equal(closed[k].turn, 'none', `${k}: closed points it right`);
        assert.deepEqual([closed[k].w, closed[k].h], [24, 24], `${k}: closed keeps the box`);
      }
      for (const k of ['nav', 'section', 'fields', 'heading']) {
        assert.equal(open[k].expanded, 'true', `${k}: aria-expanded reads open`);
        assert.equal(closed[k].expanded, 'false', `${k}: aria-expanded reads closed`);
      }
    } finally { await page.close(); }
  });

  test('hovering a disclosure moves it to body colour on a quiet wash', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${base}/#/entity/${acme.id}`, { waitUntil: 'networkidle' });
      const caret = page.locator(SITES.section).first();
      await caret.waitFor();
      const rest = await caret.evaluate((n) => ({ color: getComputedStyle(n).color, bg: getComputedStyle(n).backgroundColor, body: getComputedStyle(document.body).color }));
      assert.notEqual(rest.color, rest.body, 'muted at rest');
      assert.equal(rest.bg, 'rgba(0, 0, 0, 0)', 'no fill at rest');
      await caret.hover();
      assert.equal(await styleOf(caret, 'color', rest.body), rest.body, 'body colour on hover');
      const bg = await caret.evaluate((n) => getComputedStyle(n).backgroundColor);
      assert.match(bg, /^rgba\(\d+, \d+, \d+, 0\.0\d+\)$/, `a faint wash on hover, got ${bg}`);
    } finally { await page.close(); }
  });

  test('the heading fold sits in the gutter, clear of the heading text', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${base}/#/entity/${acme.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector(SITES.heading, { timeout: 20000 });
      const g = await page.evaluate(() => {
        const fold = document.querySelector('.doc-fold-layer .doc-fold').getBoundingClientRect();
        const h = document.querySelector('.vditor-reset h1, .vditor-reset h2').getBoundingClientRect();
        return { right: fold.right, left: fold.left, mid: fold.top + fold.height / 2, hLeft: h.left, hMid: h.top + h.height / 2 };
      });
      assert.ok(g.right <= g.hLeft, `the fold ends at ${g.right}, the heading starts at ${g.hLeft}`);
      assert.ok(g.left >= 0, 'the fold stays on screen');
      assert.ok(Math.abs(g.mid - g.hMid) <= 1, `the fold centres on its heading (${g.mid} vs ${g.hMid})`);
    } finally { await page.close(); }
  });

  test('at phone width a disclosure answers a 44px touch', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    try {
      await page.goto(`${base}/#/entity/${acme.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector(SITES.section);
      const hit = await page.locator(SITES.section).first().evaluate((n) => {
        const a = getComputedStyle(n, '::after');
        return [a.width, a.height, getComputedStyle(n).width];
      });
      assert.deepEqual(hit, ['44px', '44px', '24px'], 'a 24px chevron box with a 44px hit area');
    } finally { await page.close(); }
  });
}
