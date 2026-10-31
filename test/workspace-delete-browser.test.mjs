import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { launch } from './lib/browser.mjs';

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
    const go = page.locator('#modal button[type="submit"]');
    assert.equal(await go.isDisabled(), true, 'Delete stays off before the name is typed');
    await page.fill('#modal input[name="confirm"]', name.slice(0, -1));
    assert.equal(await go.isDisabled(), true, 'a near miss keeps it off');
    await page.fill('#modal input[name="confirm"]', name);
    assert.equal(await go.isDisabled(), false, 'the exact name arms it');
    await go.click();
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
    test(`${theme}: a rail right-click deletes a sibling through the typed dialog, and Undo brings it back (Feature #347)`, async () => {
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
        await page.waitForSelector('.wv-toast .wv-toast-action');
        assert.match(await page.locator('.wv-toast').last().textContent(), /scratch moved to the trash/);
        await chip(page, 'scratch').waitFor({ state: 'detached' });
        assert.ok(await tombstone('scratch'), 'the server holds the tombstone');
        assert.equal(new URL(page.url()).pathname, '/', 'deleting a sibling keeps you where you were');
        await page.locator('.wv-toast .wv-toast-action', { hasText: 'Undo' }).click();
        await chip(page, 'scratch').waitFor();
        assert.equal(await tombstone('scratch'), null, 'Undo restores it');
      } finally { await restore('scratch'); await page.close(); }
    });
  }

  test('the ⋮ on the workspace page deletes the workspace you stand in, lands on the next rail workspace, and Undo returns you (Feature #347)', async () => {
    const scratchId = await idOf('scratch');
    const spareId = await idOf('spare');
    const page = await open(`/w/${scratchId}/`);
    try {
      await page.click('#main .view-header .dots-btn[title="Workspace actions"]');
      await page.waitForSelector('.wv-menu .wv-menu-row');
      assert.deepEqual(await menuRows(page), ['Delete workspace…']);
      await page.locator('.wv-menu .wv-menu-row', { hasText: 'Delete workspace…' }).click();
      await confirmDialog(page, 'scratch');
      await page.waitForURL(new RegExp(`/w/${spareId}/`));
      await page.waitForSelector('.wv-toast .wv-toast-action');
      assert.match(await page.locator('.wv-toast').last().textContent(), /scratch moved to the trash/, 'the toast follows you to the next workspace');
      assert.equal(new URL(page.url()).searchParams.get('trashed'), null, 'the marker leaves the address bar');
      assert.ok(await tombstone('scratch'));
      await page.locator('.wv-toast .wv-toast-action', { hasText: 'Undo' }).click();
      await page.waitForURL(new RegExp(`/w/${scratchId}/`));
      await page.waitForSelector('#ws-list .ws-icon.active');
      assert.equal(await tombstone('scratch'), null, 'Undo restores it and takes you back in');
    } finally { await restore('scratch'); await page.close(); }
  });

  test('a stray trashed marker for a live workspace shows no toast', async () => {
    const page = await open('/?trashed=spare');
    try {
      await page.waitForSelector('#main .view-header');
      await page.waitForFunction(() => !location.search.includes('trashed'));
      assert.equal(await page.locator('.wv-toast', { hasText: 'moved to the trash' }).count(), 0);
    } finally { await page.close(); }
  });

  test('a workspace trashed through the API lists in Trash in the sidebar with Restore, in dark too', async () => {
    const page = await open('/', 'dark');
    try {
      assert.equal((await fetch(`${base}/api/workspaces/${await idOf('scratch')}`, { method: 'DELETE' })).status, 200, 'DELETE /api/workspaces/:id trashes');
      await page.reload();
      await page.waitForSelector('#ws-list .ws-icon');
      assert.equal(await chip(page, 'scratch').count(), 0, 'the trashed workspace leaves the rail');
      assert.equal(await page.locator('#ws-trash').count(), 0, 'no trash glyph');
      assert.equal(await page.locator('#sidebar .nav-system a[href="#/trash"]').count(), 1, 'the Trash row is in the sidebar');
      await page.click('#sidebar .nav-system a[href="#/trash"]');
      await page.waitForSelector('#main .trash-workspaces');
      assert.match(await page.textContent('#main .trash-workspaces'), /scratch/);
      await page.locator('#main .trash-workspaces button', { hasText: 'Restore' }).click();
      await chip(page, 'scratch').waitFor();
    } finally { await restore('scratch'); await page.close(); }
  });

  test('Settings keeps its Workspaces card', async () => {
    const page = await open('/#/settings');
    try {
      await page.waitForSelector('#main .settings-workspaces');
      assert.match(await page.textContent('#main .settings-workspaces'), /scratch/);
    } finally { await page.close(); }
  });
}
