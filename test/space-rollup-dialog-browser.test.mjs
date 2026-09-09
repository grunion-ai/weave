/* Authoring a space rollup from the field dialog, driven through a real
   browser (Issue #222).

   A rollup over a WHOLE table — the Σ under a grid column — is a field on
   the Workspace/Spaces row of the space that holds the table, and `via`
   names the table instead of a relation to cross. Three surfaces could
   write one: the Σ footer picker, `weave field add --config`, and
   `weave_add_field`. The field dialog could not: its rollup section offered
   only the Spaces table's own relations, so `+ field → rollup` on the
   registry grid produced a count of Tables or Workflows and nothing else.

   Now the registry's rollup section asks which of the two a reader means,
   and "Over a table" picks the table, the column and the aggregate. The
   mode is offered on the Spaces registry alone, which is where the engine
   accepts `via` — everywhere else the section stays as it was.

   Playwright is NOT a dependency of weave; it is imported dynamically and
   the suite skips when absent, so `node --test` stays green on a bare
   checkout. */
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

  /* The add-field tray on a grid, with the rollup tile chosen. */
  const openRollupTray = async (tableId, theme = 'light') => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/table/${tableId}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.click('.wv-grid .add-field-btn');
    await page.waitForSelector('#tray');
    // The tile is its mark and its label: "Σ" then "rollup".
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
    // The engine refuses `via` anywhere but the registry, so nowhere else
    // offers it: an ordinary table's rollup is a relation, full stop.
    const plain = await openRollupTray(sessions.id);
    assert.equal(await modeSection(plain).count(), 0, 'no mode question off the registry');
    await plain.close();
  });

  test('"Over a table" writes the field the Σ footer picker would', async () => {
    const before = spaceRollups().length;
    const page = await openRollupTray(spacesT.id, 'dark');
    await page.fill('#tray input[name=name]', 'Sessions · Cost · sum');
    await modeSection(page).locator('.seg-opt', { hasText: 'Over a table' }).click();
    // The table, then the column of it, then how to add them up.
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
    // And it answers on the space's own row, the way the footer reads it.
    const row = weave.query(spacesT.id, { where: [['Name', '=', 'Agent']] }).items[0];
    assert.equal(row.raw['Sessions · Cost · sum'], 5);
    await page.close();
  });

  test('a count needs no column, and switching back writes a relation rollup', async () => {
    const page = await openRollupTray(spacesT.id);
    await modeSection(page).locator('.seg-opt', { hasText: 'Over a table' }).click();
    assert.equal(await page.locator('#tray .dlg-sec', { has: page.locator('.dlg-lbl', { hasText: /^Target field$/ }) }).count(), 0,
      'count reads the rows, not a column');
    // Back to a relation: the registry's own relations are the choice again.
    await modeSection(page).locator('.seg-opt', { hasText: 'Through a relation' }).click();
    assert.equal(await page.locator('#tray .dlg-sec', { has: page.locator('.dlg-lbl', { hasText: /^Table$/ }) }).count(), 0);
    assert.equal(await page.locator('#tray .dlg-sec', { has: page.locator('.dlg-lbl', { hasText: /^Relation$/ }) }).count(), 1);
    await page.close();
  });
}
