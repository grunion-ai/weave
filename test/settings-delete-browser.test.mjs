import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { launch, eventually } from './lib/browser.mjs';
import { hold } from './lib/hold.mjs';

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

  for (const theme of ['light', 'dark']) {
    test(`${theme}: Settings deletes a workspace for good from its own dialog once the name is typed and the hold runs out (Issue #1171, Feature #346, Feature #347)`, async () => {
      const page = await open('#/settings', theme);
      try {
        await page.waitForSelector('#ws-list .ws-icon[title^="scratch "]');
        const card = page.locator('#main .settings-workspaces');
        const names = (await card.locator('.list-row-name').allTextContents()).map((t) => t.trim());
        assert.deepEqual(names, ['main', 'scratch'], 'the initial mount has no deletion privilege; the docs workspace stays protected');
        const openDialog = async () => {
          await card.locator('.list-row', { hasText: 'scratch' }).locator('.ws-delete-open').click();
          await page.locator('#modal').waitFor();
        };
        const live = () => fetch(`${base}/api/workspaces`).then((r) => r.json()).then((l) => l.some((w) => w.name === 'scratch'));

        await openDialog();
        assert.equal(await card.locator('.purge-confirm').count(), 0, 'nothing unfolds inline under the row');
        assert.equal((await page.textContent('#modal h2')).trim(), 'Delete workspace');
        assert.match(await page.textContent('#modal'), /scratch/, 'the dialog names the workspace');
        const input = page.locator('#modal input[name="confirm"]');
        const go = page.locator('#modal .ws-delete-go');
        assert.equal(await page.evaluate(() => document.activeElement?.name), 'confirm', 'the name box takes focus');
        assert.equal((await go.textContent()).trim(), 'Delete workspace');
        assert.match(await go.getAttribute('class'), /\bbtn-danger\b/, 'Delete is drawn as a danger button from the start');
        assert.match(await go.getAttribute('class'), /\bhold-btn\b/, 'and it is a hold');
        assert.equal(await page.locator('#modal button[type="submit"]').count(), 0, 'no submit button deletes on a click');
        assert.ok(await go.isDisabled(), 'Delete is off until the name is typed');
        await input.fill('scratc');
        assert.ok(await go.isDisabled(), 'a partial name keeps it off');
        await input.fill('Scratch');
        assert.ok(await go.isDisabled(), 'the match is exact, case included');
        await input.press('Enter');
        assert.ok(await page.locator('#modal').isVisible(), 'Enter on a mismatch submits nothing');
        await page.keyboard.press('Escape');
        await page.locator('#modal').waitFor({ state: 'detached' });
        assert.ok(await live(), 'Escape deletes nothing');

        await openDialog();
        await page.locator('#modal button', { hasText: 'Cancel' }).click();
        await page.locator('#modal').waitFor({ state: 'detached' });
        assert.ok(await live(), 'Cancel deletes nothing');

        await openDialog();
        await input.fill('scratch');
        assert.ok(await go.isEnabled(), 'the exact name turns Delete on');
        await input.press('Enter');
        await go.click();
        assert.ok(await page.locator('#modal').isVisible(), 'Enter and a click delete nothing without the hold');
        assert.ok(await live(), 'the workspace is still live');
        await hold(go);
        await page.locator('#modal').waitFor({ state: 'detached' });
        await page.waitForFunction(() => !document.querySelector('#ws-list .ws-icon[title^="scratch "]'));
        assert.equal(await live(), false, 'the workspace left the live list');
        const row = (await fetch(`${base}/api/workspaces?deleted=1`).then((r) => r.json())).find((w) => w.name === 'scratch');
        assert.ok(row?.deletedAt, 'the hub keeps a tombstone for the operator');
        const toast = page.locator('.wv-toast', { hasText: 'Workspace scratch deleted' });
        await toast.waitFor();
        assert.equal(await toast.locator('button', { hasText: 'Undo' }).count(), 0, 'no Undo: the delete is permanent');
        await fetch(`${base}/api/workspaces/${row.id}/restore`, { method: 'POST' });
        assert.ok(await live(), 'only the operator route brings it back');
      } finally { await page.close(); }
    });
  }

  test('a workspace deleted from the Settings dialog never shows in Trash (Feature #347)', async () => {
    const page = await open('#/settings', 'dark');
    try {
      await page.waitForSelector('#ws-list .ws-icon[title^="scratch "]');
      await page.locator('#main .settings-workspaces .list-row', { hasText: 'scratch' }).locator('.ws-delete-open').click();
      await page.locator('#modal input[name="confirm"]').fill('scratch');
      await hold(page.locator('#modal .ws-delete-go'));
      await page.locator('#ws-list .ws-icon[title^="scratch "]').waitFor({ state: 'detached' });
      await page.click('#sidebar .nav-system a[href="#/trash"]');
      await page.waitForFunction(() => location.hash === '#/trash' && document.querySelector('#main .view-header')?.textContent.includes('Trash') && !document.querySelector('#main .settings-workspaces'));
      assert.equal(await page.locator('#main .trash-workspaces').count(), 0, 'Trash lists no workspaces');
      assert.doesNotMatch(await page.textContent('#main'), /scratch/);
    } finally {
      const row = (await fetch(`${base}/api/workspaces?deleted=1`).then((r) => r.json())).find((w) => w.name === 'scratch');
      if (row?.deletedAt) await fetch(`${base}/api/workspaces/${row.id}/restore`, { method: 'POST' });
      await page.close();
    }
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
      assert.equal(await page.locator('#sidebar .nav-system a[href="#/settings"]').count(), 0, 'Settings is not a System row');
      await page.click('#sidebar .nav-identity .nav-identity-more');
      await page.locator('.nav-personal-menu [role="menuitem"]', { hasText: 'Settings' }).click();
      await page.waitForSelector('#main .settings-purge');
      assert.equal(await page.evaluate(() => location.hash), '#/settings');
    } finally { await page.close(); }
  });
}
