import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tasks;
let row;
const s = await launch('state colour', (weave) => {
  weave.createSpace({ name: 'Ops' });
  tasks = weave.createTable({ space: 'Ops', name: 'Task' });
  row = weave.createEntity(tasks, { name: 'Ship it' });
});

if (s) {
  const { base, browser, weave } = s;

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
  const rowAt = (page, i) => page.locator('#tray-back .opt-list .opt-row').nth(i);
  const pickHue = async (page, i, hue) => {
    await rowAt(page, i).locator('.opt-color').click();
    await page.waitForSelector('.chip-pop .swatch-grid');
    await page.click(`.chip-pop .swatch-grid .sw.hue-${hue}`);
    await rowAt(page, i).locator(`.opt-color.hue-${hue}`).waitFor();
    await page.click('#tray-back input[name="name"]');
    await page.waitForSelector('.chip-pop', { state: 'detached' });
  };
  const classOf = (page, i, sel) => rowAt(page, i).locator(sel).first().getAttribute('class');
  const fieldNamed = (name) => Object.values(weave.getTable(tasks.id).fields).find((f) => f.name === name);

  for (const theme of ['light', 'dark']) {
    test(`a state takes a colour of its own, and its category sibling does not (${theme})`, async () => {
      const page = await openWorkflowTray(theme);
      assert.equal(await rowAt(page, 1).locator('.opt-color').isDisabled(), false,
        'the swatch is a picker, not a label (Issue #427)');
      await pickHue(page, 1, 'purple');
      assert.match(await classOf(page, 1, '.opt-color'), /hue-purple/, 'the swatch wears the pick');
      assert.match(await classOf(page, 1, '.opt-preview .k'), /hue-purple/, 'so does the preview chip');
      assert.match(await classOf(page, 1, '.opt-preview .k'), /cat-in-progress/, 'the category is unchanged');
      assert.match(await classOf(page, 2, '.opt-preview .k'), /hue-green/, 'Done keeps its category colour');
      await page.close();
    });
  }

  test('the picked colour is saved and the grid chip wears it', async () => {
    const page = await openWorkflowTray('light');
    await page.fill('#tray-back input[name="name"]', 'Status');
    await pickHue(page, 1, 'purple');
    await page.click('#tray-back button[type="submit"]');
    await page.waitForSelector('#tray-back', { state: 'detached' });
    const states = fieldNamed('Status').config.states;
    assert.equal(states[1].hue, 'purple', 'the colour reached the engine');
    assert.equal('hue' in states[0], false, 'the states nobody touched stored none');
    weave.setState(row.id, 'Status', 'In progress');
    await page.reload({ waitUntil: 'networkidle' });
    const chip = await page.locator('.wv-grid .k-state').first().getAttribute('class');
    assert.match(chip, /hue-purple/, 'the grid cell agrees with the tray');
    await page.close();
  });

  test('reset puts the state back on its category colour', async () => {
    const page = await openWorkflowTray('light');
    await pickHue(page, 2, 'pink');
    assert.match(await classOf(page, 2, '.opt-color'), /hue-pink/);
    await rowAt(page, 2).locator('.opt-color').click();
    await page.waitForSelector('.chip-pop .pick-reset');
    await page.click('.chip-pop .pick-reset');
    await rowAt(page, 2).locator('.opt-color.hue-green').waitFor();
    await page.click('#tray-back input[name="name"]');
    await page.waitForSelector('.chip-pop', { state: 'detached' });
    assert.match(await classOf(page, 2, '.opt-color'), /hue-green/, 'Done is green again');
    await page.fill('#tray-back input[name="name"]', 'Stage');
    await page.click('#tray-back button[type="submit"]');
    await page.waitForSelector('#tray-back', { state: 'detached' });
    assert.equal('hue' in fieldNamed('Stage').config.states[2], false, 'and nothing was stored');
    await page.close();
  });

  test('a state with no colour of its own offers no reset', async () => {
    const page = await openWorkflowTray('light');
    await rowAt(page, 0).locator('.opt-color').click();
    await page.waitForSelector('.chip-pop .swatch-grid');
    assert.equal(await page.locator('.chip-pop .pick-reset').count(), 0,
      'there is nothing to reset until a colour is picked');
    await page.close();
  });
}
