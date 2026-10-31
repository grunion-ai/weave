import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { launch, styleOf } from './lib/browser.mjs';

let holding, sandbox;
const s = await launch('workspace rail in last-opened order', (weave) => {
  weave.markOnboarded();
  weave.state.meta.name = 'main';
  weave.createSpace({ name: 'Notes' });
  holding = new Weave();
  holding.markOnboarded();
  holding.state.meta.name = 'holding';
  sandbox = new Weave();
  sandbox.markOnboarded();
  sandbox.state.meta.name = 'sandbox';
}, { server: () => ({ workspaces: { holding, sandbox } }) });

const channel = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b); };
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

if (s) {
  const { base, browser } = s;
  const railNames = (page) => page.$$eval('#ws-list .ws-icon', (chips) => chips.map((n) => n.getAttribute('title').split(/[\s:]/)[0]));
  const open = async (page, path, name) => {
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
    await page.waitForFunction((n) => document.querySelector('#ws-list .ws-icon')?.getAttribute('title')?.startsWith(`${n} `) && document.querySelector('#ws-name')?.textContent.trim() === n, name);
  };
  const box = (page) => page.locator('#rail-weave').evaluate((n) => { const r = n.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });

  test('the rail lists workspaces in the order this browser last opened them, and never moves the weave home mark (Feature #349)', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    try {
      await open(page, '/', 'main');
      const home = await box(page);
      await open(page, '/w/sandbox/', 'sandbox');
      await open(page, '/w/holding/', 'holding');
      await open(page, '/', 'main');
      assert.deepEqual(await railNames(page), ['main', 'holding', 'sandbox']);
      assert.deepEqual(await box(page), home, 'weave home keeps its place after a reorder');
      await open(page, '/w/sandbox/', 'sandbox');
      assert.deepEqual(await railNames(page), ['sandbox', 'main', 'holding']);
      assert.deepEqual(await box(page), home, 'weave home keeps its place after a second reorder');
      assert.equal(await page.locator('#ws-rail > *').first().getAttribute('id'), 'rail-weave', 'weave home stays first in the rail');
      assert.equal(await page.locator('#ws-list + #ws-new').count(), 1, 'the new-workspace button stays after the list');
      const recent = (await ctx.cookies(base)).find((c) => c.name === 'wv_recent');
      assert.equal(recent?.value, 'sandbox,main,holding');
    } finally { await ctx.close(); }
  });

  test('the current workspace renders first even when the server list puts it last (Feature #349)', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route(/\/api\/workspaces$/, async (route) => {
      const response = await route.fetch();
      const list = await response.json();
      await route.fulfill({ response, json: [...list].sort((a, b) => (a.name === 'holding') - (b.name === 'holding')) });
    });
    const page = await ctx.newPage();
    try {
      await open(page, '/w/holding/', 'holding');
      assert.equal((await railNames(page))[0], 'holding');
    } finally { await ctx.close(); }
  });

  for (const theme of ['light', 'dark']) {
    test(`a held workspace renders as a grey chip that reads session expired (${theme}, Feature #349)`, async () => {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await ctx.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
      await ctx.route(/\/api\/workspaces$/, async (route) => {
        const response = await route.fetch();
        const list = await response.json();
        await route.fulfill({ response, json: [...list, { name: 'ghost', id: 'ghost-id', held: true, open: `${base}/start-here` }] });
      });
      const page = await ctx.newPage();
      try {
        await open(page, '/', 'main');
        const chip = page.locator('#ws-list .ws-icon.ws-held');
        await chip.waitFor();
        assert.equal(await page.locator('html').getAttribute('data-bs-theme'), theme);
        assert.equal(await chip.getAttribute('title'), 'ghost: session expired, click to sign in');
        assert.equal(await chip.getAttribute('aria-label'), 'ghost: session expired, click to sign in');
        assert.equal(await chip.getAttribute('href'), `${base}/start-here`, 'the click still opens through sign-in');
        assert.equal((await chip.textContent()).trim(), 'G');
        assert.equal(await chip.evaluate((n) => [...n.classList].some((c) => c.startsWith('hue-'))), false, 'no workspace hue on a held chip');
        assert.equal(await styleOf(chip, 'borderTopStyle', 'dashed'), 'dashed');
        const background = await chip.evaluate((n) => getComputedStyle(n).backgroundColor);
        const ink = await chip.evaluate((n) => getComputedStyle(n).color);
        const dash = await chip.evaluate((n) => getComputedStyle(n).borderTopColor);
        if (theme === 'light') {
          assert.equal(background, 'rgb(213, 216, 222)');
          assert.equal(ink, 'rgb(75, 80, 96)');
          assert.equal(dash, 'rgb(138, 143, 156)');
        }
        assert.ok(contrast(ink, background) >= 4.5, `the letter reads at ${contrast(ink, background).toFixed(2)}:1 on its chip`);
        await chip.hover();
        const darker = theme === 'light' ? 'rgb(95, 100, 116)' : 'rgb(154, 160, 174)';
        assert.equal(await styleOf(chip, 'borderTopColor', darker), darker, 'hover strengthens the dashed border');
        assert.equal(await chip.evaluate((n) => getComputedStyle(n).filter), 'none', 'hover adds no brightness filter');
        assert.equal(await chip.evaluate((n) => getComputedStyle(n).backgroundColor), background, 'hover keeps the grey fill');
      } finally { await ctx.close(); }
    });
  }
}
