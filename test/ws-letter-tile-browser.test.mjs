import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { launch } from './lib/browser.mjs';

let holding, sandbox;
const s = await launch('workspace letter tile', (weave) => {
  weave.markOnboarded();
  weave.state.meta.name = 'main';
  weave.createSpace({ name: 'Notes' });
  holding = new Weave();
  holding.state.meta.name = 'holding';
  holding.markOnboarded();
  holding.createSpace({ name: 'Notes' });
  sandbox = new Weave();
  sandbox.state.meta.name = 'sandbox';
  sandbox.markOnboarded();
}, { server: () => ({ workspaces: { holding, sandbox } }) });

const channel = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = (rgb) => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number); return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b); };
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

if (s) {
  const { base, browser } = s;
  for (const theme of ['light', 'dark']) {
    test(`a workspace without a logo is a filled tile with a white initial (${theme})`, async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      try {
        await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
        await page.goto(`${base}/`, { waitUntil: 'networkidle' });
        await page.waitForSelector('#ws-list .ws-icon.ws-letter');
        const tiles = await page.evaluate(async () => {
          const list = await fetch('/api/workspaces').then((r) => r.json());
          return [...document.querySelectorAll('#ws-list .ws-icon')].map((n) => {
            const cs = getComputedStyle(n);
            const w = list.find((x) => n.getAttribute('href') === (x.default ? '/' : (x.url ?? `/w/${x.id}/`)));
            return {
              name: w?.name, img: !!n.querySelector('img'), text: n.textContent, bg: cs.backgroundColor, color: cs.color,
              hue: [...n.classList].find((c) => c.startsWith('hue-')), want: `hue-${window.chipCore.hueForName(w?.id)}`,
              w: n.getBoundingClientRect().width, radius: cs.borderTopLeftRadius, active: n.classList.contains('active'), shadow: cs.boxShadow,
            };
          });
        });
        assert.ok(tiles.length >= 3, `three workspaces in the rail, saw ${tiles.length}`);
        for (const t of tiles) {
          assert.ok(t.img || t.bg !== 'rgba(0, 0, 0, 0)', `${t.name}: a tile or a logo, not a bare letter`);
          if (t.img) continue;
          assert.equal(t.text, t.name.slice(0, 1).toUpperCase(), `${t.name}: its initial`);
          assert.equal(t.hue, t.want, `${t.name}: the colour is a stable hash of the workspace id`);
          assert.equal(t.color, 'rgb(255, 255, 255)', `${t.name}: a white initial`);
          assert.ok(contrast(t.bg, t.color) >= 4.5, `${t.name}: the initial reads on its tile (${contrast(t.bg, t.color).toFixed(2)})`);
          assert.equal(t.w, 36, `${t.name}: the same 36px as a logo`);
          assert.equal(t.radius, '10px', `${t.name}: the same radius as a logo`);
        }
        const active = tiles.find((t) => t.active);
        assert.ok(active && active.shadow !== 'none', 'the current workspace still reads as active');
      } finally { await page.close(); }
    });
  }

  test('every ramp hue gives a white initial enough contrast', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      const seen = await page.evaluate(() => window.chipCore.RAMP_ORDER.map((h) => {
        const n = document.body.appendChild(Object.assign(document.createElement('span'), { className: `ws-icon ws-letter hue-${h}`, textContent: 'W' }));
        const cs = getComputedStyle(n);
        const out = { h, bg: cs.backgroundColor, color: cs.color };
        n.remove();
        return out;
      }));
      for (const t of seen) assert.ok(contrast(t.bg, t.color) >= 4.5, `${t.h}: ${t.bg} vs ${t.color} is ${contrast(t.bg, t.color).toFixed(2)}`);
    } finally { await page.close(); }
  });

  test('hovering a letter tile still shows, and the breadcrumb mark matches the rail tile', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${base}/w/holding/`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#ws-list .ws-icon.ws-letter.active');
      const other = page.locator('#ws-list .ws-icon.ws-letter:not(.active)').first();
      const rest = await other.evaluate((n) => getComputedStyle(n).filter);
      await other.hover();
      await page.waitForFunction((n) => getComputedStyle(n).filter !== 'none', await other.elementHandle());
      assert.notEqual(await other.evaluate((n) => getComputedStyle(n).filter), rest, 'hover changes the tile without dropping its fill');
      assert.notEqual(await other.evaluate((n) => getComputedStyle(n).backgroundColor), 'rgba(0, 0, 0, 0)');
      await page.waitForSelector('.crumb-ws-letter');
      const pair = await page.evaluate(() => {
        const tile = getComputedStyle(document.querySelector('#ws-list .ws-icon.active'));
        const crumb = getComputedStyle(document.querySelector('.crumb-ws-letter'));
        return { tile: tile.backgroundColor, crumb: crumb.backgroundColor, color: crumb.color };
      });
      assert.equal(pair.crumb, pair.tile, 'the breadcrumb workspace mark wears the rail tile colour');
      assert.equal(pair.color, 'rgb(255, 255, 255)');
    } finally { await page.close(); }
  });
}
