import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, settled } from './lib/browser.mjs';

let tasks;
const s = await launch('blank icon slot', (weave) => {
  weave.createSpace({ name: 'Ops' });
  tasks = weave.createTable({ space: 'Ops', name: 'Task' });
  weave.createEntity(tasks, { name: 'Ship it' });
});

if (s) {
  const { base, browser } = s;

  const park = (page) => page.mouse.move(120, 860);

  const look = async (btn) => {
    await settled(btn);
    return btn.evaluate((b) => {
      const cs = getComputedStyle(b);
      return {
        cls: b.className, text: b.textContent.trim(),
        ghost: !!b.querySelector('.icon-ghost'),
        hover: b.matches(':hover'),
        width: b.getBoundingClientRect().width, height: b.getBoundingClientRect().height,
        border: cs.borderTopWidth, background: cs.backgroundColor, font: cs.fontSize,
      };
    });
  };

  const openTray = async (theme, type) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await park(page);
    const table = await look(page.locator('.view-title-row .icon-btn'));
    await page.click('.add-field-head .add-field-btn');
    await page.waitForSelector('#tray-back .type-tile');
    await page.click(`#tray-back .type-tile[title="${type}"]`);
    await page.waitForSelector('#tray-back .opt-list');
    await settled(page.locator('#tray'));
    await park(page);
    return { page, table, park: () => park(page) };
  };

  for (const theme of ['light', 'dark']) {
    test(`an option with no icon draws the table's blank slot (${theme})`, async () => {
      const { page, table, park: parkPointer } = await openTray(theme, 'select');
      assert.ok(table.ghost, 'the table header draws the ghost ring');
      assert.equal(table.hover, false, 'the table slot is read with the pointer parked away from it');
      await page.click('#tray-back .opt-add');
      await parkPointer();
      const opt = await look(page.locator('#tray-back .opt-row').first().locator('button').first());
      assert.equal(opt.hover, false, 'the new row is read with the pointer parked away from it, not under the Add button it replaced');
      assert.doesNotMatch(opt.text, /—/, 'no em dash');
      assert.deepEqual(opt, table, 'same element, glyph and box as the table slot');
      await page.close();
    });

    test(`a state with no icon draws the table's blank slot (${theme})`, async () => {
      const { page, table } = await openTray(theme, 'workflow');
      const st = await look(page.locator('#tray-back .opt-row').first().locator('button').first());
      assert.equal(st.hover, false, 'the state row is read with the pointer parked away from it');
      assert.doesNotMatch(st.text, /—/, 'no em dash');
      assert.deepEqual(st, table, 'same element, glyph and box as the table slot');
      await page.close();
    });
  }

  test('picking an icon on an option draws the icon, not its stored name', async () => {
    const { page } = await openTray('light', 'select');
    await page.click('#tray-back .opt-add');
    await page.locator('#tray-back .opt-row').first().locator('button').first().click();
    const cell = page.locator('.picker-pop .picker-cell:not(.picker-none)').first();
    await cell.waitFor();
    await cell.click();
    const btn = page.locator('#tray-back .opt-row').first().locator('button').first();
    assert.equal(await btn.locator('.icon-ghost').count(), 0, 'the ghost ring is gone');
    assert.ok(await btn.locator('svg').count() > 0, 'the icon draws');
    assert.doesNotMatch(await btn.textContent(), /\w+:\w/, 'the stored name is not printed');
    await page.close();
  });
}
