/* Deleting a workspace from the UI (Issue #190).
   The hub had DELETE /api/workspaces/:name and its restore for a while, and
   the only way to reach them from the app was a hold-to-delete buried in the
   workspace page's dots menu — Kyle, on :4400, found "+ New workspace" and
   nothing that undid it. Now every non-pinned chip on the workspace rail has
   a right-click menu; "Delete workspace…" asks the reader to type the
   workspace's name; the trash shows as a chip below the rail's workspace list with
   a Restore per workspace; the default and the weave docs workspaces offer
   no delete at all, and a hub that says it cannot delete (no `deletable` on
   its rows) hides the affordance everywhere. Both themes are checked.
   Playwright is NOT a dependency of weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { launch } from './lib/browser.mjs';

let scratch;
const s = await launch('workspace delete', (weave) => {
  weave.state.meta.name = 'main';
  scratch = new Weave();
  scratch.state.meta.name = 'scratch';
  scratch.createSpace({ name: 'Notes' });
}, { server: () => ({ workspaces: { scratch } }) });

if (s) {
  const { base, browser } = s;

  async function open(path = '/', theme = 'light') {
    const page = await browser.newPage();
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(base + path);
    await page.waitForSelector('#ws-list .ws-icon');
    return page;
  }
  const chip = (page, name) => page.locator(`#ws-list .ws-icon[title^="${name} "]`);
  const menuItems = (page) => page.locator('.ws-ctx .dropdown-item').allTextContents();

  test('right-click on a sibling chip offers Delete; the default chip does not', async () => {
    const page = await open();
    await chip(page, 'scratch').click({ button: 'right' });
    assert.ok((await menuItems(page)).some((t) => /Delete workspace/.test(t)), 'scratch offers a delete');
    await page.keyboard.press('Escape');
    await chip(page, 'main').click({ button: 'right' });
    const items = await menuItems(page);
    assert.ok(!items.some((t) => /Delete workspace/.test(t)), `the default offers no delete: ${items}`);
    assert.ok(items.some((t) => /logo/i.test(t)), 'the current workspace still offers its logo');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.ws-ctx').count(), 0, 'Escape closes the menu');
    await page.close();
  });

  test('delete confirms by typing the name, then the trash chip offers restore — in dark too', async () => {
    const page = await open('/', 'dark');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), 'dark');
    await chip(page, 'scratch').click({ button: 'right' });
    await page.locator('.ws-ctx .dropdown-item', { hasText: 'Delete workspace' }).click();
    await page.waitForSelector('#modal input[name="confirm"]');
    // A wrong name is refused and the workspace stays.
    await page.fill('#modal input[name="confirm"]', 'scratchy');
    await page.click('#modal button[type="submit"]');
    await page.waitForSelector('.wv-toast.err');
    assert.equal(await page.locator('#modal').count(), 1, 'the dialog stays open on a wrong name');
    assert.equal(await chip(page, 'scratch').count(), 1);
    // The right name deletes; the chip leaves the rail and the trash appears.
    await page.fill('#modal input[name="confirm"]', 'scratch');
    await page.click('#modal button[type="submit"]');
    await page.waitForSelector('#ws-trash');
    assert.equal(await chip(page, 'scratch').count(), 0, 'the deleted workspace leaves the rail');
    const res = await fetch(`${base}/api/workspaces?deleted=1`).then((r) => r.json());
    assert.ok(res.find((w) => w.name === 'scratch')?.deletedAt, 'the server holds the tombstone');
    const visible = await page.evaluate(() => {
      const t = document.querySelector('#ws-trash');
      const r = t.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(t).visibility !== 'hidden';
    });
    assert.ok(visible, 'the trash chip is drawn in the dark theme');
    // Restore from the trash sheet.
    await page.click('#ws-trash');
    await page.locator('#modal button', { hasText: 'Restore' }).click();
    await page.waitForSelector('#ws-list .ws-icon[title^="scratch "]');
    assert.equal(await page.locator('#ws-trash').count(), 0, 'an empty trash shows no chip');
    await page.close();
  });

  test('the workspace page carries the same delete; the default page has none', async () => {
    const list = await fetch(`${base}/api/workspaces`).then((r) => r.json());
    const row = list.find((w) => w.name === 'scratch');
    const page = await open(`/w/${row.id}/`);
    await page.waitForSelector('.view-header .dots-btn');
    await page.click('.view-header .dots-btn');
    assert.ok(await page.locator('.dl-menu .dropdown-item', { hasText: 'Delete workspace' }).count(), 'scratch page offers delete');
    await page.close();
    const home = await open('/');
    await home.waitForSelector('.view-header');
    assert.equal(await home.locator('.dl-menu .dropdown-item', { hasText: 'Delete workspace' }).count(), 0, 'the default page offers none');
    await home.close();
  });
}
