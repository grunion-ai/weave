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
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const chromium = await import('playwright')
  .then((pw) => pw.chromium)
  .catch(() => null);

if (!chromium) {
  test('daterange (browser)', { skip: 'playwright not installed' }, () => {});
} else {
  let server, base, browser, weave, sprints;

  test.before(async () => {
    weave = new Weave();
    weave.createSpace({ name: 'Product' });
    sprints = weave.createTable({ space: 'Product', name: 'Sprint' });
    weave.addField(sprints, { name: 'Window', type: 'daterange' });
    weave.addField(sprints, { name: 'Readable', type: 'daterange', config: { format: 'long' } });
    ({ server } = await startServer(weave, { port: 0 }));
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
  });

  test.after(async () => {
    await browser?.close();
    server?.close();
  });

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
