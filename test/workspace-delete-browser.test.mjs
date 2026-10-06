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

  test('delete confirms by typing the name, then Trash in the sidebar offers restore, in dark too', async () => {
    const page = await open('/', 'dark');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), 'dark');
    await chip(page, 'scratch').click({ button: 'right' });
    await page.locator('.ws-ctx .dropdown-item', { hasText: 'Delete workspace' }).click();
    await page.waitForSelector('#modal input[name="confirm"]');
    assert.match(await page.textContent('#modal'), /Trash in the sidebar/);
    assert.doesNotMatch(await page.textContent('#modal'), /corner|glyph/);
    await page.fill('#modal input[name="confirm"]', 'scratchy');
    await page.click('#modal button[type="submit"]');
    await page.waitForSelector('.wv-toast.err');
    assert.equal(await page.locator('#modal').count(), 1, 'the dialog stays open on a wrong name');
    assert.equal(await chip(page, 'scratch').count(), 1);
    await page.fill('#modal input[name="confirm"]', 'scratch');
    await page.click('#modal button[type="submit"]');
    await page.waitForFunction(() => !document.querySelector('#ws-list .ws-icon[title^="scratch "]'));
    assert.equal(await chip(page, 'scratch').count(), 0, 'the deleted workspace leaves the rail');
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
