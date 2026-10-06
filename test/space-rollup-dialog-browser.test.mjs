import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let sessions, spacesT;
const s = await launch('space rollup dialog', (weave) => {
  weave.createSpace({ name: 'Agent' });
  sessions = weave.createTable({ space: 'Agent', name: 'Sessions' });
  weave.addField(sessions, { name: 'Cost', type: 'number' });
  weave.createEntity(sessions, { name: 'a', values: { Cost: 2 } });
  weave.createEntity(sessions, { name: 'b', values: { Cost: 3 } });
  spacesT = Object.values(weave.state.tables).find((t) => t.system === 'spaces');
});

if (s) {
  const { browser, base, weave } = s;

  const openRollupTray = async (tableId, theme = 'light') => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/table/${tableId}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.click('.wv-grid .add-field-btn');
    await page.waitForSelector('#tray');
    await page.locator('#tray .type-tile', { hasText: 'rollup' }).click();
    return page;
  };
  const modeSection = (page) => page.locator('#tray .dlg-sec', { has: page.locator('.dlg-lbl', { hasText: /^Rolls up$/ }) });
  const spaceRollups = () => Object.values(weave.getTable(spacesT.id).fields).filter((f) => f.type === 'rollup' && f.config.via);

  test('the registry grid asks which kind of rollup; an ordinary grid does not', async () => {
    const page = await openRollupTray(spacesT.id);
    assert.deepEqual(await modeSection(page).locator('.seg-opt').allTextContents(),
      ['Through a relation', 'Over a table'], 'both kinds are offered on the Spaces registry');
    await page.close();
    const plain = await openRollupTray(sessions.id);
    assert.equal(await modeSection(plain).count(), 0, 'no mode question off the registry');
    await plain.close();
  });

  test('"Over a table" writes the field the Σ footer picker would', async () => {
    const before = spaceRollups().length;
    const page = await openRollupTray(spacesT.id, 'dark');
    await page.fill('#tray input[name=name]', 'Sessions · Cost · sum');
    await modeSection(page).locator('.seg-opt', { hasText: 'Over a table' }).click();
    await page.locator('#tray .dlg-sec', { has: page.locator('.dlg-lbl', { hasText: /^Table$/ }) }).locator('.picker-face').click();
    await page.locator('.picker-pop .picker-row', { hasText: 'Sessions' }).first().click();
    await page.locator('#tray .dlg-sec', { has: page.locator('.dlg-lbl', { hasText: /^Aggregate$/ }) }).locator('.seg-opt', { hasText: /^sum$/ }).click();
    await page.locator('#tray .dlg-sec', { has: page.locator('.dlg-lbl', { hasText: /^Target field$/ }) }).locator('.picker-face').click();
    await page.locator('.picker-pop .picker-row', { hasText: 'Cost' }).first().click();
    await page.click('#tray button[type=submit]');
    await page.waitForSelector('#tray', { state: 'detached' });

    const made = spaceRollups().filter((f) => f.name === 'Sessions · Cost · sum');
    assert.equal(made.length, 1, 'one space rollup landed');
    assert.equal(made[0].config.via, sessions.id, 'it reads the whole Sessions table');
    assert.equal(made[0].config.aggregate, 'sum');
    assert.equal(spaceRollups().length, before + 1);
    const row = weave.query(spacesT.id, { where: [['Name', '=', 'Agent']] }).items[0];
    assert.equal(row.raw['Sessions · Cost · sum'], 5);
    await page.close();
  });

  test('a count needs no column, and switching back writes a relation rollup', async () => {
    const page = await openRollupTray(spacesT.id);
    await modeSection(page).locator('.seg-opt', { hasText: 'Over a table' }).click();
    assert.equal(await page.locator('#tray .dlg-sec', { has: page.locator('.dlg-lbl', { hasText: /^Target field$/ }) }).count(), 0,
      'count reads the rows, not a column');
    await modeSection(page).locator('.seg-opt', { hasText: 'Through a relation' }).click();
    assert.equal(await page.locator('#tray .dlg-sec', { has: page.locator('.dlg-lbl', { hasText: /^Table$/ }) }).count(), 0);
    assert.equal(await page.locator('#tray .dlg-sec', { has: page.locator('.dlg-lbl', { hasText: /^Relation$/ }) }).count(), 1);
    await page.close();
  });
}
