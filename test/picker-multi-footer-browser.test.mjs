import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, painted, eventually } from './lib/browser.mjs';

const s = await launch('multi picker footer', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.addField('Issue', { name: 'Symptom', type: 'multiselect', config: { options: ['Slow', 'Looks broken', 'Wrong data', 'Error'] } });
  weave.addField('Issue', { name: 'Category', type: 'select', config: { options: ['UI', 'Engine'] } });
  return { issues };
});

if (s) {
  const { base, browser, weave, issues } = s;
  const fresh = () => weave.createEntity('Issue', { name: 'Footer case' }).id;
  const cell = (id, field) => `tr[data-eid="${id}"] td[data-field="${field}"]`;
  const openCell = async (page, id, field) => {
    await page.goto(`${base}/#/table/${issues.id}`, { waitUntil: 'networkidle' });
    const sel = `${cell(id, field)} .chip-trigger, ${cell(id, field)} .ms-box`;
    await painted(page, sel);
    await page.locator(sel).first().click();
    await painted(page, '.picker-pop .picker-search');
  };
  const foot = (page) => page.evaluate(() => {
    const f = document.querySelector('.picker-pop .picker-foot');
    return f && !f.hidden ? {
      count: f.querySelector('.picker-count')?.textContent.trim() ?? null,
      done: f.querySelector('.picker-done')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
      countLeft: (() => {
        const c = f.querySelector('.picker-count')?.getBoundingClientRect();
        const d = f.querySelector('.picker-done')?.getBoundingClientRect();
        return !!(c && d && c.right <= d.left);
      })(),
    } : null;
  });
  const row = (page, label) => page.locator('.picker-pop .picker-row', { hasText: label }).first();

  test('a multi picker says how many are picked and commits on Enter, and both chips land in the cell (Issue #798)', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const id = fresh();
    try {
      await openCell(page, id, 'Symptom');
      assert.equal(await page.locator('.picker-pop .picker-title').textContent(), 'Symptom', 'the multi picker names its field');
      assert.deepEqual(await foot(page), { count: '0 selected', done: 'Done ↵', countLeft: true },
        'an empty multi picker already shows its count on the left and Done on the right');
      await row(page, 'Slow').click();
      await row(page, 'Error').click();
      assert.equal((await foot(page)).count, '2 selected');
      assert.equal(await page.locator('.picker-pop .picker-row', { hasText: 'Slow' }).count(), 0, 'a picked option leaves the list');
      assert.equal(await page.locator('.picker-pop .picker-row input[type=checkbox], .picker-pop .picker-check').count(), 0, 'no checkboxes');
      await page.keyboard.press('Enter');
      await eventually(() => page.evaluate(() => document.querySelectorAll('.picker-pop').length), 0);
      await eventually(() => Promise.resolve(JSON.stringify(weave.readEntity(id).fields.Symptom)), JSON.stringify(['Slow', 'Error']));
      await eventually(() => page.$$eval(`${cell(id, 'Symptom')} .ms-box .k:not(.k-add):not(.k-more)`, (ns) => ns.map((n) => n.textContent.trim()).join(',')), 'Slow,Error');
    } finally { await page.close(); }
  });

  test('Done commits what is staged, and a single select carries no count (Issue #798)', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const id = fresh();
    try {
      await openCell(page, id, 'Category');
      assert.equal(await foot(page), null, 'a single select keeps its plain footer');
      await page.keyboard.press('Escape');
      await openCell(page, id, 'Symptom');
      await row(page, 'Wrong data').click();
      assert.equal((await foot(page)).count, '1 selected');
      await page.locator('.picker-pop .picker-done').click();
      await eventually(() => page.evaluate(() => document.querySelectorAll('.picker-pop').length), 0);
      await eventually(() => Promise.resolve(JSON.stringify(weave.readEntity(id).fields.Symptom)), JSON.stringify(['Wrong data']));
    } finally { await page.close(); }
  });
}
