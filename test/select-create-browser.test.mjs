import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, painted, eventually } from './lib/browser.mjs';

const s = await launch('creating an option from the cell', (weave) => {
  weave.createSpace({ name: 'Ops' });
  const run = weave.createTable({ space: 'Ops', name: 'Run' });
  weave.addField('Run', { name: 'Schedule', type: 'select', config: { options: [] } });
  weave.addField('Run', { name: 'Shift', type: 'select', config: { options: ['Morning', 'Evening'] } });
  weave.addField('Run', { name: 'Tags', type: 'multiselect', config: { options: [] } });
  const row = weave.createEntity('Run', { name: 'Backfill' });
  return { run, row };
});

if (s) {
  const { base, browser, weave, run, row } = s;
  const optionsOf = (name) => Object.values(weave.getTable('Run').fields).find((f) => f.name === name).config.options.map((o) => o.name ?? o);

  const openCell = async (page, field) => {
    await page.goto(`${base}/#/table/${run.id}`, { waitUntil: 'networkidle' });
    const sel = `tr[data-eid="${row.id}"] td[data-field="${field}"] .chip-trigger, tr[data-eid="${row.id}"] td[data-field="${field}"] .ms-box`;
    await painted(page, sel);
    await page.locator(sel).first().click();
    await painted(page, '.picker-pop .picker-search');
  };

  test('an empty select says so, and typing a value offers to create it (Issue #800)', async () => {
    const page = await browser.newPage();
    try {
      await openCell(page, 'Schedule');
      assert.match(await page.locator('.picker-pop .picker-empty').textContent(), /No options yet\. Type to add one\./,
        'an empty select names its emptiness and the way out of it');
      assert.equal(await page.locator('.picker-create').count(), 0, 'nothing typed, nothing offered');

      await page.locator('.picker-pop .picker-search').fill('Nightly');
      await painted(page, '.picker-pop .picker-create');
      const create = page.locator('.picker-pop .picker-create');
      assert.match(await create.textContent(), /Create “Nightly”/, 'the row names the value it will create');
      assert.match(await create.textContent(), /↵/, 'and says Enter is what does it');
      assert.equal(await page.locator('.picker-pop .picker-list > *').first().getAttribute('class'), await create.getAttribute('class'),
        'the create row is the first row in the list');

      await page.keyboard.press('Enter');
      await eventually(() => Promise.resolve(optionsOf('Schedule').join(',')), 'Nightly');
      await eventually(() => Promise.resolve(weave.readEntity(row.id).fields.Schedule), 'Nightly');
      await painted(page, `tr[data-eid="${row.id}"] td[data-field="Schedule"] .k`);
      assert.equal(await page.locator(`tr[data-eid="${row.id}"] td[data-field="Schedule"] .k`).first().textContent(), 'Nightly',
        'and the cell wears it without a reload');
    } finally { await page.close(); }
  });

  test('a select with options offers to create only what it does not already hold (Issue #800)', async () => {
    const page = await browser.newPage();
    try {
      await openCell(page, 'Shift');
      await page.locator('.picker-pop .picker-search').fill('Morning');
      assert.equal(await page.locator('.picker-pop .picker-create').count(), 0, 'an option by that name is already there');
      await page.locator('.picker-pop .picker-search').fill('Morn');
      assert.equal(await page.locator('.picker-pop .picker-create').count(), 1, 'a partial match still offers the new value');
      assert.doesNotMatch(await page.locator('.picker-pop .picker-create').textContent(), /↵/,
        'but Enter picks the match that is armed, so the row claims no key');
      await page.keyboard.press('Enter');
      await eventually(() => Promise.resolve(weave.readEntity(row.id).fields.Shift), 'Morning');
      assert.deepEqual(optionsOf('Shift'), ['Morning', 'Evening'], 'and no option was created');
    } finally { await page.close(); }
  });

  test('a multi-select creates the option and stages it, keeping the picker open (Issue #800)', async () => {
    const page = await browser.newPage();
    try {
      await openCell(page, 'Tags');
      await page.locator('.picker-pop .picker-search').fill('Urgent');
      await painted(page, '.picker-pop .picker-create');
      await page.locator('.picker-pop .picker-create').click();
      await eventually(() => Promise.resolve(optionsOf('Tags').join(',')), 'Urgent');
      await painted(page, '.picker-pop .picker-chip');
      assert.equal(await page.locator('.picker-pop .picker-chip').textContent(), 'Urgent',
        'the new option is staged as a chip and the picker is still open');
      await page.keyboard.press('Escape');
      await eventually(() => Promise.resolve((weave.readEntity(row.id).fields.Tags ?? []).join(',')), 'Urgent');
    } finally { await page.close(); }
  });

  test('a system table takes no new options from a cell (Issue #800)', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/#/table/${run.id}`, { waitUntil: 'networkidle' });
      const made = await page.evaluate(() => {
        const db = allTables().find((t) => t.system);
        const f = db?.fields.find((x) => x.type === 'select' || x.type === 'multiselect');
        return f ? !!optionCreator(db, f, () => {}) : 'no system select';
      });
      assert.ok(made === false || made === 'no system select', `a system field offers no create path (${made})`);
    } finally { await page.close(); }
  });
}
