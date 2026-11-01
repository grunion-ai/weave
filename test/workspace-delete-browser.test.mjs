import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { launch } from './lib/browser.mjs';
import { hold } from './lib/hold.mjs';

let scratch, spare;
const s = await launch('workspace delete', (weave) => {
  weave.markOnboarded();
  weave.state.meta.name = 'main';
  scratch = new Weave();
  scratch.state.meta.name = 'scratch';
  scratch.markOnboarded();
  scratch.createSpace({ name: 'Notes' });
  spare = new Weave();
  spare.state.meta.name = 'spare';
  spare.markOnboarded();
}, { server: () => ({ workspaces: { scratch, spare } }) });

if (s) {
  const { base, browser } = s;

  async function open(path = '/', theme = 'light') {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(base + path);
    await page.waitForSelector('#ws-list .ws-icon');
    return page;
  }
  const chip = (page, name) => page.locator(`#ws-list .ws-icon[title^="${name} "]`);
  const menuRows = (page) => page.locator('.wv-menu .wv-menu-row').evaluateAll((rs) => rs.map((r) => (r.querySelector('.wv-menu-label')?.textContent ?? r.textContent).trim()));
  const listed = async () => fetch(`${base}/api/workspaces?deleted=1`).then((r) => r.json());
  const tombstone = async (name) => (await listed()).find((w) => w.name === name)?.deletedAt ?? null;
  const idOf = async (name) => (await listed()).find((w) => w.name === name).id;
  const restore = async (name) => { if (await tombstone(name)) await fetch(`${base}/api/workspaces/${await idOf(name)}/restore`, { method: 'POST' }); };

  async function confirmDialog(page, name) {
    await page.waitForSelector('#modal input[name="confirm"]');
    assert.equal((await page.locator('#modal h2').textContent()).trim(), 'Delete workspace');
    assert.match(await page.locator('#modal').textContent(), /permanently deletes .*cannot be undone/s, 'the dialog says it is permanent');
    assert.doesNotMatch(await page.locator('#modal').textContent(), /trash|restore/i, 'and promises no way back');
    const go = page.locator('#modal .ws-delete-go');
    assert.equal(await go.isDisabled(), true, 'Delete stays off before the name is typed');
    await page.fill('#modal input[name="confirm"]', name.slice(0, -1));
    assert.equal(await go.isDisabled(), true, 'a near miss keeps it off');
    await page.fill('#modal input[name="confirm"]', name);
    assert.equal(await go.isDisabled(), false, 'the exact name arms it');
    await go.click();
    assert.ok(await page.locator('#modal').isVisible(), 'a click alone deletes nothing');
    await hold(go);
  }

  test('the default workspace offers no workspace menu: no ⋮ on its page and its chip opens nothing (Feature #347)', async () => {
    const page = await open('/');
    try {
      await page.waitForSelector('#main .view-header');
      assert.equal(await page.locator('#main .view-header .dots-btn[title="Workspace actions"]').count(), 0, 'no ⋮ when the one row cannot work');
      await chip(page, 'main').click({ button: 'right' });
      await chip(page, 'scratch').click({ button: 'right' });
      await page.waitForSelector('.ws-ctx .wv-menu-row');
      assert.match(await page.locator('.ws-ctx').textContent(), /scratch/, 'only the deletable chip opened a menu');
      assert.equal(await page.locator('.ws-ctx').count(), 1);
    } finally { await page.close(); }
  });

  for (const theme of ['light', 'dark']) {
    test(`${theme}: a rail right-click deletes a sibling for good: typed dialog, a hold, no Undo, gone from the rail and its address (Feature #346, Feature #347)`, async () => {
      const page = await open('/', theme);
      try {
        assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
        await chip(page, 'scratch').click({ button: 'right' });
        await page.waitForSelector('.ws-ctx .wv-menu-row');
        assert.deepEqual(await menuRows(page), ['Delete workspace…'], 'the workspace menu holds Delete alone: no Invite people…, no link preview switch');
        assert.match(await page.locator('.ws-ctx').textContent(), /scratch/, 'a head row names the workspace');
        const sent = page.waitForRequest((r) => r.method() === 'DELETE' && /\/api\/workspaces\/[^/]+$/.test(new URL(r.url()).pathname));
        await page.locator('.ws-ctx .wv-menu-row', { hasText: 'Delete workspace…' }).click();
        await confirmDialog(page, 'scratch');
        assert.equal(new URL((await sent).url()).pathname, `/api/workspaces/${await idOf('scratch')}`, 'the menu sends the same DELETE the API takes');
        const toast = page.locator('.wv-toast', { hasText: 'Workspace scratch deleted' });
        await toast.waitFor();
        assert.equal(await toast.locator('.wv-toast-action').count(), 0, 'the message offers no Undo');
        await chip(page, 'scratch').waitFor({ state: 'detached' });
        assert.equal(new URL(page.url()).pathname, '/', 'deleting a sibling keeps you where you were');
        assert.equal((await fetch(`${base}/w/${await idOf('scratch')}/api/health`)).status, 404, 'its address answers 404');
        assert.ok(await tombstone('scratch'), 'the server keeps a tombstone for the operator');
      } finally { await restore('scratch'); await page.close(); }
    });
  }

  test('the ⋮ on the workspace page deletes the workspace you stand in and opens the next one on the rail (Feature #347)', async () => {
    const scratchId = await idOf('scratch');
    const spareId = await idOf('spare');
    const page = await open(`/w/${spareId}/`);
    try {
      await page.goto(`${base}/w/${scratchId}/`);
      await page.click('#main .view-header .dots-btn[title="Workspace actions"]');
      await page.waitForSelector('.wv-menu .wv-menu-row');
      assert.deepEqual(await menuRows(page), ['Delete workspace…']);
      await page.locator('.wv-menu .wv-menu-row', { hasText: 'Delete workspace…' }).click();
      await confirmDialog(page, 'scratch');
      await page.waitForURL(new RegExp(`/w/${spareId}/$`));
      await page.waitForSelector('#ws-list .ws-icon.active');
      assert.equal(await chip(page, 'scratch').count(), 0, 'the deleted workspace is off the rail');
      assert.ok(await tombstone('scratch'));
    } finally { await restore('scratch'); await page.close(); }
  });

  test('a workspace deleted through the API is nowhere in the app: not on the rail, not in Trash, not in Settings', async () => {
    const page = await open('/', 'dark');
    try {
      assert.equal((await fetch(`${base}/api/workspaces/${await idOf('scratch')}`, { method: 'DELETE' })).status, 200, 'DELETE /api/workspaces/:id deletes');
      await page.reload();
      await page.waitForSelector('#ws-list .ws-icon');
      assert.equal(await chip(page, 'scratch').count(), 0, 'off the rail');
      await page.click('#sidebar .nav-system a[href="#/trash"]');
      await page.waitForFunction(() => location.hash === '#/trash' && document.querySelector('#main .view-header')?.textContent.includes('Trash') && !document.querySelector('#main .settings-workspaces'));
      assert.equal(await page.locator('#main .trash-workspaces').count(), 0, 'Trash lists no workspaces');
      assert.doesNotMatch(await page.textContent('#main'), /scratch/, 'and never names it');
      await page.goto(`${base}/#/settings`);
      await page.waitForSelector('#main .settings-workspaces');
      assert.doesNotMatch(await page.textContent('#main .settings-workspaces'), /scratch/, 'Settings lists only live workspaces');
    } finally { await restore('scratch'); await page.close(); }
  });
}
