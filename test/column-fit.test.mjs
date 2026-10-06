import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let db, wide;
const LONG = 'Design the onboarding wizard end to end';

const s = await launch('column fit', (weave) => {
  weave.createSpace({ name: 'Scratch' });
  db = weave.createTable({ space: 'Scratch', name: 'Task' });
  weave.addField(db.id, { name: 'Owner', type: 'text' });
  weave.createEntity(db.id, { name: LONG, values: { Owner: 'Kyle' } });
  weave.createEntity(db.id, { name: 'Short', values: { Owner: 'Sam' } });
  wide = weave.createTable({ space: 'Scratch', name: 'Wide' });
  for (const n of ['B', 'C', 'D', 'E', 'F', 'G', 'H']) weave.addField(wide.id, { name: n, type: 'text' });
  const values = Object.fromEntries(['B', 'C', 'D', 'E', 'F', 'G', 'H']
    .map((n) => [n, `${n} — a value long enough to want its own column width`]));
  weave.createEntity(wide.id, { name: LONG, values });
});
if (s) {
  const { base, browser, weave } = s;
  const viewWidths = (table) => weave.tableView(table.id).views[0].widths ?? {};
  function clearViewWidths(table) {
    const v = weave.tableView(table.id).views[0];
    if (v.widths) weave.tableView(`${table.id}/${v.id}`, { widths: Object.fromEntries(Object.keys(v.widths).map((n) => [n, null])) });
  }
  function resetWidths() {
    const t = weave.getTable(db.id);
    for (const f of Object.values(t.fields)) weave.updateField(db.id, f.id, { config: { width: null } });
    clearViewWidths(db);
  }

  async function openGrid() {
    resetWidths();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${base}/#/table/${db.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('table.wv-grid th.col-head');
    return page;
  }

  const gripFor = (label) => `table.wv-grid th.col-head:has(.col-label:text-is("${label}")) .col-resize`;
  const headFor = (label) => `table.wv-grid th.col-head:has(.col-label:text-is("${label}"))`;

  test('double-click fits the column to the longest value, not to its own width', async () => {
    const t = weave.getTable(db.id);
    const nameField = Object.values(t.fields).find((f) => f.name === 'Name');
    weave.updateField(db.id, nameField.id, { config: { width: 90 } });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${base}/#/table/${t.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('table.wv-grid th.col-head');
    try {
      const before = await page.locator(headFor('Name')).evaluate((th) => th.getBoundingClientRect().width);
      assert.ok(before < 150, `the column starts squeezed, got ${Math.round(before)}px`);
      const needed = await page.locator(headFor('Name')).evaluate((th) => {
        const input = th.closest('table').querySelector('tbody tr td input.inline-edit');
        const cs = getComputedStyle(input);
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        return ctx.measureText(input.value).width;
      });
      await page.dblclick(gripFor('Name'));
      await page.waitForFunction(
        (w) => [...document.querySelectorAll('th.col-head')]
          .some((th) => th.querySelector('.col-label')?.textContent === 'Name'
            && th.getBoundingClientRect().width > w + 5),
        before, { timeout: 4000 });
      const after = await page.locator(headFor('Name')).evaluate((th) => th.getBoundingClientRect().width);
      assert.ok(after >= needed, `fit ${after}px must cover the ${Math.round(needed)}px value`);
      assert.ok(after < needed + 80, `fit ${after}px must not overshoot the ${Math.round(needed)}px value`);
      const clipped = await page.locator(headFor('Name')).evaluate(() => {
        const input = document.querySelector('table.wv-grid tbody tr td input.inline-edit');
        return input.scrollWidth > input.clientWidth + 1;
      });
      assert.equal(clipped, false, 'the longest value must render unclipped after a fit');
    } finally { await page.close(); }
  });

  test('fitting twice lands on the same width — no per-click creep', async () => {
    const page = await openGrid();
    try {
      await page.dblclick(gripFor('Owner'));
      await page.waitForTimeout(250);
      const first = await page.locator(headFor('Owner')).evaluate((th) => Math.round(th.getBoundingClientRect().width));
      await page.dblclick(gripFor('Owner'));
      await page.waitForTimeout(250);
      const second = await page.locator(headFor('Owner')).evaluate((th) => Math.round(th.getBoundingClientRect().width));
      assert.ok(Math.abs(second - first) <= 2, `fit is idempotent, got ${first} then ${second}`);
    } finally { await page.close(); }
  });

  test('a fit holds in a grid wider than its card', async () => {
    const t = weave.getTable(wide.id);
    for (const f of Object.values(t.fields)) weave.updateField(wide.id, f.id, { config: { width: null } });
    clearViewWidths(wide);
    const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${wide.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('table.wv-grid th.col-head');
      const overflows = await page.evaluate(() => {
        const table = document.querySelector('table.wv-grid');
        return table.getBoundingClientRect().width > table.closest('.table-wrap').clientWidth;
      });
      assert.equal(overflows, true, 'the fixture must actually overflow, or it guards nothing');
      await page.dblclick(gripFor('C'));
      await page.waitForTimeout(400);
      const got = {
        rendered: await page.locator(headFor('C')).evaluate((th) => Math.round(th.getBoundingClientRect().width)),
        asked: viewWidths(wide).C ?? 0,
      };
      assert.ok(got.asked > 0, 'the fit was committed to the header');
      assert.ok(Math.abs(got.rendered - got.asked) <= 2,
        `the column must render the width it was given, asked ${got.asked}px, got ${got.rendered}px`);
    } finally { await page.close(); }
  });

  test('the fit is a view write, so it survives a reload', async () => {
    const page = await openGrid();
    try {
      await page.dblclick(gripFor('Name'));
      await page.waitForTimeout(300);
      const width = viewWidths(db).Name;
      assert.ok(width >= 200, `the measured fit reached the view, got ${width}`);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('table.wv-grid th.col-head');
      const rendered = await page.locator(headFor('Name')).evaluate((th) => Math.round(th.getBoundingClientRect().width));
      assert.ok(Math.abs(rendered - width) <= 1, `the reload paints the stored fit: ${width} vs ${rendered}`);
    } finally { await page.close(); }
  });

  test('a full-width row (the "+ New" cell) never inflates a fit', async () => {
    const page = await openGrid();
    try {
      const span = await page.evaluate(() =>
        document.querySelector('table.wv-grid tr.add-entity-row td').colSpan);
      assert.ok(span > 1, 'the add row is a colspan cell');
      await page.dblclick(gripFor('Owner'));
      await page.waitForTimeout(250);
      const after = await page.locator(headFor('Owner')).evaluate((th) => th.getBoundingClientRect().width);
      assert.ok(after < 300, `a fit reads the column, not the table, got ${Math.round(after)}px`);
    } finally { await page.close(); }
  });

  async function pressAndDrag(page, label, dx) {
    const box = await page.locator(gripFor(label)).boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, y, { steps: 6 });
    return { y };
  }
  const widthOf = (page, label) => page.locator(headFor(label)).evaluate((th) => th.getBoundingClientRect().width);
  const storedWidth = (label) => viewWidths(db)[label];

  test('the column follows the pointer while the button is down, and release stores what was painted (Issue #160)', async () => {
    const page = await openGrid();
    try {
      const owner = Object.values(weave.getTable(db.id).fields).find((f) => f.name === 'Owner');
      weave.updateField(db.id, owner.id, { config: { width: 150 } });
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('table.wv-grid th.col-head');
      const before = await widthOf(page, 'Owner');
      assert.ok(Math.abs(before - 150) <= 2, `the fixture starts at its stored width, got ${Math.round(before)}`);
      await pressAndDrag(page, 'Owner', 80);
      const during = await widthOf(page, 'Owner');
      assert.ok(Math.abs(during - (before + 80)) <= 2,
        `mid-drag the header must sit under the pointer: ${Math.round(before)} + 80 vs ${Math.round(during)}`);
      const cells = await page.locator(headFor('Owner')).evaluate((th) => {
        const idx = [...th.parentElement.children].indexOf(th);
        return [...th.closest('table').querySelectorAll('tbody tr.entity-row')].map((r) => r.children[idx].getBoundingClientRect().width);
      });
      for (const w of cells) assert.ok(Math.abs(w - during) <= 2, `a cell must match its header mid-drag: ${Math.round(w)} vs ${Math.round(during)}`);
      await page.mouse.up();
      for (let i = 0; i < 20 && !storedWidth('Owner'); i++) await page.waitForTimeout(100);
      await page.waitForTimeout(200);
      const after = await widthOf(page, 'Owner');
      assert.ok(Math.abs(after - during) <= 1, `no jump on release: painted ${Math.round(during)}, settled ${Math.round(after)}`);
      assert.equal(storedWidth('Owner'), Math.round(during), 'the stored width is the painted width');
    } finally { await page.close(); }
  });

  test('a drag on the grip never opens the field dialog on release (Issue #98)', async () => {
    const page = await openGrid();
    try {
      await pressAndDrag(page, 'Owner', 6);
      await page.mouse.up();
      await page.locator(headFor('Owner')).evaluate((th) => th.click());
      await page.waitForTimeout(250);
      assert.equal(await page.locator('#tray-back').count(), 0, 'the field dialog stays closed after a resize');
      await page.locator(headFor('Owner')).click({ position: { x: 10, y: 10 } });
      await page.waitForSelector('#tray-back', { timeout: 2000 });
    } finally { await page.close(); }
  });

  test('a column cannot be dragged narrower than its own label (Issue #100)', async () => {
    const page = await openGrid();
    try {
      await pressAndDrag(page, 'Owner', -400);
      await page.mouse.up();
      await page.waitForTimeout(300);
      const got = await page.locator(headFor('Owner')).evaluate((th) => {
        const cs = getComputedStyle(th);
        const label = th.querySelector('.col-label').getBoundingClientRect();
        const box = th.getBoundingClientRect();
        return {
          width: box.width,
          need: label.width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight),
          clipped: label.right > box.right - parseFloat(cs.paddingRight) + 1 || label.left < box.left - 1,
        };
      });
      assert.ok(got.width >= got.need - 1, `the header stops at its label: ${Math.round(got.width)}px vs ${Math.round(got.need)}px needed`);
      assert.equal(got.clipped, false, 'the label sits inside the header after the drag');
      assert.ok(storedWidth('Owner') >= Math.floor(got.need), 'the stored width respects the same floor');
    } finally { await page.close(); }
  });
}
