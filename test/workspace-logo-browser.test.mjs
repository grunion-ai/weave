/* Updating a workspace's logo from the rail (Issue #202).
   The rail chip menu from #190 offered "Set logo…" on the current chip only,
   so a workspace that already carried a logo, or any sibling workspace, had
   no way to change it from the rail. Kyle, 2026-09-05: "workspace left click
   should be update logo and should show even for workspaces with logos."
   Now every non-pinned chip's menu carries "Update logo…" — current or not,
   logo or not — plus "Remove logo" when one exists; the upload targets THAT
   chip's workspace, never the current one; and a plain left click on the
   already-current chip (which used to reload the page) opens the same menu.
   Both themes are checked. Playwright is NOT a dependency of weave; the suite
   skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { launch } from './lib/browser.mjs';

const svg = (fill) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="${fill}"/></svg>`);
const logoOf = (weave) => weave.state.meta.logo ? weave.getWorkspaceLogo().bytes.toString() : null;

let scratch, blank;
const s = await launch('workspace logo from the rail', (weave) => {
  weave.state.meta.name = 'main';
  weave.setWorkspaceLogo({ name: 'main.svg', mime: 'image/svg+xml', bytes: svg('red') });
  scratch = new Weave();
  scratch.state.meta.name = 'scratch';
  scratch.setWorkspaceLogo({ name: 'scratch.svg', mime: 'image/svg+xml', bytes: svg('blue') });
  blank = new Weave();
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
  const menuItems = (page) => page.locator('.ws-ctx .dropdown-item').allTextContents();
  const closeMenu = async (page) => { await page.keyboard.press('Escape'); assert.equal(await page.locator('.ws-ctx').count(), 0); };

  test('every chip offers Update logo…; Remove logo only where a logo exists; never "Set logo"', async () => {
    const page = await open();
    for (const [name, hasLogo] of [['main', true], ['scratch', true], ['blank', false]]) {
      await chip(page, name).click({ button: 'right' });
      const items = await menuItems(page);
      assert.ok(items.includes('Update logo…'), `${name} offers Update logo…: ${items}`);
      assert.equal(items.includes('Remove logo'), hasLogo, `${name} Remove logo: ${items}`);
      assert.ok(!items.some((t) => /Set logo/.test(t)), `${name} still says Set logo: ${items}`);
      await closeMenu(page);
    }
    await page.close();
  });

  test('Update logo… on a non-current chip PUTs that workspace\'s logo and redraws only that chip', async () => {
    const page = await open('/', 'dark');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), 'dark');
    assert.equal(await chip(page, 'blank').locator('img').count(), 0, 'blank starts as a letter chip');
    const before = { main: logoOf(main), scratch: logoOf(scratch) };
    // A chip with a logo already: the picker opens and the new file replaces it.
    await chip(page, 'scratch').click({ button: 'right' });
    const chooser = page.waitForEvent('filechooser');
    await page.locator('.ws-ctx .dropdown-item', { hasText: 'Update logo…' }).click();
    await (await chooser).setFiles({ name: 'green.svg', mimeType: 'image/svg+xml', buffer: svg('green') });
    await page.waitForSelector('.wv-toast:not(.err)');
    await page.waitForFunction(() => document.querySelector('#ws-list .ws-icon[title^="scratch "] img'));
    assert.match(logoOf(scratch), /green/, 'scratch carries the new logo');
    assert.equal(logoOf(main), before.main, 'the current workspace is untouched');
    assert.equal(logoOf(blank), null, 'blank is untouched');
    const src = await chip(page, 'scratch').locator('img').getAttribute('src');
    assert.match(src, new RegExp(`^/w/${scratch.state.meta.id}/api/workspace/logo`), `the chip reads its own workspace's logo: ${src}`);
    // A chip without a logo: the letter becomes an image.
    await chip(page, 'blank').click({ button: 'right' });
    const chooser2 = page.waitForEvent('filechooser');
    await page.locator('.ws-ctx .dropdown-item', { hasText: 'Update logo…' }).click();
    await (await chooser2).setFiles({ name: 'gold.svg', mimeType: 'image/svg+xml', buffer: svg('gold') });
    await page.waitForSelector('#ws-list .ws-icon[title^="blank "] img');
    assert.match(logoOf(blank), /gold/);
    assert.match(logoOf(scratch), /green/, 'scratch keeps its logo');
    await page.close();
  });

  test('Remove logo clears that workspace\'s logo and the chip falls back to its letter', async () => {
    const page = await open();
    await chip(page, 'blank').click({ button: 'right' });
    await page.locator('.ws-ctx .dropdown-item', { hasText: 'Remove logo' }).click();
    await page.waitForFunction(() => !document.querySelector('#ws-list .ws-icon[title^="blank "] img'));
    assert.equal(logoOf(blank), null, 'the server no longer holds a logo');
    assert.equal((await chip(page, 'blank').textContent()).trim(), 'B');
    assert.ok(logoOf(main), 'the current workspace keeps its logo');
    await chip(page, 'blank').click({ button: 'right' });
    assert.ok(!(await menuItems(page)).includes('Remove logo'), 'no logo, no Remove');
    await closeMenu(page);
    await page.close();
  });

  test('a left click on the current chip opens the menu instead of reloading; siblings still switch', async () => {
    const page = await open();
    const url = page.url();
    await chip(page, 'main').click();
    assert.ok((await menuItems(page)).includes('Update logo…'), 'the current chip\'s click opens its menu');
    assert.equal(page.url(), url, 'no navigation');
    await closeMenu(page);
    await chip(page, 'scratch').click();
    await page.waitForURL(new RegExp(`/w/${scratch.state.meta.id}/`));
    await page.close();
  });
}
