import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tasks, people, ids = [], ann;
const s = await launch('row selection', (weave) => {
  weave.createSpace({ name: 'Product' });
  people = weave.createTable({ space: 'Product', name: 'Person' });
  tasks = weave.createTable({ space: 'Product', name: 'Task' });
  weave.addField(tasks, { name: 'Estimate', type: 'number' });
  weave.addField(tasks, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true }, { name: 'Done', category: 'done' }] } });
  weave.addRelation(tasks, { name: 'Owner', targetDb: people, cardinality: 'many-to-one', inverseName: 'Tasks' });
  ann = weave.createEntity(people, { name: 'Ann' });
  weave.createEntity(people, { name: 'Bob' });
  for (const [name, est] of [['Echo', 5], ['Delta', 4], ['Charlie', 3], ['Bravo', 2], ['Alpha', 1]]) {
    ids.push(weave.createEntity(tasks, { name, values: { Estimate: est } }).id);
  }
});
if (s) {
  const { base, browser } = s;

  async function grid() {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    return page;
  }

  const boxes = (page) => page.locator('.wv-grid tbody .sel-box');

  test('the checkbox sits left of the # link, in both the head and the row', async () => {
    const page = await grid();
    try {
      const geo = await page.evaluate(() => {
        const row = document.querySelector('.wv-grid tbody tr.entity-row');
        const head = document.querySelector('.wv-grid thead tr');
        const r = (n) => n.getBoundingClientRect();
        return {
          rowSel: r(row.querySelector('.sel-cell')).left,
          rowPid: r(row.querySelector('.pid-cell')).left,
          headSel: r(head.querySelector('.sel-head')).left,
          headPid: r(head.querySelector('.pid-head')).left,
          linkVisible: !!row.querySelector('.pid-cell .open-link')?.offsetParent,
        };
      });
      assert.ok(geo.rowSel < geo.rowPid, 'the row checkbox is left of #');
      assert.ok(geo.headSel < geo.headPid, 'the header checkbox is left of #');
      assert.ok(geo.linkVisible, 'the # link is still on the page');
    } finally { await page.close(); }
  });

  test('the column is invisible at rest and shows itself on hover', async () => {
    const page = await grid();
    try {
      const opacity = () => page.evaluate(() =>
        getComputedStyle(document.querySelector('.wv-grid tbody .sel-box')).opacity);
      assert.equal(await opacity(), '0', 'nothing is drawn until you aim at it');
      await page.locator('.wv-grid tbody tr.entity-row').first().hover();
      await page.waitForFunction(() =>
        getComputedStyle(document.querySelector('.wv-grid tbody .sel-box')).opacity === '1',
        null, { timeout: 2000 });
      assert.equal(await opacity(), '1', 'hovering the row reveals its box');
    } finally { await page.close(); }
  });

  test('once a row is chosen every box is visible, so the column can be worked', async () => {
    const page = await grid();
    try {
      await boxes(page).nth(2).check();
      await page.mouse.move(5, 5);
      await page.waitForFunction(() =>
        [...document.querySelectorAll('.wv-grid tbody .sel-box')]
          .every((b) => getComputedStyle(b).opacity === '1'),
        null, { timeout: 2000 }).catch(() => {});
      const all = await page.evaluate(() =>
        [...document.querySelectorAll('.wv-grid tbody .sel-box')]
          .every((b) => getComputedStyle(b).opacity === '1'));
      assert.ok(all, 'a live selection lights the whole column');
    } finally { await page.close(); }
  });

  test('checking a row opens no editor, and clicking a cell changes no selection', async () => {
    const page = await grid();
    try {
      await boxes(page).first().check();
      assert.equal(await page.locator('.wv-grid tbody td .cell-editing, .wv-grid input:focus:not(.sel-box)').count(), 0,
        'the checkbox is not a cell click');
      await page.locator('.wv-grid tbody tr.entity-row').nth(3).locator('td.name-cell').click();
      assert.equal(await page.locator('.wv-grid tbody .sel-box:checked').count(), 1,
        'editing a different row did not select it');
    } finally { await page.close(); }
  });

  test('the header box goes indeterminate on a partial selection and clears everything on a second click', async () => {
    const page = await grid();
    try {
      const head = page.locator('.wv-grid thead .sel-box');
      await boxes(page).nth(1).check();
      assert.ok(await head.evaluate((b) => b.indeterminate), 'some rows chosen reads as a dash');
      await head.click();
      assert.equal(await page.locator('.wv-grid tbody .sel-box:checked').count(), 5);
      assert.ok(await head.evaluate((b) => b.checked && !b.indeterminate));
      await head.click();
      assert.equal(await page.locator('.wv-grid tbody .sel-box:checked').count(), 0);
    } finally { await page.close(); }
  });

  test('shift-clicking a box takes the whole span between it and the last one', async () => {
    const page = await grid();
    try {
      await boxes(page).nth(1).check();
      await boxes(page).nth(3).click({ modifiers: ['Shift'] });
      await page.waitForFunction(() =>
        document.querySelectorAll('.wv-grid tbody .sel-box:checked').length === 3, null, { timeout: 4000 }).catch(() => {});
      assert.equal(await page.locator('.wv-grid tbody .sel-box:checked').count(), 3,
        'rows 2 through 4 inclusive');
    } finally { await page.close(); }
  });

  test('a sort re-orders the grid and the same rows stay chosen', async () => {
    const page = await grid();
    try {
      const chosen = () => page.evaluate(() =>
        [...document.querySelectorAll('.wv-grid tbody .sel-box:checked')]
          .map((b) => b.closest('tr').dataset.eid).sort());
      await boxes(page).nth(0).check();
      await boxes(page).nth(1).check();
      const before = await chosen();
      await page.locator('.wv-grid thead .col-head').first().locator('.field-menu').click();
      await page.locator('.chip-pop .chip-pop-row', { hasText: 'Z to A' }).click();
      await page.waitForTimeout(120);
      assert.deepEqual(await chosen(), before, 'the same entity ids survive the sort');
    } finally { await page.close(); }
  });

  test('Escape clears the selection', async () => {
    const page = await grid();
    try {
      await boxes(page).nth(0).check();
      await boxes(page).nth(2).check();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.wv-grid tbody .sel-box:checked').count(), 0);
    } finally { await page.close(); }
  });

  test('Escape aimed at a dialog closes the dialog and leaves the selection alone', async () => {
    const page = await grid();
    try {
      await boxes(page).nth(1).check();
      await page.click('.add-field-btn');
      await page.waitForSelector('#tray-back');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('#tray-back'), null, { timeout: 2000 });
      assert.equal(await page.locator('.wv-grid tbody .sel-box:checked').count(), 1,
        'the tray took the Escape; the row stays chosen');
    } finally { await page.close(); }
  });

  test('there is no bar until a row is chosen, and none left once it is cleared', async () => {
    const page = await grid();
    try {
      assert.equal(await page.locator('.sel-puck').count(), 0, 'an idle grid carries no bar');
      await boxes(page).nth(0).check();
      await page.waitForSelector('.sel-puck');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.sel-puck'), null, { timeout: 2000 });
      assert.equal(await page.locator('.sel-puck').count(), 0);
    } finally { await page.close(); }
  });

  test('the count says what the bar holds, and follows the selection', async () => {
    const page = await grid();
    try {
      const says = (text) => page.waitForFunction((t) =>
        document.querySelector('.sel-count')?.textContent.trim() === t, text, { timeout: 4000 });
      await boxes(page).nth(0).check();
      await says('1 row');
      await boxes(page).nth(2).click({ modifiers: ['Shift'] });
      await says('3 rows');
    } finally { await page.close(); }
  });

  test('the bar carries only built commands — no dead icons', async () => {
    const page = await grid();
    try {
      await boxes(page).nth(0).check();
      const labels = await page.locator('.sel-puck .sel-act').evaluateAll(
        (bs) => bs.map((b) => b.getAttribute('aria-label')));
      assert.deepEqual(labels, ['Set a field…', 'Link to…', 'Duplicate', 'More', 'Move to trash'],
        'slice 3: the full designed set is built');
      assert.equal(await page.locator('.sel-puck .sel-sep').count(), 1);
      assert.equal(await page.locator('.sel-puck .sel-act.danger').count(), 1);
    } finally { await page.close(); }
  });

  test('the grid grows a floor while the bar is up, so it never covers the last row', async () => {
    const page = await grid();
    try {
      const lastRowBottom = () => page.evaluate(() => {
        const rows = [...document.querySelectorAll('.wv-grid tbody tr.entity-row')];
        return rows.at(-1).getBoundingClientRect().bottom;
      });
      await boxes(page).nth(0).check();
      await page.waitForSelector('.sel-puck');
      const gap = await page.evaluate((bottom) => {
        const puck = document.querySelector('.sel-puck').getBoundingClientRect();
        return puck.top - bottom;
      }, await lastRowBottom());
      assert.ok(gap > 0, `the bar clears the last row (overlap of ${-gap}px)`);
    } finally { await page.close(); }
  });

  test('Duplicate copies the chosen rows and leaves the selection empty', async () => {
    const page = await grid();
    try {
      const count = () => page.locator('.wv-grid tbody tr.entity-row').count();
      const before = await count();
      await boxes(page).nth(0).check();
      await page.locator('.sel-puck .sel-act[aria-label="Duplicate"]').click();
      await page.waitForFunction((n) =>
        document.querySelectorAll('.wv-grid tbody tr.entity-row').length === n + 1,
        before, { timeout: 4000 });
      assert.equal(await count(), before + 1);
      assert.equal(await page.locator('.sel-puck').count(), 0, 'the bar goes with the selection');
    } finally { await page.close(); }
  });

  const act = (page, label) => page.locator(`.sel-puck .sel-act[aria-label="${label}"]`);
  const holdRepaint = (page, ms = 600) => page.route('**/tables/*/query', async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
  const pickRow = (page, text) => page.locator('.picker-pop .picker-row', { hasText: text }).first().click();

  test('Set a field… walks field → value and writes one state across the selection', async () => {
    const page = await grid();
    try {
      await boxes(page).nth(0).check();
      await boxes(page).nth(1).check();
      await act(page, 'Set a field…').click();
      await page.waitForSelector('.picker-pop .picker-search:focus');
      const fields = await page.locator('.picker-pop .picker-row .picker-label').allTextContents();
      assert.deepEqual(fields, ['Name', 'Estimate', 'Status'], 'Owner is a relation: Link to…\'s, not here');
      await pickRow(page, 'Status');
      await page.waitForSelector('.picker-pop .picker-search:focus');
      await holdRepaint(page);
      await pickRow(page, 'Done');
      await page.waitForFunction(() => !document.querySelector('.sel-puck')
        && [...document.querySelectorAll('.wv-grid tbody tr.entity-row td[data-field="Status"] button')]
          .filter((b) => /Done/.test(b.textContent)).length === 2, null, { timeout: 8000 }).catch(() => {});
      const states = await page.locator('.wv-grid tbody tr.entity-row td[data-field="Status"] button').allTextContents();
      assert.equal(states.filter((t) => /Done/.test(t)).length, 2, 'both chosen rows are Done, the rest untouched');
      assert.equal(await page.locator('.sel-puck').count(), 0, 'the bar goes with the selection');
    } finally { await page.close(); }
  });

  test('Set a field… on a number takes a typed value and applies it on Return', async () => {
    const page = await grid();
    try {
      await boxes(page).nth(2).check();
      await act(page, 'Set a field…').click();
      await pickRow(page, 'Estimate');
      const input = page.locator('.value-pop input');
      await input.waitFor();
      assert.ok(await input.evaluate((n) => n === document.activeElement), 'the cursor is already in the box');
      await input.fill('42');
      await holdRepaint(page);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.querySelector('.sel-puck'), null, { timeout: 4000 });
      await page.waitForFunction(() => [...document.querySelectorAll(
        '.wv-grid tbody tr.entity-row td[data-field="Estimate"] input')]
        .filter((n) => n.value === '42').length === 1, null, { timeout: 8000 }).catch(() => {});
      const cells = await page.locator('.wv-grid tbody tr.entity-row td[data-field="Estimate"] input').evaluateAll((ns) => ns.map((n) => n.value));
      assert.equal(cells.filter((t) => t === '42').length, 1, `the one chosen row reads 42: ${cells}`);
    } finally { await page.close(); }
  });

  test('Link to… walks relation → target and connects every chosen row', async () => {
    const page = await grid();
    try {
      await boxes(page).nth(3).check();
      await boxes(page).nth(4).check();
      await act(page, 'Link to…').click();
      await page.waitForSelector('.picker-pop .picker-search:focus');
      await pickRow(page, 'Owner');
      await page.waitForSelector('.picker-pop .picker-search:focus');
      await page.keyboard.type('an');
      await holdRepaint(page);
      await pickRow(page, 'Ann');
      await page.waitForFunction(() => !document.querySelector('.sel-puck')
        && [...document.querySelectorAll('.wv-grid tbody tr.entity-row td[data-field="Owner"]')]
          .filter((td) => /Ann/.test(td.textContent)).length === 2, null, { timeout: 8000 }).catch(() => {});
      const owners = await page.locator('.wv-grid tbody tr.entity-row td[data-field="Owner"]').allTextContents();
      assert.equal(owners.filter((t) => /Ann/.test(t)).length, 2, `both chosen rows own Ann: ${owners}`);
    } finally { await page.close(); }
  });

  test('Escape closes a puck picker and leaves the selection alone', async () => {
    const page = await grid();
    try {
      await boxes(page).nth(0).check();
      await act(page, 'Set a field…').click();
      await page.waitForSelector('.picker-pop .picker-search:focus');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.picker-pop'), null, { timeout: 2000 });
      assert.equal(await page.locator('.wv-grid tbody .sel-box:checked').count(), 1, 'the picker took the Escape');
      await act(page, 'Set a field…').click();
      await pickRow(page, 'Estimate');
      await page.locator('.value-pop input').waitFor();
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.value-pop'), null, { timeout: 2000 });
      assert.equal(await page.locator('.wv-grid tbody .sel-box:checked').count(), 1, 'so did the value box');
    } finally { await page.close(); }
  });

  test('⋯ opens the overflow: Move to table…, Roll up…, Copy links', async () => {
    const page = await grid();
    try {
      await boxes(page).nth(0).check();
      await act(page, 'More').click();
      await page.waitForSelector('.picker-pop .picker-search:focus');
      const rows = (await page.locator('.picker-pop .picker-row .picker-label').allTextContents()).map((t) => t.trim());
      assert.deepEqual(rows, ['Move to table…', 'Roll up into a new row…', 'Copy links']);
    } finally { await page.close(); }
  });

  test('Copy links puts one permalink per chosen row on the clipboard', async () => {
    const page = await grid();
    try {
      await page.evaluate(() => {
        window.__copied = null;
        navigator.clipboard.writeText = async (t) => { window.__copied = t; };
      });
      await boxes(page).nth(0).check();
      await boxes(page).nth(1).check();
      await act(page, 'More').click();
      await pickRow(page, 'Copy links');
      await page.waitForFunction(() => window.__copied != null, null, { timeout: 4000 });
      const lines = (await page.evaluate(() => window.__copied)).split('\n');
      assert.equal(lines.length, 2);
      assert.ok(lines.every((l) => /^http:\/\/127\.0\.0\.1:\d+\/e\/[0-9a-f-]{36}$/.test(l)), `permalinks: ${lines.join(' ')}`);
      assert.equal(await page.locator('.sel-puck').count(), 1, 'copying does not spend the selection');
    } finally { await page.close(); }
  });

  test('Roll up… creates one parent in the relation\'s table and links the selection to it', async () => {
    const page = await grid();
    try {
      await boxes(page).nth(0).check();
      await boxes(page).nth(1).check();
      await act(page, 'More').click();
      await pickRow(page, 'Roll up');
      await page.waitForSelector('.picker-pop .picker-search:focus');
      await pickRow(page, 'Owner');
      const input = page.locator('.value-pop input');
      await input.waitFor();
      await input.fill('Carol');
      await holdRepaint(page);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.querySelector('.sel-puck')
        && [...document.querySelectorAll('.wv-grid tbody tr.entity-row td[data-field="Owner"]')]
          .filter((td) => /Carol/.test(td.textContent)).length === 2, null, { timeout: 8000 }).catch(() => {});
      const owners = await page.locator('.wv-grid tbody tr.entity-row td[data-field="Owner"]').allTextContents();
      assert.equal(owners.filter((t) => /Carol/.test(t)).length, 2, `both chosen rows own Carol: ${owners}`);
    } finally { await page.close(); }
  });

  test('Move to table… re-homes the rows and they leave this grid', async () => {
    const page = await grid();
    try {
      const count = () => page.locator('.wv-grid tbody tr.entity-row').count();
      const before = await count();
      await boxes(page).nth(0).check();
      await act(page, 'More').click();
      await pickRow(page, 'Move to table');
      await page.waitForSelector('.picker-pop .picker-search:focus');
      const tables = await page.locator('.picker-pop .picker-row .picker-label').allTextContents();
      assert.ok(tables.includes('Person') && !tables.includes('Task'), `other tables only: ${tables}`);
      await pickRow(page, 'Person');
      await page.waitForFunction((n) =>
        document.querySelectorAll('.wv-grid tbody tr.entity-row').length === n - 1, before, { timeout: 4000 });
      assert.equal(await count(), before - 1);
    } finally { await page.close(); }
  });

  test('the bar sits at the bottom centre of the viewport even when the table runs off it', async () => {
    const page = await browser.newPage({ viewport: { width: 1100, height: 200 } });
    try {
      await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody tr.entity-row').length === 5);
      await boxes(page).nth(0).check();
      await page.waitForSelector('.sel-puck');
      await page.locator('.sel-puck').evaluate((n) => Promise.all(n.getAnimations().map((a) => a.finished)));
      const geo = await page.evaluate(() => {
        const p = document.querySelector('.sel-puck').getBoundingClientRect();
        const last = [...document.querySelectorAll('.wv-grid tbody tr.entity-row')].at(-1).getBoundingClientRect();
        return { bottom: p.bottom, cx: (p.left + p.right) / 2, w: innerWidth, h: innerHeight, lastBottom: last.bottom };
      });
      assert.ok(geo.lastBottom > geo.h, 'the table runs past the viewport');
      assert.ok(geo.h - geo.bottom >= 8 && geo.h - geo.bottom <= 24, `the bar hugs the viewport bottom (${geo.h - geo.bottom}px)`);
      assert.ok(Math.abs(geo.cx - geo.w / 2) < 2, `the bar is centred on the viewport (${geo.cx} vs ${geo.w / 2})`);
    } finally { await page.close(); }
  });

  test('the "+ New" line carries no checkbox', async () => {
    const page = await grid();
    try {
      assert.equal(await page.locator('.wv-grid tbody tr.add-entity-row .sel-box').count(), 0);
      const spans = await page.evaluate(() => {
        const add = document.querySelector('.wv-grid tbody tr.add-entity-row td');
        return { colspan: Number(add.getAttribute('colspan')),
                 heads: document.querySelectorAll('.wv-grid thead th').length };
      });
      assert.equal(spans.colspan, spans.heads, 'the add row spans every column');
    } finally { await page.close(); }
  });
}
