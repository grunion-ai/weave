import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { launch } from './lib/browser.mjs';
import { hold } from './lib/hold.mjs';

const svg = (fill) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="${fill}"/></svg>`);
const logoOf = (weave) => weave.state.meta.logo ? weave.getWorkspaceLogo().bytes.toString() : null;

let scratch, blank;
const s = await launch('workspace logo from the rail', (weave) => {
  weave.markOnboarded();
  weave.state.meta.name = 'main';
  weave.setWorkspaceLogo({ name: 'main.svg', mime: 'image/svg+xml', bytes: svg('red') });
  scratch = new Weave();
  scratch.markOnboarded();
  scratch.state.meta.name = 'scratch';
  scratch.setWorkspaceLogo({ name: 'scratch.svg', mime: 'image/svg+xml', bytes: svg('blue') });
  blank = new Weave();
  blank.markOnboarded();
  blank.state.meta.name = 'blank';
}, { server: () => ({ workspaces: { scratch, blank } }) });

if (s) {
  const { weave: main, base, browser } = s;

  async function open(path = '/', theme = 'light') {
    const page = await browser.newPage();
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(base + path);
    await page.waitForSelector('#ws-list .ws-icon');
    return page;
  }
  const chip = (page, name) => page.locator(`#ws-list .ws-icon[title^="${name} "]`);
  const menuItems = (page) => page.locator('.ws-ctx .wv-menu-row').allTextContents();
  const closeMenu = async (page) => { await page.keyboard.press('Escape'); assert.equal(await page.locator('.ws-ctx').count(), 0); };

  test('the tray menu is the workspace definition: no logo rows, Delete alone, and none on the default (Feature #296, Feature #347)', async () => {
    const page = await open();
    for (const name of ['scratch', 'blank']) {
      await chip(page, name).click({ button: 'right' });
      await page.waitForSelector('.ws-ctx .wv-menu-row');
      const items = (await menuItems(page)).map((t) => t.trim());
      assert.ok(!items.some((t) => /logo/i.test(t)), `${name} keeps logo rows out of the menu: ${items}`);
      assert.deepEqual(items, ['Delete workspace…'], `${name} offers Delete alone: ${items}`);
      await closeMenu(page);
    }
    await chip(page, 'main').click({ button: 'right' });
    await chip(page, 'blank').click({ button: 'right' });
    await page.waitForSelector('.ws-ctx .wv-menu-row');
    assert.match(await page.locator('.ws-ctx').textContent(), /blank/, 'the default chip opened nothing, so the next menu is blank\'s');
    await closeMenu(page);
    await page.close();
  });

  for (const theme of ['light', 'dark']) {
    test(`${theme}: clicking the logo on the workspace page replaces it, and the page and its chip redraw (Feature #296)`, async () => {
      const page = await open('/', theme);
      try {
        assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
        await page.waitForSelector('#main .ws-logo-pick img');
        const before = { scratch: logoOf(scratch), blank: logoOf(blank) };
        const chooser = page.waitForEvent('filechooser');
        await page.click('#main .ws-logo-pick');
        await (await chooser).setFiles({ name: 'green.svg', mimeType: 'image/svg+xml', buffer: svg('green') });
        await page.waitForSelector('.wv-toast:not(.err)');
        assert.match(logoOf(main), /green/, 'main carries the new logo');
        assert.equal(logoOf(scratch), before.scratch, 'other workspaces are untouched');
        assert.equal(logoOf(blank), before.blank);
        await page.waitForSelector('#main .ws-logo-pick img');
        assert.equal(await chip(page, 'main').locator('img').count(), 1, 'the chip still shows a logo');
        const ink = await page.$eval('#main .ws-logo-pick', (n) => getComputedStyle(n).borderColor);
        assert.ok(ink && ink !== 'rgba(0, 0, 0, 0)', `${theme}: the logo sits in a visible frame (${ink})`);
      } finally { await page.close(); }
    });
  }

  test('a workspace without a logo shows its letter; the logo adds one and holding Remove logo clears it (Feature #296, Feature #346)', async () => {
    const page = await open(`/w/${blank.state.meta.id}/`);
    try {
      await page.waitForSelector('#main .ws-logo-pick');
      assert.equal((await page.locator('#main .ws-logo-pick').textContent()).trim(), 'B');
      assert.equal(await page.locator('#main .ws-logo-clear').count(), 0, 'no logo, no Remove');
      const chooser = page.waitForEvent('filechooser');
      await page.click('#main .ws-logo-pick');
      await (await chooser).setFiles({ name: 'gold.svg', mimeType: 'image/svg+xml', buffer: svg('gold') });
      await page.waitForSelector('#main .ws-logo-pick img');
      assert.match(logoOf(blank), /gold/);
      await page.hover('#main .ws-logo');
      const clear = page.locator('#main .ws-logo-clear');
      assert.equal(await clear.evaluate((n) => getComputedStyle(n).position), 'absolute', 'the hold keeps Remove pinned to the logo corner');
      await clear.click();
      assert.match(logoOf(blank), /gold/, 'a click alone keeps the logo');
      await hold(clear);
      await page.waitForFunction(() => !document.querySelector('#main .ws-logo-pick img'));
      assert.equal(logoOf(blank), null, 'the server no longer holds a logo');
      assert.equal((await page.locator('#main .ws-logo-pick').textContent()).trim(), 'B');
      await page.waitForFunction(() => !document.querySelector('#ws-list .ws-icon[title^="blank "] img'));
      assert.ok(logoOf(main), 'the other workspace keeps its logo');
    } finally { await page.close(); }
  });

  for (const theme of ['light', 'dark']) {
    test(`${theme}: an unavailable logo falls back to the workspace initial (Issue #889)`, async () => {
      const page = await browser.newPage();
      try {
        await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
        await page.route('**/api/workspace/logo*', (route) => route.fulfill({ status: 404, body: 'Missing logo' }));
        await page.goto(base);
        await page.waitForSelector('#main .ws-logo-pick');
        await page.waitForLoadState('networkidle');
        assert.equal(await chip(page, 'main').locator('img').count(), 0);
        assert.equal((await chip(page, 'main').textContent()).trim(), 'M');
        assert.equal(await page.locator('#main .ws-logo-pick img').count(), 0);
        assert.equal((await page.locator('#main .ws-logo-pick').textContent()).trim(), 'M');
        assert.equal(await page.locator('.crumb-ws-mark img').count(), 0);
        assert.ok(await page.locator('.crumb-ws-letter').count() > 0);
        assert.equal(await page.locator('#main .ws-logo-clear').count(), 1);
        assert.ok(logoOf(main));
      } finally { await page.close(); }
    });
  }

  test('a left click on the current chip opens the menu instead of reloading; siblings still switch', async () => {
    const page = await open(`/w/${scratch.state.meta.id}/`);
    const url = page.url();
    await chip(page, 'scratch').click();
    await page.waitForSelector('.ws-ctx .wv-menu-row');
    assert.ok((await menuItems(page)).some((t) => t.trim() === 'Delete workspace…'), 'the current chip\'s click opens its menu');
    assert.equal(page.url(), url, 'no navigation');
    await closeMenu(page);
    await chip(page, 'blank').click();
    await page.waitForURL(new RegExp(`/w/${blank.state.meta.id}/`));
    await page.close();
  });
}
