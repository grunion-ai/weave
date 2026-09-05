/* A date range on the entity page, driven through a real browser (Issue #91,
   #156, #197).

   The costume is pure and covered in test/date-core.test.mjs. What needs a
   browser is the claim those cases cannot make: that the value a person sees
   in the row is text. `#displayValue` had no `daterange` case, so the stored
   `{ start, end }` walked all the way to the DOM and the browser stringified
   it — Kyle's screenshot read `Window   [object Object]` while every engine
   test passed.

   Issue #197 (Kyle, 2026-09-05): "defining a date range is wrong. start and
   end need to be selected in the same date dialog. also default date ranges
   need the same dialog in the config tray." A range was two date controls
   side by side, each with its own calendar; the tray's default was a bare
   text box the engine could only refuse. Now ONE control everywhere a range
   is edited — cell, entity page, the tray's default — a box that reads the
   whole range and a calendar button opening ONE range dialog: first click
   sets the start, second the end, the span between them lit; typed start
   and end inputs inside the same dialog; Clear and Today.

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
  weave.addField(sprints, { name: 'Quarter', type: 'daterange', config: { grain: ['year', 'month'] } });
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
    assert.deepEqual(row.inputs, ['2026-08-01 – 2026-09-15'], 'one box reads the whole range');
  });

  test('the field\'s format reaches both ends of the control', async () => {
    const id = freshSprint({ Readable: { start: '2026-08-01', end: '2026-09-15' } });
    const row = await rowText(id, 'Readable');
    assert.deepEqual(row.inputs, ['Aug 1 – Sep 15, 2026']);
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

  /* The one range dialog (Issue #197): two clicks on one calendar make a
     span. Both themes, because the lit span is a new paint. */
  for (const colorScheme of ['light', 'dark']) {
    test(`two clicks in ONE dialog set start then end, in ${colorScheme}`, async () => {
      const id = freshSprint({});
      const page = await browser.newPage({ colorScheme });
      try {
        await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.entity-fields .fieldrow');
        const row = page.locator('.entity-fields .fieldrow', { hasText: 'Window' }).first();
        assert.equal(await row.locator('.date-pick-btn').count(), 1, 'one calendar button, not one per end');
        await row.locator('.date-pick-btn').click();
        const pop = page.locator('.date-pop.range');
        await pop.waitFor();
        assert.equal(await page.locator('.date-pop').count(), 1, 'one dialog');
        assert.equal(await pop.locator('.date-smart').count(), 2, 'typed start and end inputs live inside it');
        // A typed start is the first pick: it lands, the calendar follows it,
        // and nothing is committed yet — the dialog stays open for the end.
        await pop.locator('.date-smart').first().fill('2026-08-10');
        await pop.locator('.date-smart').first().press('Enter');
        assert.equal(weave.readEntity(id).raw.Window ?? null, null, 'one end is a start, not a range');
        assert.equal(await pop.locator('.date-day.sel').count(), 1, 'the start is lit');
        assert.equal(await page.locator('.date-pop').count(), 1, 'and the dialog waits for the end');
        // The second pick is a click on the same calendar: the end.
        await pop.locator('.date-day.in', { hasText: /^14$/ }).click();
        await page.waitForTimeout(300);
        assert.deepEqual(weave.readEntity(id).raw.Window, { start: '2026-08-10', end: '2026-08-14' });
        assert.equal(await page.locator('.date-pop').count(), 0, 'the second click is done: the dialog closes');
        assert.equal(await row.locator('.range-text').inputValue(), '2026-08-10 – 2026-08-14');
      } finally { await page.close(); }
    });
  }

  test('the span between the two ends is lit, and a backwards second click swaps the ends', async () => {
    const id = freshSprint({ Window: { start: '2026-08-10', end: '2026-08-14' } });
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
      const row = page.locator('.entity-fields .fieldrow', { hasText: 'Window' }).first();
      await row.locator('.date-pick-btn').click();
      const pop = page.locator('.date-pop.range');
      await pop.waitFor();
      assert.equal(await pop.locator('.date-day.sel').count(), 2, 'both ends are lit');
      assert.equal(await pop.locator('.date-day.in-range').count(), 3, 'the 11th, 12th and 13th sit between them');
      const lit = await pop.locator('.date-day.in-range').first().evaluate((n) => getComputedStyle(n).backgroundColor);
      assert.notEqual(lit, 'rgba(0, 0, 0, 0)', 'the span has a paint of its own');
      await pop.locator('.date-day.in', { hasText: /^20$/ }).click();   // new start
      await pop.locator('.date-day.in', { hasText: /^18$/ }).click();   // earlier than the start: swapped
      await page.waitForTimeout(300);
      assert.deepEqual(weave.readEntity(id).raw.Window, { start: '2026-08-18', end: '2026-08-20' });
    } finally { await page.close(); }
  });

  test('typed start and end inside the dialog commit on Enter; Clear empties the range', async () => {
    const id = freshSprint({ Window: { start: '2026-08-10', end: '2026-08-14' } });
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
      const row = page.locator('.entity-fields .fieldrow', { hasText: 'Window' }).first();
      await row.locator('.date-pick-btn').click();
      const pop = page.locator('.date-pop.range');
      const ends = pop.locator('.date-smart');
      await ends.nth(0).fill('2026-09-01');
      await ends.nth(0).press('Enter');
      // Enter on the start begins a new span: the old end goes, the dialog
      // stays open and focus is handed to the end input.
      assert.equal(await page.locator('.date-pop.range').count(), 1, 'the dialog waits for the end');
      assert.equal(await pop.locator('.date-day.sel').count(), 1, 'only the new start is lit');
      assert.ok(await ends.nth(1).evaluate((n) => n === document.activeElement), 'focus moves to the end input');
      await ends.nth(1).fill('2026-09-30');
      await ends.nth(1).press('Enter');
      await page.waitForTimeout(300);
      assert.deepEqual(weave.readEntity(id).raw.Window, { start: '2026-09-01', end: '2026-09-30' });
      assert.equal(await page.locator('.date-pop').count(), 0, 'Enter on the end is done');
      await row.locator('.date-pick-btn').click();
      await page.locator('.date-pop.range .date-pop-link', { hasText: 'Clear' }).click();
      await page.waitForTimeout(300);
      assert.equal(weave.readEntity(id).raw.Window ?? null, null, 'Clear empties the range');
    } finally { await page.close(); }
  });

  test('the grain reaches the range dialog: a year·month range picks two months', async () => {
    const id = freshSprint({});
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
      const row = page.locator('.entity-fields .fieldrow', { hasText: 'Quarter' }).first();
      await row.locator('.date-pick-btn').click();
      const pop = page.locator('.date-pop.range');
      await pop.waitFor();
      assert.equal(await pop.locator('.date-pick-cell').count(), 12, 'the month grid, not a calendar');
      await pop.locator('.date-pick-cell', { hasText: 'Jan' }).click();
      await pop.locator('.date-pick-cell', { hasText: 'Mar' }).click();
      await page.waitForTimeout(300);
      const year = new Date().getFullYear();
      assert.deepEqual(weave.readEntity(id).raw.Quarter, { start: `${year}-01`, end: `${year}-03` });
    } finally { await page.close(); }
  });

  /* The grid cell is the same one control (Issue #156 kept: a range is
     edited where a date is). */
  test('the grid cell edits a range with the same one control and dialog', async () => {
    const id = freshSprint({ Window: { start: '2026-08-01', end: '2026-09-15' } });
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/#/table/${sprints.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr');
      const row = page.locator('.wv-grid tbody tr', { has: page.locator(`[data-eid="${id}"], [href*="${id}"]`) }).first();
      const cell = row.locator('td[data-ftype="daterange"]').first();
      await cell.click();
      const box = cell.locator('.range-text');
      await box.waitFor();
      assert.equal(await box.inputValue(), '2026-08-01 – 2026-09-15', 'the whole range in one box');
      assert.equal(await cell.locator('.date-pick-btn').count(), 1, 'one calendar button');
      assert.equal(await row.locator('.k-range').count(), 0, 'the read-only chip is gone');
      await box.fill('2026-08-01 – 2026-08-30');
      await box.press('Enter');
      await page.waitForTimeout(300);
      assert.deepEqual(weave.readEntity(id).raw.Window, { start: '2026-08-01', end: '2026-08-30' }, 'a typed range commits from the grid');
      await cell.locator('.date-pick-btn').click();
      await page.locator('.date-pop.range').waitFor();
      assert.equal(await page.locator('.date-pop.range .date-day.sel').count(), 2, 'the same dialog, both ends lit');
    } finally { await page.close(); }
  });

  test('typing a whole range in the box commits; half a range commits nothing', async () => {
    const id = freshSprint({});
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.entity-fields .fieldrow');
    const box = page.locator('.entity-fields .fieldrow', { hasText: 'Window' }).first().locator('.range-text');

    await box.fill('2026-08-01');
    await box.press('Enter');
    await page.waitForTimeout(200);
    assert.equal(weave.readEntity(id).raw.Window ?? null, null, 'one end alone is not a range');

    await box.fill('2026-08-01 to 2026-09-15');
    await box.press('Enter');
    await page.waitForTimeout(300);
    assert.deepEqual(weave.readEntity(id).raw.Window, { start: '2026-08-01', end: '2026-09-15' });
    assert.equal(weave.readEntity(id).fields.Window, '2026-08-01 – 2026-09-15');
    await page.close();
  });

  /* The tray's default (Feature #96) wears the SAME control and dialog. */
  test('the config tray sets a default range through the same dialog, and a new row inherits it', async () => {
    const id = freshSprint({});
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
      await page.locator('.entity-fields .fieldrow', { hasText: 'Window' }).first().locator('.fieldrow-label').click();
      await page.waitForSelector('#tray');
      const dflt = page.locator('#tray .dlg-sec', { has: page.locator('.dlg-lbl', { hasText: /^Default$/ }) });
      assert.equal(await dflt.locator('.range-text').count(), 1, 'the default is the range control, not a text box');
      await dflt.locator('.date-pick-btn').click();
      const pop = page.locator('.date-pop.range');
      await pop.waitFor();
      await pop.locator('.date-smart').first().fill('2026-10-01');
      await pop.locator('.date-smart').first().press('Enter');
      await pop.locator('.date-day.in', { hasText: /^5$/ }).click();
      await page.waitForTimeout(200);
      assert.equal(await dflt.locator('.range-text').inputValue(), '2026-10-01 – 2026-10-05');
      await page.locator('#tray .btn-primary').click();
      await page.waitForSelector('#tray', { state: 'detached' });
      const field = weave.getField(sprints, 'Window');
      assert.deepEqual(field.config.default, { start: '2026-10-01', end: '2026-10-05' }, 'the default is stored as a range');
      const born = weave.createEntity(sprints, { name: 'Inherits' });
      assert.deepEqual(weave.readEntity(born.id).raw.Window, { start: '2026-10-01', end: '2026-10-05' }, 'a new row inherits the default');
      // The tray reads it back into the same control.
      // (Saving a field from the entity page lands on the table; a same-hash
      // goto is a no-op, so reload to get the page back.)
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('.entity-fields .fieldrow', { hasText: 'Window' }).first().locator('.fieldrow-label').click();
      await page.waitForSelector('#tray');
      assert.equal(await dflt.locator('.range-text').inputValue(), '2026-10-01 – 2026-10-05', 'the stored default comes back as a range, not [object Object]');
    } finally { await page.close(); }
  });
}
