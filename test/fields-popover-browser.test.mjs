/* The Fields popover's drag and height (Issues #445, #446; Kyle's rulings
   2026-09-27). A row reads `grab` at rest over its name and its grip, never
   an I-beam; a drag reads `grabbing` for its whole length, over other rows
   and outside the list, and lets go on drop, Escape or pointercancel. The
   insertion line is straight with square ends. The list grows to the room
   below the Fields button before it scrolls, its header sits outside the
   scroll box, and a scrolled list never shows half a row at its top.
   Playwright is NOT a dependency of weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let wide, narrow;
const s = await launch('fields popover drag and height', (weave) => {
  weave.createSpace({ name: 'Ops' });
  wide = weave.createTable({ space: 'Ops', name: 'Wide' });
  for (let i = 1; i <= 24; i++) weave.addField(wide, { name: `Field ${String(i).padStart(2, '0')}`, type: 'text' });
  weave.createEntity(wide, { name: 'Row' });
  narrow = weave.createTable({ space: 'Ops', name: 'Narrow' });
  weave.addField(narrow, { name: 'Owner', type: 'text' });
  weave.createEntity(narrow, { name: 'Row' });
});

if (s) {
  const { base, browser, weave } = s;
  const cursorAt = (page, x, y) => page.evaluate(([x, y]) => { const n = document.elementFromPoint(x, y); return getComputedStyle(n).cursor + (n.closest('.field-reorder-handle, .eye-row, .table-field-row') ? '' : ` (on ${n.tagName}.${n.className?.baseVal ?? n.className})`); }, [x, y]);

  test('a field row reads grab at rest, grabbing for the whole drag, and the drop line is square (Issue #445)', async () => {
    weave.tableView(`${narrow.id}/${weave.tableView(narrow).views[0].id}`, { fields: ['Name', 'Description', 'Owner'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${narrow.id}`, { waitUntil: 'networkidle' });
      await page.click('.eye-btn');
      await page.locator('.table-fields-popover').evaluate((pop) => Promise.all(pop.getAnimations().map((a) => a.finished)));
      const owner = await page.locator('.table-field-row[data-field="Owner"] .eye-label').boundingBox();
      const grip = await page.locator('.table-field-row[data-field="Owner"] .field-reorder-handle').boundingBox();
      const name = await page.locator('.table-field-row[data-field="Name"]').boundingBox();
      assert.equal(await cursorAt(page, owner.x + 4, owner.y + owner.height / 2), 'grab', 'the name reads grab, not an I-beam');
      assert.equal(await cursorAt(page, grip.x + grip.width / 2, grip.y + grip.height / 2), 'grab', 'the grip reads grab');
      await page.mouse.move(owner.x + 4, owner.y + owner.height / 2);
      await page.mouse.down();
      await page.mouse.move(owner.x + 4, owner.y - 8, { steps: 3 });
      await page.mouse.move(name.x + 20, name.y + 3, { steps: 4 });
      assert.equal(await cursorAt(page, name.x + 20, name.y + name.height / 2), 'grabbing', 'over another row, mid-drag');
      assert.match(await cursorAt(page, 40, 600), /^grabbing/, 'outside the list, mid-drag');
      assert.equal(await page.evaluate(() => getSelection().toString()), '', 'the drag selects no text');
      const line = await page.$eval('.table-fields-popover .drop-line', (l) => ({ radius: getComputedStyle(l).borderTopLeftRadius, h: l.getBoundingClientRect().height }));
      assert.equal(line.radius, '0px', 'the insertion line has square ends');
      await page.mouse.up();
      await page.waitForFunction(() => [...document.querySelectorAll('.wv-grid .col-label')].map((h) => h.textContent.trim()).join(',') === 'Owner,Name,Description');
      assert.deepEqual(weave.tableView(narrow).views[0].fields, ['Owner', 'Name', 'Description']);
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('wv-grabbing')), false, 'the drop lets the cursor go');
      assert.equal(await page.locator('.table-fields-popover .drop-line').count(), 0);
      assert.equal(await page.locator('.table-field-row[data-field="Owner"] input').isChecked(), true, 'a drag is not a click: the field still shows');
      // Escape ends a drag in flight without moving anything.
      const desc = await page.locator('.table-field-row[data-field="Description"] .eye-label').boundingBox();
      await page.mouse.move(desc.x + 4, desc.y + desc.height / 2);
      await page.mouse.down();
      await page.mouse.move(desc.x + 4, desc.y - 30, { steps: 4 });
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('wv-grabbing')), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('wv-grabbing')), false, 'Escape lets the cursor go');
      await page.mouse.up();
      await page.waitForLoadState('networkidle');
      assert.deepEqual(weave.tableView(narrow).views[0].fields, ['Owner', 'Name', 'Description'], 'Escape moved nothing');
    } finally { await page.close(); }
  });

  for (const height of [900, 560]) {
    test(`the Fields list grows to the room below its button before it scrolls, header outside the scroll box (Issue #446, ${height}px)`, async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height } });
      try {
        await page.goto(`${base}/#/table/${wide.id}`, { waitUntil: 'networkidle' });
        await page.click('.eye-btn');
        await page.locator('.table-fields-popover').evaluate((pop) => Promise.all(pop.getAnimations().map((a) => a.finished)));
        const m = await page.evaluate(() => {
          const pop = document.querySelector('.table-fields-popover');
          const list = pop.querySelector('.table-field-list');
          const btn = document.querySelector('.eye-btn').getBoundingClientRect();
          return {
            popScrolls: pop.scrollHeight > pop.clientHeight + 1,
            listScrolls: list.scrollHeight > list.clientHeight + 1,
            bottomGap: innerHeight - pop.getBoundingClientRect().bottom,
            below: pop.getBoundingClientRect().top >= btn.bottom,
            legendInList: !!list.querySelector('.table-field-legend'),
            headInList: !!list.querySelector('.table-control-head'),
          };
        });
        assert.equal(m.popScrolls, false, 'the popover itself never scrolls; only the list does');
        assert.equal(m.below, true, 'it opens under its button');
        assert.equal(m.legendInList || m.headInList, false, 'the header sits outside the scroll box');
        if (m.listScrolls) assert.ok(m.bottomGap <= 32, `a scrolling list has used the room below (${m.bottomGap}px left)`);
        if (height === 560) assert.equal(m.listScrolls, true, 'a short window scrolls the list');
        if (m.listScrolls) {
          await page.$eval('.table-field-list', (l) => { l.scrollTop = 50; });
          await page.waitForTimeout(400);
          const cut = await page.$eval('.table-field-list', (l) => {
            const top = l.getBoundingClientRect().top;
            const first = [...l.querySelectorAll('.table-field-row')].find((r) => r.getBoundingClientRect().bottom > top + 1);
            return first.getBoundingClientRect().top - top;
          });
          assert.ok(Math.abs(cut) <= 3, `the first visible row starts at the top of the list, not half under it (${cut}px)`);
        }
      } finally { await page.close(); }
    });
  }
}
