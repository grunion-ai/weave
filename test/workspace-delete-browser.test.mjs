import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { launch } from './lib/browser.mjs';

let scratch;
const s = await launch('workspace delete', (weave) => {
  weave.markOnboarded();
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
  const menuItems = (page) => page.locator('.ws-ctx .wv-menu-row').allTextContents();

  test('no workspace menu offers Delete workspace: not a sibling chip, not the default chip (Feature #297)', async () => {
    const page = await open();
    for (const name of ['scratch', 'main']) {
      await chip(page, name).click({ button: 'right' });
      await page.waitForSelector('.ws-ctx .wv-menu-row');
      const items = (await menuItems(page)).map((t) => t.trim());
      assert.deepEqual(items.filter((t) => t !== 'Invite people…'), ['Link preview before sign-in'], `${name} opens its menu without a delete: ${items}`);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.ws-ctx').count(), 0, 'Escape closes the menu');
    }
    await page.close();
  });

  test('a workspace trashed through the API lists in Trash in the sidebar with Restore, in dark too; the routes stay (Feature #297)', async () => {
    const page = await open('/', 'dark');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), 'dark');
    const { id } = (await fetch(`${base}/api/workspaces`).then((r) => r.json())).find((w) => w.name === 'scratch');
    assert.equal((await fetch(`${base}/api/workspaces/${id}`, { method: 'DELETE' })).status, 200, 'DELETE /api/workspaces/:id still trashes');
    await page.reload();
    await page.waitForSelector('#ws-list .ws-icon');
    assert.equal(await chip(page, 'scratch').count(), 0, 'the trashed workspace leaves the rail');
    const res = await fetch(`${base}/api/workspaces?deleted=1`).then((r) => r.json());
    assert.ok(res.find((w) => w.name === 'scratch')?.deletedAt, 'the server holds the tombstone');
    await assertNoCornerTrash(page);
    await page.click('#sidebar .nav-system a[href="#/trash"]');
    await page.waitForSelector('#main .trash-workspaces');
    assert.match(await page.textContent('#main .trash-workspaces'), /scratch/);
    await page.locator('#main .trash-workspaces button', { hasText: 'Restore' }).click();
    await page.waitForSelector('#ws-list .ws-icon[title^="scratch "]');
    await page.waitForFunction(() => !document.querySelector('#main .trash-workspaces'));
    await page.close();
  });

  async function assertNoCornerTrash(page) {
    assert.equal(await page.locator('#ws-trash').count(), 0, 'no trash glyph');
    assert.equal(await page.locator('#hub-foot').count(), 0, 'no corner row for it to sit in');
    assert.equal(await page.locator('#sidebar .nav-system a[href="#/trash"]').count(), 1, 'the Trash row is still in the sidebar');
  }

  test('with one trashed workspace the corner stays empty and Trash lists it, light theme', async () => {
    const { id, deletedAt } = (await fetch(`${base}/api/workspaces?deleted=1`).then((r) => r.json())).find((w) => w.name === 'scratch');
    if (!deletedAt) await fetch(`${base}/api/workspaces/${id}`, { method: 'DELETE' });
    const page = await open('/', 'light');
    await assertNoCornerTrash(page);
    await page.goto(`${base}/#/trash`);
    await page.waitForSelector('#main .trash-workspaces');
    assert.match(await page.textContent('#main .trash-workspaces'), /scratch/);
    await fetch(`${base}/api/workspaces/${id}/restore`, { method: 'POST' });
    await page.close();
  });

  test('the workspace page menu carries no delete either, on a sibling or the default (Feature #297)', async () => {
    const list = await fetch(`${base}/api/workspaces`).then((r) => r.json());
    const row = list.find((w) => w.name === 'scratch');
    for (const path of [`/w/${row.id}/`, '/']) {
      const page = await open(path);
      await page.waitForSelector('.view-header .dots-btn');
      await page.click('.view-header .dots-btn');
      await page.waitForSelector('.wv-menu .wv-menu-row');
      assert.equal(await page.locator('.wv-menu .wv-menu-row', { hasText: 'Delete workspace' }).count(), 0, `${path} offers no delete`);
      assert.equal(await page.locator('#modal input[name="confirm"]').count(), 0, 'and no confirm dialog');
      await page.close();
    }
    const settings = await open('/#/settings');
    await settings.waitForSelector('#main .settings-workspaces');
    assert.match(await settings.textContent('#main .settings-workspaces'), /scratch/, 'Settings is the one place that moves a workspace to the trash');
    await settings.close();
  });
}
