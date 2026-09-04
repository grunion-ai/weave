/* A date range on the entity page, driven through a real browser (Issue #91).

   The costume is pure and covered in test/date-core.test.mjs. What needs a
   browser is the claim those cases cannot make: that the value a person sees
   in the row is text. `#displayValue` had no `daterange` case, so the stored
   `{ start, end }` walked all the way to the DOM and the browser stringified
   it — Kyle's screenshot read `Window   [object Object]` while every engine
   test passed. The generic text `<input>` behind it could only ever hand the
   server a string it must refuse, so editing is covered here too.

   Playwright is NOT a dependency of weave; it is imported dynamically and the
   suite skips when absent, so `node --test` stays green on a bare checkout. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let sprints;

const s = await launch('daterange', (weave) => {
  weave.createSpace({ name: 'Product' });
  sprints = weave.createTable({ space: 'Product', name: 'Sprint' });
  weave.addField(sprints, { name: 'Window', type: 'daterange' });
  weave.addField(sprints, { name: 'Readable', type: 'daterange', config: { format: 'long' } });
});
if (s) {
  const { base, browser, weave } = s;
  const freshSprint = (values) => weave.createEntity(sprints, { name: 'Range case', values }).id;

  /* The row's rendered text, exactly as a reader sees it. */
  async function rowText(id, label) {
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.entity-fields .fieldrow');
    const text = await page.evaluate((name) => {
      // The row opens with its drag handle, so the label is not at index 0.
      const row = [...document.querySelectorAll('.entity-fields .fieldrow')]
        .find((r) => r.textContent.includes(name));
      if (!row) return null;
      const inputs = [...row.querySelectorAll('input')].map((i) => i.value);
      return { text: row.textContent, inputs };
    }, label);
    await page.close();
    return text;
  }

  test('a range reads as dates on the page, never as [object Object]', async () => {
    const id = freshSprint({ Window: { start: '2026-08-01', end: '2026-09-15' } });
    const row = await rowText(id, 'Window');
    assert.ok(row, 'the Window row is on the page');
    assert.ok(!row.text.includes('[object Object]'), `row still paints an object: ${row.text}`);
    assert.deepEqual(row.inputs, ['2026-08-01', '2026-09-15']);
  });

  test('the field\'s format reaches both ends of the control', async () => {
    const id = freshSprint({ Readable: { start: '2026-08-01', end: '2026-09-15' } });
    const row = await rowText(id, 'Readable');
    assert.deepEqual(row.inputs, ['Aug 1, 2026', 'Sep 15, 2026']);
  });

  test('the activity feed says which dates changed, not [object Object]', async () => {
    const id = freshSprint({ Window: { start: '2026-08-01', end: '2026-09-15' } });
    weave.updateEntity(id, { Window: { start: '2026-08-03', end: '2026-09-15' } });
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.activity-item', { state: 'attached' });
    const leaks = await page.locator('text=[object Object]').count();
    assert.equal(leaks, 0, 'the history painted the stored object');
    assert.match(await page.locator('.activity-item').first().textContent(), /2026-08-03/);
    await page.close();
  });

  /* Issue #156. The grid cell was a read-only chip whose tooltip sent you to
     the record page; Kyle clicked it eleven times. A range is edited where a
     date is: the cell holds the same two controls the record page does. */
  test('the grid cell edits a range with the same two date controls', async () => {
    const id = freshSprint({ Window: { start: '2026-08-01', end: '2026-09-15' } });
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/#/table/${sprints.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr');
      const row = page.locator('.wv-grid tbody tr', { has: page.locator(`[data-eid="${id}"], [href*="${id}"]`) }).first();
      // The fixture has two range fields; the first range cell is Window's.
      const ends = row.locator('td').filter({ has: page.locator('.range-box') }).first().locator('.date-text');
      assert.equal(await ends.count(), 2, 'both ends are date controls, in the cell');
      assert.deepEqual(await ends.evaluateAll((ns) => ns.map((n) => n.value)), ['2026-08-01', '2026-09-15']);
      assert.equal(await row.locator('.k-range').count(), 0, 'the read-only chip is gone');
      await ends.nth(1).fill('2026-09-30');
      await ends.nth(1).press('Enter');
      await page.waitForTimeout(300);
      assert.deepEqual(weave.readEntity(id).raw.Window, { start: '2026-08-01', end: '2026-09-30' }, 'an edited end commits the range from the grid');
    } finally { await page.close(); }
  });

  test('typing both ends commits one range; a half-written range commits nothing', async () => {
    const id = freshSprint({});
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.entity-fields .fieldrow');
    const box = page.locator('.entity-fields .fieldrow', { hasText: 'Window' }).first().locator('.range-box input');

    await box.nth(0).fill('2026-08-01');
    await box.nth(0).press('Enter');
    await page.waitForTimeout(200);
    assert.equal(weave.readEntity(id).raw.Window ?? null, null, 'one end alone is not a range');

    await box.nth(1).fill('2026-09-15');
    await box.nth(1).press('Enter');
    await page.waitForTimeout(300);
    assert.deepEqual(weave.readEntity(id).raw.Window, { start: '2026-08-01', end: '2026-09-15' });
    assert.equal(weave.readEntity(id).fields.Window, '2026-08-01 – 2026-09-15');
    await page.close();
  });
}
