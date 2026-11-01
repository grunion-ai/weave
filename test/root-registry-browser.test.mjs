import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { launch } from './lib/browser.mjs';

let uno, sessions;
const s = await launch('workspace registry', (root) => {
  root.updateWorkspace({ name: 'root' });
  root.createSpace({ name: 'Docs' });
  root.createTable({ space: 'Docs', name: 'Guide' });
  uno = new Weave();
  uno.updateWorkspace({ name: 'uno' });
  uno.createSpace({ name: 'Agent' });
  sessions = uno.createTable({ space: 'Agent', name: 'Sessions' });
  uno.addField(sessions, { name: 'Cost', type: 'number' });
  for (const [n, c] of [['a', 1.5], ['b', 2.5]]) uno.createEntity('Sessions', { name: n, values: { Cost: c } });
  uno.updateTable(sessions.id, { hideRollups: false });
}, { server: () => ({ workspaces: { uno } }) });

if (s) {
  const { base, browser, weave: root } = s;
  const open = async (url) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(url, { waitUntil: 'load' });
    return page;
  };
  const unoBase = () => `${base}/w/${uno.state.meta.id}`;

  test('a member sidebar has no Workspace space', async () => {
    const page = await open(`${unoBase()}/#/table/${sessions.id}`);
    await page.waitForSelector('#nav .nav-db');
    const spaces = await page.locator('#nav .nav-space').allInnerTexts();
    assert.deepEqual(spaces.map((x) => x.trim().toUpperCase()), ['AGENT']);
    await page.close();
  });

  test('a workspace grid draws the Σ row and stores its rollup locally', async () => {
    const page = await open(`${unoBase()}/#/table/${sessions.id}`);
    await page.waitForSelector('thead tr.wv-foot');
    const cell = page.locator('thead tr.wv-foot td.foot-cell[data-col="Cost"]');
    await cell.click();
    await page.waitForSelector('.chip-pop .foot-row[data-agg="sum"]');
    await page.click('.chip-pop .foot-row[data-agg="sum"]');
    await page.waitForSelector('thead tr.wv-foot td.foot-cell.has-stats');
    assert.equal(await cell.locator('.foot-val').innerText(), '4');
    const spacesT = uno.getTable('System/Spaces');
    const made = Object.values(spacesT.fields).find((f) => f.type === 'rollup' && f.config.via === sessions.id);
    assert.ok(made, 'the rollup field landed on the local Spaces table');
    assert.equal(Object.values(root.getTable('System/Spaces').fields).some(f => f.type === 'rollup' && f.config.via === sessions.id), false);
    await page.close();
  });

  test('the local Tables grid links its own tables without an owning workspace', async () => {
    const tablesT = uno.getTable('System/Tables');
    const page = await open(`${unoBase()}/#/table/${tablesT.id}`);
    await page.waitForSelector('tbody tr');
    const row = page.locator('tbody tr', { hasText: 'Sessions' }).first();
    assert.equal(await row.locator('a.open-link').getAttribute('href'), `#/table/${sessions.id}`);
    assert.doesNotMatch(await page.locator('#main').innerText(), /Guide/);
    await page.close();
  });

  for (const theme of ['light', 'dark']) {
    test(`Users opens the workspace's own accounts (${theme})`, async () => {
      if (!uno.listAccounts().length) uno.createAccount({ name: 'member-person' });
      if (!root.listAccounts().length) root.createAccount({ name: 'root-person' });
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      await page.addInitScript(t => localStorage.setItem('weave-theme', t), theme);
      await page.goto(`${unoBase()}/`, { waitUntil: 'networkidle' });
      const users = uno.getTable('System/Users');
      await page.click(`#sidebar .nav-system a[href="#/table/${users.id}"]`);
      const member = uno.findEntity(users.id, 'member-person');
      const name = page.locator(`#main .wv-grid tr[data-eid="${member.id}"] td[data-field="Name"] input`);
      await name.waitFor();
      assert.equal(await name.inputValue(), 'member-person');
      const names = await page.locator('#main .wv-grid tbody td[data-field="Name"] input').evaluateAll(inputs => inputs.map(input => input.value));
      assert.deepEqual(names, ['member-person']);
      assert.equal(new URL(page.url()).pathname, `/w/${uno.state.meta.id}/`);
      await page.close();
    });
  }
}
