/* The state field's default lifecycle, in a real tray (Issue #251).

   Adding a State column used to open on an empty list and then refuse the
   save — "Workflow field needs at least one state" — so the column cost you a
   status vocabulary before it existed. The tray now opens on the four the
   engine seeds, and a save with nothing touched works.

   Playwright is NOT a dependency of weave; it is imported dynamically and the
   suite skips when absent, so `node --test` stays green on a bare checkout. */
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

  /* The add-field tray, opened from the grid's `+` head and switched to the
     workflow tile — the exact path a hand takes. */
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
      // The colour swatch on each row reads its category, so the four are
      // visibly distinct in whichever theme is on.
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
    assert.equal(field.config.states[0].default, true, 'Not started is the default');
    await page.close();
  });

  test('the four are editable like any others — a rename sticks', async () => {
    const page = await openWorkflowTray('light');
    await page.fill('#tray-back input[name="name"]', 'Stage');
    const names = page.locator('#tray-back .opt-list .opt-name');
    await names.nth(0).fill('Queued');
    await names.nth(3).click();           // commit the edit, then drop a state
    await page.locator('#tray-back .opt-list .opt-row').nth(3).locator('.opt-del').click();
    await page.click('#tray-back button[type="submit"]');
    await page.waitForSelector('#tray-back', { state: 'detached' });
    const field = Object.values(weave.getTable(tasks.id).fields).find((f) => f.name === 'Stage');
    assert.deepEqual(field.config.states.map((st) => st.name), ['Queued', 'In progress', 'Done']);
    await page.close();
  });
}
