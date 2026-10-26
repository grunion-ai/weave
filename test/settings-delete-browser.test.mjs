import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { launch, eventually } from './lib/browser.mjs';

let notes;
let scratch;
const s = await launch('settings delete', (weave) => {
  weave.markOnboarded();
  weave.state.meta.name = 'main';
  weave.createSpace({ name: 'Product' });
  notes = weave.createTable({ space: 'Product', name: 'Note' });
  scratch = new Weave();
  scratch.state.meta.name = 'scratch';
  scratch.createSpace({ name: 'Notes' });
}, { server: () => ({ workspaces: { scratch } }) });

if (s) {
  const { base, browser, weave } = s;
  const exists = (id) => !!weave.state.entities[id];
  const trashed = (name) => {
    const e = weave.createEntity(notes, { name });
    weave.deleteEntity(e.id);
    return e.id;
  };
  async function open(hash, theme = 'light') {
    const page = await browser.newPage();
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${hash}`);
    return page;
  }
  async function holdToEnd(page, hold) {
    await hold.hover();
    await page.mouse.down();
    await page.waitForSelector('.hold-btn.holding');
    await page.waitForSelector('.hold-btn.holding', { state: 'detached' }).catch(() => {});
    await page.mouse.up();
  }

  for (const theme of ['light', 'dark']) {
    test(`${theme}: the Trash page restores and offers no Delete forever (Feature #295)`, async () => {
      trashed(`Kept ${theme}`);
      const page = await open('#/trash', theme);
      try {
        const row = page.locator('#main tr', { hasText: `Kept ${theme}` });
        await row.locator('button', { hasText: 'Restore' }).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
        assert.equal(await page.locator('#main .hold-btn').count(), 0, 'no hold on the Trash page');
        assert.doesNotMatch(await page.textContent('#main'), /Delete forever/, 'permanent delete left the Trash page');
      } finally { await page.close(); }
    });

    test(`${theme}: Settings purges a trashed row only after its name is typed and the hold runs out (Feature #295)`, async () => {
      const id = trashed(`Purge ${theme}`);
      const page = await open('#/settings', theme);
      try {
        assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
        const row = page.locator('#main .settings-purge tr.purge-row', { hasText: `Purge ${theme}` });
        await row.locator('.purge-open').click();
        const confirm = page.locator('#main .settings-purge .purge-confirm');
        const hold = confirm.locator('.hold-btn');
        await hold.waitFor();
        assert.equal((await hold.textContent()).trim(), 'Delete forever');
        assert.ok(await hold.isDisabled(), 'the hold is disarmed until the name is typed');
        await hold.hover({ force: true });
        await page.mouse.down();
        await page.waitForTimeout(1300);
        await page.mouse.up();
        assert.ok(exists(id), 'holding a disarmed button purges nothing');
        await confirm.locator('input').fill(`Purge ${theme}x`);
        assert.ok(await hold.isDisabled(), 'a near miss keeps it disarmed');
        await confirm.locator('input').fill(`Purge ${theme}`);
        assert.ok(await hold.isEnabled(), 'the exact name arms the hold');
        await holdToEnd(page, hold);
        assert.equal(await eventually(() => exists(id), false), false, 'the row is gone for good');
        await page.locator('#main .settings-purge tr.purge-row', { hasText: `Purge ${theme}` }).waitFor({ state: 'detached' });
      } finally { await page.close(); }
    });
  }

  test('Settings moves a workspace to the trash behind the typed name and hold, and Trash restores it (Feature #297)', async () => {
    const page = await open('#/settings', 'dark');
    try {
      await page.waitForSelector('#ws-list .ws-icon[title^="scratch "]');
      const card = page.locator('#main .settings-workspaces');
      const names = (await card.locator('.list-row-name').allTextContents()).map((t) => t.trim());
      assert.deepEqual(names, ['scratch'], 'only a deletable workspace is offered: never the default or weave');
      await card.locator('.list-row', { hasText: 'scratch' }).locator('.purge-open').click();
      const hold = card.locator('.purge-confirm .hold-btn');
      assert.ok(await hold.isDisabled(), 'disarmed until the name is typed');
      await card.locator('.purge-confirm input').fill('scratch');
      await holdToEnd(page, hold);
      await page.waitForFunction(() => !document.querySelector('#ws-list .ws-icon[title^="scratch "]'));
      const row = (await fetch(`${base}/api/workspaces?deleted=1`).then((r) => r.json())).find((w) => w.name === 'scratch');
      assert.ok(row?.deletedAt, 'the workspace sits in the trash, file kept');
      await page.click('#ws-rail .nav-system a[href="#/trash"]');
      await page.locator('#main .trash-workspaces button', { hasText: 'Restore' }).click();
      await page.waitForSelector('#ws-list .ws-icon[title^="scratch "]');
    } finally { await page.close(); }
  });

  test('a caller the server refuses sees no purge and no workspace delete in Settings (Features #295, #297)', async () => {
    trashed('Guarded');
    const page = await browser.newPage();
    try {
      await page.route('**/api/trash', async (route) => {
        const res = await route.fetch();
        await route.fulfill({ response: res, json: { ...(await res.json()), purge: false } });
      });
      await page.route('**/api/workspaces', async (route) => {
        const res = await route.fetch();
        await route.fulfill({ response: res, json: (await res.json()).map((w) => ({ ...w, deletable: false })) });
      });
      await page.goto(`${base}/#/settings`);
      await page.waitForSelector('#main .settings-purge');
      assert.match(await page.textContent('#main .settings-purge'), /Guarded/, 'the trashed rows still list');
      assert.equal(await page.locator('#main .purge-open').count(), 0, 'no Delete forever for an observer');
      assert.equal(await page.locator('#main .settings-workspaces').count(), 0, 'no workspace delete without the hub right');
    } finally { await page.close(); }
  });

  test('the personal menu opens Settings, and the System group keeps only its four tables', async () => {
    const page = await open('#/');
    try {
      assert.equal(await page.locator('#ws-rail .nav-system a[href="#/settings"]').count(), 0, 'Settings is not a System row');
      await page.click('#sidebar .nav-identity .nav-identity-more');
      await page.locator('.nav-personal-menu [role="menuitem"]', { hasText: 'Settings' }).click();
      await page.waitForSelector('#main .settings-purge');
      assert.equal(await page.evaluate(() => location.hash), '#/settings');
    } finally { await page.close(); }
  });
}
