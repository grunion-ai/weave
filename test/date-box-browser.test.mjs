/* A date box is as wide as the date it shows (Issue #159).
   Kyle, 2026-09-03, on the uno Task table: "lock ordinal dates cut off".
   The date input was a fixed 120px (compact) / 200px box, and a costume like
   ordinal — "Wednesday 3rd September 2026" — is longer than either, so the
   value was clipped inside its own control. The box now measures its text.
   Playwright is NOT a dependency of weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let table, row;
const s = await launch('date box width', (weave) => {
  weave.createSpace({ name: 'Product' });
  table = weave.createTable({ space: 'Product', name: 'Task' });
  weave.addField(table, { name: 'Lock', type: 'date', config: { format: 'ordinal' } });
  weave.addField(table, { name: 'Due', type: 'date', config: { format: 'iso' } });
  row = weave.createEntity(table, { name: 'Sized', values: { Lock: '2026-09-30', Due: '2026-09-30' } });
});

if (s) {
  const { base, browser } = s;
  const boxes = (page) => page.evaluate((id) => {
    const tr = document.querySelector(`tr[data-eid="${id}"]`);
    const read = (f) => { const i = tr.querySelector(`td[data-field="${f}"] input.date-text`); return { value: i.value, cut: i.scrollWidth - i.clientWidth, width: i.getBoundingClientRect().width }; };
    return { lock: read('Lock'), due: read('Due') };
  }, row.id);

  test('an ordinal date shows whole in the grid; a short one keeps a short box', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`tr[data-eid="${row.id}"] input.date-text`);
    await page.waitForTimeout(300);
    const b = await boxes(page);
    assert.match(b.lock.value, /30th/, 'the ordinal costume is on');
    assert.ok(b.lock.cut <= 1, `nothing is cut off (${b.lock.cut}px hidden in a ${Math.round(b.lock.width)}px box)`);
    assert.ok(b.lock.width > b.due.width + 40, `the long date got the wider box (${Math.round(b.lock.width)} vs ${Math.round(b.due.width)})`);
    await page.close();
  });

  test('the entity page sizes the same control the same way', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('input.date-text');
    await page.waitForTimeout(300);
    const cut = await page.$$eval('input.date-text', (is) => is.map((i) => ({ v: i.value, cut: i.scrollWidth - i.clientWidth })));
    const lock = cut.find((c) => /30th/.test(c.v));
    assert.ok(lock, 'the ordinal date is on the page');
    assert.ok(lock.cut <= 1, `nothing is cut off (${lock.cut}px hidden)`);
    await page.close();
  });
}
