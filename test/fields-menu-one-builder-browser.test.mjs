import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, settled } from './lib/browser.mjs';

let long, short, row, few;
const s = await launch('one Fields menu for the table and the record', (weave) => {
  weave.createSpace({ name: 'Ops' });
  long = weave.createTable({ space: 'Ops', name: 'Long' });
  for (let i = 1; i <= 30; i++) weave.addField(long, { name: `Field ${String(i).padStart(2, '0')}`, type: 'text' });
  row = weave.createEntity(long, { name: 'Row' });
  short = weave.createTable({ space: 'Ops', name: 'Short' });
  weave.addField(short, { name: 'Owner', type: 'text' });
  few = weave.createEntity(short, { name: 'Few' });
});

if (s) {
  const { base, browser, weave } = s;
  const surfaces = {
    table: (t) => `${base}/#/table/${t.id}`,
    record: (t) => `${base}/#/entity/${t === long ? row.id : few.id}`,
  };
  const openMenu = async (page, url) => {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.click('#main .eye-btn');
    const pop = page.locator('.table-fields-popover');
    await pop.waitFor();
    await settled(pop);
    return pop;
  };
  const shape = (page) => page.evaluate(() => {
    const pop = document.querySelector('.chip-pop');
    const rows = [...pop.querySelectorAll('.table-field-list .table-field-row')];
    return {
      fieldsMenu: pop.classList.contains('table-fields-popover'),
      title: pop.querySelector('.table-control-head strong')?.textContent,
      rows: rows.length,
      checkboxes: rows.filter((r) => r.querySelector('label.eye-row > input.form-check-input[type="checkbox"]')).length,
      switches: pop.querySelectorAll('[role="switch"], .switch').length,
      grips: rows.filter((r) => r.querySelector('button.field-reorder-handle')).length,
      legend: !!pop.querySelector('.table-field-legend'),
      actions: [...pop.querySelectorAll('.field-visibility-actions button')].map((b) => b.textContent),
    };
  });

  test('the table and the record open the one Fields menu, built of checkbox rows that drag (Issues #910, #915)', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await openMenu(page, surfaces.table(long));
      const table = await shape(page);
      await page.keyboard.press('Escape');
      await openMenu(page, surfaces.record(long));
      const record = await shape(page);
      for (const [name, got] of Object.entries({ table, record })) {
        assert.equal(got.fieldsMenu, true, `${name}: the Fields menu`);
        assert.equal(got.title, 'Fields', `${name}: titled Fields`);
        assert.ok(got.rows >= 31, `${name}: one row per field (${got.rows})`);
        assert.equal(got.checkboxes, got.rows, `${name}: every row is the shared checkbox`);
        assert.equal(got.switches, 0, `${name}: no switch anywhere in the menu`);
        assert.equal(got.legend, true, `${name}: the reorder legend`);
        assert.deepEqual(got.actions, ['Show all', 'Hide all'], `${name}: Show all and Hide all`);
      }
      const fields = weave.describeSchema().flatMap((sp) => sp.tables).find((t) => t.id === long.id).fields.length;
      assert.equal(record.rows, table.rows, 'the same rows on both surfaces');
      assert.equal(table.grips, table.rows, 'every table row drags');
      assert.equal(record.grips, fields, 'every field row of the record drags; the system rows stay put');
    } finally { await page.close(); }
  });

  test('the record menu reorders the table fields from the keyboard and hides with its checkbox (Issues #910, #915)', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      const pop = await openMenu(page, surfaces.record(short));
      const described = () => weave.describeSchema().flatMap((sp) => sp.tables).find((t) => t.id === short.id);
      const order = () => described().fields.map((f) => f.name);
      const before = order();
      const at = before.indexOf('Owner');
      await pop.locator('.table-field-row[data-field="Owner"] .field-reorder-handle').focus();
      await page.keyboard.press('ArrowUp');
      await page.waitForFunction(() => document.activeElement?.closest('.table-field-row')?.dataset.field === 'Owner');
      for (let t0 = Date.now(); order().indexOf('Owner') !== at - 1;) {
        if (Date.now() - t0 > 5000) throw new Error(`Owner never moved up: ${order()}`);
        await new Promise((r) => setTimeout(r, 25));
      }
      const owner = pop.locator('.table-field-row[data-field="Owner"]').getByRole('checkbox', { name: 'Owner', exact: true });
      assert.equal(await owner.isChecked(), true);
      await owner.click();
      await page.waitForFunction(() => document.querySelector('.table-field-row[data-field="Owner"] input[type="checkbox"]').checked === false);
      for (let t0 = Date.now(); !(described().hiddenFields ?? []).includes('Owner');) {
        if (Date.now() - t0 > 5000) throw new Error('Owner never reached the hidden set');
        await new Promise((r) => setTimeout(r, 25));
      }
      await page.waitForFunction(() => !document.querySelector('.entity-values .fieldrow[data-field="Owner"]'));
    } finally {
      weave.updateTable(short, { hiddenFields: [] });
      await page.close();
    }
  });

  for (const [label, viewport, names] of [['desktop', { width: 1440, height: 700 }, ['table', 'record']], ['phone', { width: 390, height: 700 }, ['record']]]) {
    for (const theme of ['light', 'dark']) {
      test(`the Fields list keeps a stable scrollbar gutter and its rows clear of it (Issues #909, #915, ${label}, ${theme})`, async () => {
        const page = await browser.newPage({ viewport, colorScheme: theme });
        try {
          const widths = {};
          for (const name of names) {
            const url = surfaces[name];
            for (const t of [long, short]) {
              await openMenu(page, url(t));
              const m = await page.evaluate(() => {
                const list = document.querySelector('.table-fields-popover .table-field-list');
                const box = list.getBoundingClientRect();
                const cs = getComputedStyle(list);
                const contentRight = box.left + list.clientLeft + list.clientWidth;
                const grip = list.querySelector('.field-reorder-handle svg').getBoundingClientRect();
                const gaps = [...list.querySelectorAll('.eye-row')].map((row) => contentRight - row.getBoundingClientRect().right + parseFloat(getComputedStyle(row).paddingRight));
                const boxes = [...list.querySelectorAll('.eye-row > input.form-check-input')].map((b) => b.getBoundingClientRect().left - grip.right);
                return {
                  gutter: cs.scrollbarGutter,
                  scrolls: list.scrollHeight > list.clientHeight + 1,
                  clientWidth: list.clientWidth,
                  leftInset: grip.left - box.left,
                  minGap: Math.min(...gaps),
                  boxGap: [Math.min(...boxes), Math.max(...boxes)],
                  boxes: boxes.length,
                  rows: gaps.length,
                };
              });
              assert.equal(m.gutter, 'stable', `${name}: the gutter is reserved whether or not the list scrolls`);
              if (t === long) assert.equal(m.scrolls, true, `${name}: the long table scrolls its list`);
              assert.ok(m.minGap >= 8 && m.minGap <= 12, `${name}: every row's content ends 8 to 12px clear of the scrollbar (${m.minGap}px)`);
              assert.equal(m.boxes, m.rows, `${name}: every row holds the shared checkbox`);
              assert.ok(m.boxGap[1] - m.boxGap[0] <= 1 && m.boxGap[0] >= 0, `${name}: every checkbox lines up just right of the grip column (${m.boxGap})`);
              assert.ok(Math.abs(m.minGap - m.leftInset) <= 4, `${name}: the right inset matches the left (${m.minGap}px against ${m.leftInset}px)`);
              (widths[name] ??= []).push(m.clientWidth);
              await page.keyboard.press('Escape');
            }
          }
          for (const [name, [scrolling, still]] of Object.entries(widths)) assert.equal(scrolling, still, `${name}: rows keep their width when the list starts scrolling`);
        } finally { await page.close(); }
      });
    }
  }
}
