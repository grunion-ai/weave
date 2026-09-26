/* A choice field's Default, in a real tray (Issues #421, #422).

   Select and multi-select took their Default in a free-text box, and a
   workflow had none to set: its first state was the default whether anyone
   chose it or not. The tray now offers a picker over the field's own options
   or states, "No default" first, and it follows the list above it — a
   renamed option is renamed in the Default, a removed one leaves it. With no
   default, a new row's choice is empty. The pure half is
   choice-default-dialog.test.mjs; the engine half choice-defaults.test.mjs.

   Playwright is NOT a dependency of weave; it is imported dynamically and the
   suite skips when absent, so `node --test` stays green on a bare checkout. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tasks;
const s = await launch('choice defaults', (weave) => {
  weave.createSpace({ name: 'Ops' });
  tasks = weave.createTable({ space: 'Ops', name: 'Task' });
  weave.createEntity(tasks, { name: 'Ship it' });
});

if (s) {
  const { base, browser, weave } = s;
  const field = (name) => Object.values(weave.getTable(tasks.id).fields).find((f) => f.name === name);
  const newRow = (name) => weave.readEntity(weave.createEntity(tasks, { name }).id).fields;

  const openTray = async (type, theme = 'light') => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.click('.add-field-head .add-field-btn');
    await page.waitForSelector('#tray-back .type-tile');
    await page.click(`#tray-back .type-tile[title="${type}"]`);
    await page.waitForSelector('#tray-back .choice-default');
    return page;
  };
  const face = (page) => page.locator('#tray-back .choice-default');
  const rows = (page) => page.locator('.picker-pop .picker-list').innerText();
  const pick = async (page, label) => {
    await face(page).click();
    await page.waitForSelector('.picker-pop');
    await page.locator('.picker-pop .picker-list').getByText(label, { exact: true }).first().click();
  };
  const save = async (page, name) => {
    await page.fill('#tray-back input[name="name"]', name);
    await page.click('#tray-back button[type="submit"]');
    await page.waitForSelector('#tray-back', { state: 'detached' });
  };

  for (const theme of ['light', 'dark']) {
    test(`a select's Default is a picker of its options, No default first (${theme})`, async () => {
      const page = await openTray('select', theme);
      assert.equal(await page.locator('#tray-back input[placeholder="Default value for new rows (optional)"]').count(), 0, 'no free-text box');
      for (const n of ['Low', 'High']) {
        await page.click('#tray-back .opt-add');
        await page.locator('#tray-back .opt-name').last().fill(n);
      }
      assert.equal((await face(page).innerText()).trim(), 'No default');
      await face(page).click();
      await page.waitForSelector('.picker-pop');
      const listed = (await rows(page)).split('\n').map((x) => x.trim()).filter((x) => x && !/^(\d|✓)$/.test(x));
      assert.deepEqual(listed.slice(0, 3), ['No default', 'Low', 'High'], 'No default leads, then the options in order');
      await page.keyboard.press('Escape');
      await page.close();
    });
  }

  test('a picked select default is where a new row starts; a rename follows it', async () => {
    const page = await openTray('select');
    for (const n of ['Low', 'High']) {
      await page.click('#tray-back .opt-add');
      await page.locator('#tray-back .opt-name').last().fill(n);
    }
    await pick(page, 'High');
    assert.equal((await face(page).innerText()).trim(), 'High');
    await page.locator('#tray-back .opt-name').nth(1).fill('Urgent');
    assert.equal((await face(page).innerText()).trim(), 'Urgent', 'the Default follows the rename as it is typed');
    await save(page, 'Priority');
    assert.equal(newRow('p1').Priority, 'Urgent');
    await page.close();
  });

  test('removing the default option leaves No default, and the next row starts empty', async () => {
    weave.addField(tasks, { name: 'Size', type: 'select', config: { options: ['S', 'M'], default: 'M' } });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    // The field menu's Edit opens the same tray on the stored field. The ⋮
    // shows on hover.
    const th = page.locator('.wv-grid thead th.col-head', { hasText: 'Size' }).first();
    await th.hover();
    await th.locator('.field-menu').click();
    await page.locator('.chip-pop .wv-menu-row', { hasText: 'Edit field' }).click();
    await page.waitForSelector('#tray-back .choice-default');
    assert.equal((await face(page).innerText()).trim(), 'M', 'the stored default is shown');
    await page.locator('#tray-back .opt-row').nth(1).locator('.opt-del').click();
    assert.equal((await face(page).innerText()).trim(), 'No default');
    await page.click('#tray-back button[type="submit"]');
    await page.waitForSelector('#tray-back', { state: 'detached' });
    assert.equal(field('Size').config.default, undefined);
    assert.equal(newRow('s1').Size, null);
    await page.close();
  });

  test('a workflow opens on No default; a picked state is where a new row starts', async () => {
    const page = await openTray('workflow');
    assert.equal((await face(page).innerText()).trim(), 'No default');
    await save(page, 'Stage');
    assert.equal(newRow('w1').Stage, null, 'no default: the row starts with no state');
    await page.close();
    const again = await openTray('workflow');
    await pick(again, 'In progress');
    assert.equal((await face(again).innerText()).trim(), 'In progress');
    await save(again, 'Phase');
    assert.deepEqual(field('Phase').config.states.map((st) => !!st.default), [false, true, false, false]);
    assert.equal(newRow('w2').Phase, 'In progress');
    await again.close();
  });

  test('a set state clears back to empty from the grid, and rests blank', async () => {
    weave.addField(tasks, { name: 'Lane', type: 'workflow' });
    const e = weave.createEntity(tasks, { name: 'lane row' });
    weave.setState(e.id, 'Lane', 'Done');
    const page = await browser.newPage({ viewport: { width: 2400, height: 900 } });
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    const cell = page.locator(`.wv-grid tbody tr.entity-row[data-eid="${e.id}"] td[data-field="Lane"]`);
    await cell.scrollIntoViewIfNeeded();
    await cell.locator('button').click();
    await page.waitForSelector('.picker-pop');
    await page.locator('.picker-pop .picker-list').getByText('—', { exact: true }).first().click();
    for (let i = 0; i < 50 && weave.readEntity(e.id).fields.Lane !== null; i++) await page.waitForTimeout(100);
    assert.equal(weave.readEntity(e.id).fields.Lane, null, 'the state is empty again');
    await page.locator(`.wv-grid tbody tr.entity-row[data-eid="${e.id}"] td[data-field="Lane"] .k-state.is-empty`).waitFor();
    await page.close();
  });
}
