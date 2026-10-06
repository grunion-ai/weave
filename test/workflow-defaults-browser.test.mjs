import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tasks;
const s = await launch('workflow defaults', (weave) => {
  weave.createSpace({ name: 'Ops' });
  tasks = weave.createTable({ space: 'Ops', name: 'Task' });
  weave.createEntity(tasks, { name: 'Ship it' });
});

if (s) {
  const { base, browser, weave } = s;
  const NAMES = ['Not started', 'In progress', 'Done', 'Canceled'];

  const openWorkflowTray = async (theme) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.click('.add-field-head .add-field-btn');
    await page.waitForSelector('#tray-back .type-tile');
    await page.click('#tray-back .type-tile[title="workflow"]');
    await page.waitForSelector('#tray-back .opt-list');
    return page;
  };

  for (const theme of ['light', 'dark']) {
    test(`the tray opens on four states, not an empty list (${theme})`, async () => {
      const page = await openWorkflowTray(theme);
      const rows = page.locator('#tray-back .opt-list .opt-row');
      assert.equal(await rows.count(), 4, 'four rows are already there');
      assert.deepEqual(await page.locator('#tray-back .opt-list .opt-name').evaluateAll(
        (els) => els.map((e) => e.value)), NAMES);
      const hues = await page.locator('#tray-back .opt-list .opt-color').evaluateAll(
        (els) => els.map((e) => e.className));
      assert.equal(new Set(hues).size, 4, 'each category wears its own hue');
      await page.close();
    });
  }

  test('saving the tray without touching a state creates the column', async () => {
    const page = await openWorkflowTray('light');
    await page.fill('#tray-back input[name="name"]', 'Status');
    await page.click('#tray-back button[type="submit"]');
    await page.waitForSelector('#tray-back', { state: 'detached' });
    assert.equal(await page.locator('.wv-toast.err').count(), 0, 'no refusal');
    const field = weave.getTable(tasks.id).fields
      ? Object.values(weave.getTable(tasks.id).fields).find((f) => f.name === 'Status')
      : null;
    assert.ok(field, 'the column exists');
    assert.deepEqual(field.config.states.map((st) => st.name), NAMES);
    assert.equal(field.config.states.some((st) => st.default), false, 'no default unless picked');
    await page.close();
  });

  test('the four are editable like any others — a rename sticks', async () => {
    const page = await openWorkflowTray('light');
    await page.fill('#tray-back input[name="name"]', 'Stage');
    const names = page.locator('#tray-back .opt-list .opt-name');
    await names.nth(0).fill('Queued');
    await names.nth(3).click();
    await page.locator('#tray-back .opt-list .opt-row').nth(3).locator('.opt-del').click();
    await page.click('#tray-back button[type="submit"]');
    await page.waitForSelector('#tray-back', { state: 'detached' });
    const field = Object.values(weave.getTable(tasks.id).fields).find((f) => f.name === 'Stage');
    assert.deepEqual(field.config.states.map((st) => st.name), ['Queued', 'In progress', 'Done']);
    await page.close();
  });
}
