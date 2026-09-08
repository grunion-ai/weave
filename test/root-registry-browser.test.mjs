/* Feature #219, slice c (page half) — the registry at the root, on screen.
   A member workspace's sidebar lists only its own spaces; its grids still
   draw the Σ row and its picker still adds a space rollup, now on the root
   Spaces table; the root's Tables grid carries a Workspace column and a row
   from another workspace deep-links into that workspace. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { launch } from './lib/browser.mjs';

let uno, sessions;
const s = await launch('root registry', (root) => {
  root.updateWorkspace({ name: 'root' });
  root.createSpace({ name: 'Docs' });
  root.createTable({ space: 'Docs', name: 'Guide' });
  uno = new Weave();
  uno.updateWorkspace({ name: 'uno' });
  uno.createSpace({ name: 'Agent' });
  sessions = uno.createTable({ space: 'Agent', name: 'Sessions' });
  uno.addField(sessions, { name: 'Cost', type: 'number' });
  for (const [n, c] of [['a', 1.5], ['b', 2.5]]) uno.createEntity('Sessions', { name: n, values: { Cost: c } });
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

  test('a member grid draws the Σ row and its picker adds a rollup on the root Spaces table', async () => {
    const page = await open(`${unoBase()}/#/table/${sessions.id}`);
    await page.waitForSelector('thead tr.wv-foot');
    const cell = page.locator('thead tr.wv-foot td.foot-cell[data-col="Cost"]');
    await cell.click();
    await page.waitForSelector('.chip-pop .foot-row[data-agg="sum"]');
    await page.click('.chip-pop .foot-row[data-agg="sum"]');
    await page.waitForSelector('thead tr.wv-foot td.foot-cell.has-stats');
    assert.equal(await cell.locator('.foot-val').innerText(), '4');
    const spacesT = root.getTable('Workspace/Spaces');
    const made = Object.values(spacesT.fields).find((f) => f.type === 'rollup' && f.config.via === sessions.id);
    assert.ok(made, 'the rollup field landed on the root Spaces table');
    assert.throws(() => uno.getTable('Workspace/Spaces'), 'the member minted nothing');
    await page.close();
  });

  test('the root Tables grid carries a Workspace column and deep-links a member row into its workspace', async () => {
    const tablesT = root.getTable('Workspace/Tables');
    const page = await open(`${base}/#/table/${tablesT.id}`);
    await page.waitForSelector('tbody tr');
    const headers = await page.locator('thead th').allInnerTexts();
    assert.ok(headers.some((h) => /workspace/i.test(h)), `no Workspace column: ${headers.join(' | ')}`);
    // The Name cell is an editor, not text: pick rows by their Workspace chip.
    const row = page.locator('tbody tr', { hasText: 'uno' }).first();
    const href = await row.locator('a.open-link').getAttribute('href');
    assert.equal(href, `/w/${uno.state.meta.id}/#/table/${sessions.id}`);
    const own = page.locator('tbody tr', { hasText: 'Docs' }).first();
    assert.equal(await own.locator('a.open-link').getAttribute('href'), `#/table/${root.getTable('Docs/Guide').id}`);
    await page.close();
  });
}
