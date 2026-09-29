/* Feature #237: the approved toolbar keeps its controls on the eyebrow. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';
let table;
const s = await launch('table toolbar', weave => {
  weave.createSpace({ name: 'Ops' });
  table = weave.createTable({ space: 'Ops', name: 'Job' });
  weave.addField(table, { name: 'Owner', type: 'text' });
  weave.createEntity(table, { name: 'Alpha' });
});
if (s) {
  test('search, view, density, fields and filter precede the unchanged rightmost table menu', async () => {
    const page = await s.browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${s.base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
      assert.equal(await page.locator('.table-search-input').isVisible(), true);
      const controls = ['.table-search-input', '.table-view-btn', '.table-density-btn', '.eye-btn', '.table-filter-btn', '[title="Table actions"]'];
      const boxes = [];
      for (const selector of controls) {
        assert.equal(await page.locator(selector).isVisible(), true, selector);
        assert.doesNotMatch(await page.locator(selector).textContent(), /undefined/, 'every control has a supported icon');
        boxes.push(await page.locator(selector).boundingBox());
      }
      for (let i = 1; i < boxes.length; i++) {
        assert.ok(boxes[i].x > boxes[i - 1].x, `${controls[i]} follows ${controls[i - 1]}`);
        assert.ok(Math.abs(boxes[i].y - boxes[0].y) < 12, 'all controls share the eyebrow');
      }
      assert.equal(await page.locator('.table-view-popover').count(), 0);
      await page.click('.table-view-btn');
      assert.equal(await page.locator('.table-view-popover .view-add').isVisible(), true);
      assert.equal(await page.locator('.table-view-popover .view-reset').isVisible(), true);
      assert.equal(await page.locator('.table-view-popover .view-clear').isVisible(), true);
    } finally { await page.close(); }
  });
  test('Fields reorders with keyboard, hides independently, and both Add field controls open the field tray', async () => {
    const page = await s.browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${s.base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
      await page.click('.eye-btn');
      const owner = page.locator('.table-field-row[data-field="Owner"]');
      await owner.locator('.field-reorder-handle').focus();
      await page.keyboard.press('ArrowUp');
      await page.waitForFunction(() => [...document.querySelectorAll('.wv-grid .col-label')].map(h => h.textContent.trim()).slice(0, 3).join(',') === 'Name,Owner,Description');
      assert.deepEqual(s.weave.tableView(table).views[0].fields, ['Name', 'Owner', 'Description']);
      // A press that moves lifts the row; one square-ended line marks the gap (Issue #445).
      const grip = await owner.locator('.field-reorder-handle').boundingBox();
      const target = await page.locator('.table-field-row[data-field="Name"]').boundingBox();
      await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
      await page.mouse.down();
      await page.mouse.move(grip.x + grip.width / 2, target.y + 2, { steps: 4 });
      assert.equal(await page.locator('.table-fields-popover .drop-line').count(), 1, 'one reorder target');
      const radius = await page.$eval('.table-fields-popover .drop-line', (l) => getComputedStyle(l).borderTopLeftRadius);
      assert.equal(radius, '0px', 'the insertion marker is straight');
      await page.keyboard.press('Escape');
      await page.mouse.up();
      assert.equal(await page.locator('.table-fields-popover .drop-line').count(), 0, 'Escape drops the drag');
      await owner.locator('.eye-row').click();
      await page.waitForFunction(() => ![...document.querySelectorAll('.wv-grid .col-label')].some(h => h.textContent.trim() === 'Owner'));
      await page.locator('.table-fields-popover').getByRole('button', { name: 'Add field', exact: true }).click();
      await page.waitForSelector('#tray .tray-form');
      assert.match(await page.textContent('#tray'), /field/i);
      await page.keyboard.press('Escape');
      await page.waitForSelector('#tray', { state: 'hidden' });
      await page.click('.add-field-btn');
      await page.waitForSelector('#tray .tray-form');
      assert.match(await page.textContent('#tray'), /field/i);
    } finally { await page.close(); }
  });
  test('Reset view restores raw fields and clears the saved filter, sort, widths and frozen columns', async () => {
    s.weave.tableView(`${table.id}/Standard`, { fields: ['Name'], sort: [{ field: 'Name', dir: 'desc' }], widths: { Name: 300 }, frozen: 1 });
    const page = await s.browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${s.base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
      await page.click('.table-view-btn');
      await page.click('.view-reset');
      await page.waitForFunction(() => [...document.querySelectorAll('.wv-grid .col-label')].some(h => h.textContent.trim() === 'Owner'));
      await page.waitForLoadState('networkidle');
      const view = s.weave.tableView(table).views[0];
      assert.deepEqual(view.fields, ['Name', 'Description', 'Owner']);
      assert.deepEqual(view.filters ?? {}, {});
      assert.deepEqual(view.sort ?? [], []);
      assert.equal(view.frozen ?? 0, 0);
      assert.ok(!Object.values(view.widths ?? {}).some(Boolean));
    } finally { await page.close(); }
  });

  test('Clear filters, search, and sorting keeps the saved column layout', async () => {
    s.weave.tableView(`${table.id}/Standard`, { fields: ['Name'], sort: [{ field: 'Name', dir: 'desc' }], widths: { Name: 300 }, frozen: 1 });
    const page = await s.browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${s.base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
      await page.fill('.table-search-input', 'no matching record');
      await page.waitForSelector('.table-search-empty');
      await page.click('.table-view-btn');
      await page.click('.view-clear');
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      await page.waitForLoadState('networkidle');
      assert.equal(await page.inputValue('.table-search-input'), '');
      const view = s.weave.tableView(table).views[0];
      assert.deepEqual(view.sort ?? [], []);
      assert.deepEqual(view.fields, ['Name']);
      assert.deepEqual(view.widths, { Name: 300 });
      assert.equal(view.frozen, 1);
    } finally { await page.close(); }
  });

  test('Fields shows all, hides all, and restores one field while Add field stays visible', async () => {
    const page = await s.browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${s.base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
      await page.click('.eye-btn');
      const pop = page.locator('.table-fields-popover');
      await pop.getByRole('button', { name: 'Show all', exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('.table-field-row .eye-row')].every(row => row.matches(':has(input:checked), [aria-checked="true"]')));
      const fields = await pop.locator('.table-field-row').evaluateAll(rows => rows.map(row => row.dataset.field));
      assert.deepEqual(s.weave.tableView(table).views[0].fields, fields, 'every picker field is accepted and saved');
      assert.equal(fields.includes('Activity'), false, 'Activity is not a view system column');
      const add = pop.getByRole('button', { name: 'Add field', exact: true });
      assert.equal(await add.isVisible(), true);
      await pop.getByRole('button', { name: 'Hide all', exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('.table-field-row .eye-row')].every(row => row.matches(':has(input:checked), [aria-checked="true"]') === false));
      assert.deepEqual(s.weave.tableView(table).views[0].fields, []);
      await pop.locator('.table-field-row[data-field="Owner"] .eye-row').click();
      await page.waitForFunction(() => document.querySelector('.table-field-row[data-field="Owner"] .eye-row')?.matches(':has(input:checked), [aria-checked="true"]'));
      assert.deepEqual(s.weave.tableView(table).views[0].fields, ['Owner']);
      assert.equal(await add.isVisible(), true);
      await add.click();
      await page.waitForSelector('#tray .tray-form');
    } finally { await page.close(); }
  });

  test('showing a hidden field restores its saved position unless its hidden grip was moved', async () => {
    s.weave.tableView(`${table.id}/Standard`, { fields: ['Name', 'Owner', 'Description'], frozen: 0 });
    const page = await s.browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${s.base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
      await page.click('.eye-btn');
      const owner = page.locator('.table-field-row[data-field="Owner"]');
      const waitOwner = checked => page.waitForFunction(value => document.querySelector('.table-field-row[data-field="Owner"] .eye-row')?.matches(':has(input:checked), [aria-checked="true"]') === (value === 'true'), String(checked));
      await owner.locator('.eye-row').click();
      await waitOwner(false);
      await page.keyboard.press('Escape');
      await page.click('.eye-btn');
      await owner.locator('.eye-row').click();
      await waitOwner(true);
      // The switch flips before its write lands; read the view once it has (Issue #454).
      const fields = () => s.weave.tableView(table).views[0].fields;
      assert.deepEqual(await eventually(fields, ['Name', 'Owner', 'Description']), ['Name', 'Owner', 'Description'], 'reopening the picker keeps the parked position');
      await owner.locator('.eye-row').click();
      await waitOwner(false);
      await owner.locator('.field-reorder-handle').focus();
      // The reopened picker placed hidden Owner last; move it ahead of both visible fields.
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');
      await page.waitForLoadState('networkidle');
      await owner.locator('.eye-row').click();
      await waitOwner(true);
      assert.deepEqual(await eventually(fields, ['Owner', 'Name', 'Description']), ['Owner', 'Name', 'Description'], 'an explicit hidden-field move overrides its parked position');
    } finally { await page.close(); }
  });

  test('dragging a field grip persists its column order after reload', async () => {
    s.weave.tableView(`${table.id}/Standard`, { fields: ['Name', 'Description', 'Owner'], frozen: 0 });
    const page = await s.browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.goto(`${s.base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
      await page.click('.eye-btn');
      await page.locator('.table-fields-popover').evaluate(pop => Promise.all(pop.getAnimations().map(a => a.finished)));
      await page.locator('.table-field-row[data-field="Owner"] .field-reorder-handle').dragTo(
        page.locator('.table-field-row[data-field="Name"]'), { targetPosition: { x: 10, y: 2 } });
      await page.waitForFunction(() => [...document.querySelectorAll('.wv-grid .col-label')].map(h => h.textContent.trim()).slice(0, 3).join(',') === 'Owner,Name,Description');
      const want = ['Owner', 'Name', 'Description'];
      assert.deepEqual(await eventually(() => s.weave.tableView(table).views[0].fields, want), want, 'the grip drag is saved into the view');
      await page.reload({ waitUntil: 'networkidle' });
      assert.deepEqual(await page.locator('.wv-grid .col-label').allTextContents(), ['Owner', 'Name', 'Description']);
    } finally { await page.close(); }
  });

}
