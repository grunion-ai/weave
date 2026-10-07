import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';

let trip, todo, ids;
const s = await launch('list layout', (weave) => {
  weave.createSpace({ name: 'Plans' });
  trip = weave.createTable({ space: 'Plans', name: 'Trip' });
  todo = weave.createTable({ space: 'Plans', name: 'To-do' });
  weave.updateTable(todo.id, { noun: 'to-do' });
  weave.addField(todo.id, { name: 'Done', type: 'checkbox' });
  weave.addField(todo.id, { name: 'Priority', type: 'select', config: { options: [{ name: 'P1', hue: 'red' }, { name: 'P2', hue: 'amber' }, { name: 'P3', hue: 'slate' }] } });
  weave.addField(todo.id, { name: 'Due', type: 'date' });
  weave.addRelation(todo.id, { name: 'Trip', targetDb: trip.id, cardinality: 'many-to-one', inverseName: 'To-dos' });
  weave.addRelation(todo.id, { name: 'Parent', targetDb: todo.id, cardinality: 'many-to-one', inverseName: 'Sub-tasks' });
  weave.addField(trip.id, { name: '% Done', type: 'rollup', config: { relationField: 'To-dos', targetField: 'Done', aggregate: 'avg', format: 'percent', display: 'bar', scale: 1 } });
  weave.updateField(trip.id, 'Chip', { config: { fields: ['% Done'] } });
  weave.updateField(todo.id, 'Chip', { config: { fields: ['Due'] } });
});

if (s) {
  const { base, browser, weave } = s;
  const seed = () => {
    for (const e of weave.listEntities(todo.id)) weave.deleteEntity(e.id, { hard: true });
    for (const e of weave.listEntities(trip.id)) weave.deleteEntity(e.id, { hard: true });
    const japan = weave.createEntity(trip.id, { name: 'Japan' });
    const peru = weave.createEntity(trip.id, { name: 'Peru' });
    const mk = (name, t, Priority, Due, Done = false, parent = null) => weave.createEntity(todo.id, { name, values: { Trip: t.id, Priority, Due, Done, ...(parent ? { Parent: parent.id } : {}) } }).id;
    ids = { japan: japan.id, peru: peru.id };
    ids.pass = mk('Passport', japan, 'P1', '2026-10-12');
    ids.rail = mk('Rail pass', japan, 'P1', '2026-10-20');
    ids.hotel = mk('Hotels', japan, 'P2', '2026-10-15');
    ids.ryokan = mk('Ryokan', japan, 'P2', '2026-10-16', false, { id: ids.hotel });
    ids.wifi = mk('Wifi', japan, 'P3', '2026-10-30');
    ids.photos = mk('Photos', japan, 'P1', '2026-10-01', true);
    ids.flights = mk('Flights', peru, 'P1', '2026-11-20');
    for (const v of weave.tableView(todo).views) if (v.name !== 'Standard') weave.tableView(`${todo.id}/${v.id}`, { delete: true });
    weave.tableView(`${todo.id}/Standard`, {
      layout: 'list', group: [{ field: 'Trip', heading: 'chip' }, 'Priority'], completedBy: 'Done', nest: 'Parent',
      collapsed: null, order: null, filters: {}, sort: [],
    });
  };
  const open = async (theme = 'light', width = 1200) => {
    const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: theme });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.errors = errors;
    await page.goto(`${base}/#/table/${todo.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-list .list-row');
    return page;
  };
  const view = () => weave.tableView(`${todo.id}/Standard`);
  const valueOf = (id, f) => weave.readEntity(id).fields[f];
  const rowsIn = (page, key) => page.$$eval(`.list-group[data-key="${key}"] .list-row`, (rs) => rs.map((r) => r.querySelector('.list-title').textContent.trim()));
  const footer = (page) => page.locator('.list-footer').textContent();
  const settle = (page) => page.waitForLoadState('networkidle');

  test('the list groups by Trip under its Chip, then Priority; Completed folds at the bottom; the footer counts', async () => {
    seed();
    for (const theme of ['light', 'dark']) {
      const page = await open(theme);
      try {
        assert.deepEqual(await page.$$eval('.wv-list > .list-group', (gs) => gs.map((g) => g.dataset.key)), ['Japan', 'Peru', 'Completed']);
        assert.equal(await page.locator('.list-group[data-key="Japan"] > .list-group-head .k-rel').count(), 1, 'the heading is the Trip row\'s Chip');
        assert.equal(await page.locator('.list-group[data-key="Japan"] > .list-group-head .cg-bar, .list-group[data-key="Japan"] > .list-group-head .cg-wrap').count() > 0, true, 'the % Done rollup draws its bar on the Chip');
        assert.deepEqual(await rowsIn(page, 'Japan › P1'), ['Passport', 'Rail pass']);
        assert.deepEqual(await rowsIn(page, 'Japan › P2'), ['Hotels', 'Ryokan']);
        assert.equal(await page.getAttribute(`.list-row[data-eid="${ids.ryokan}"]`, 'data-depth'), '1', 'nested under Hotels');
        assert.deepEqual(await rowsIn(page, 'Peru › P2'), [], 'an empty group shows with no filter on');
        assert.equal(await page.locator('.list-completed').evaluate((n) => n.classList.contains('shut')), true, 'Completed starts folded');
        assert.equal(await footer(page), '7 of 7 to-dos · 1 completed');
        const box = await page.locator(`.list-row[data-eid="${ids.pass}"] .list-check`);
        assert.equal(await box.evaluate((n) => n.classList.contains('form-check-input')), true, 'the standard checkbox');
        const color = await page.locator('.list-title').first().evaluate((n) => getComputedStyle(n).color);
        const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        assert.notEqual(color, bg, `${theme}: titles read against the page`);
        assert.deepEqual(page.errors, []);
      } finally { await page.close(); }
    }
  });

  test('ticking the box saves the field, moves the row to Completed and the Trip bar moves with it', async () => {
    seed();
    const page = await open();
    try {
      await page.click(`.list-row[data-eid="${ids.rail}"] .list-check`);
      await page.waitForFunction(() => document.querySelector('.list-footer')?.textContent.includes('2 completed'));
      assert.equal(valueOf(ids.rail, 'Done'), true);
      assert.deepEqual(await rowsIn(page, 'Japan › P1'), ['Passport']);
      assert.equal(weave.readEntity(ids.japan).fields['% Done'], '33%', 'two of six Japan to-dos');
    } finally { await page.close(); }
  });

  test('a fold is saved in the view and survives a reload', async () => {
    seed();
    const page = await open();
    try {
      await page.click('.list-group[data-key="Japan › P2"] > .list-group-head .list-fold');
      await eventually(() => view().collapsed, ['Completed', 'Japan › P2']);
      assert.deepEqual(view().collapsed, ['Completed', 'Japan › P2']);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-list');
      assert.equal(await page.locator('.list-group[data-key="Japan › P2"]').evaluate((n) => n.classList.contains('shut')), true);
    } finally { await page.close(); }
  });

  test('the add row fills every group level and reads a typed date', async () => {
    seed();
    const page = await open();
    try {
      const form = page.locator('.list-add[data-key="Peru › P3"]');
      await form.locator('.list-add-name').fill('Rain gear');
      await form.locator('.list-add-date').fill('2026-12-01');
      await form.locator('.list-add-name').press('Enter');
      await page.waitForFunction(() => [...document.querySelectorAll('.list-group[data-key="Peru › P3"] .list-title')].some((t) => t.textContent === 'Rain gear'));
      const made = weave.query(todo.id, { where: [['Name', '=', 'Rain gear']] }).items[0];
      assert.equal(made.fields.Priority, 'P3');
      assert.equal(made.fields.Trip?.name ?? made.fields.Trip, 'Peru');
      assert.equal(made.raw.Due, '2026-12-01');
      assert.equal(await page.evaluate(() => document.activeElement?.closest('.list-add')?.dataset.key), 'Peru › P3', 'focus stays in the add row for the next one');
    } finally { await page.close(); }
  });

  test('Tab nests a row under the one above it; Shift+Tab takes it back out', async () => {
    seed();
    const page = await open();
    try {
      await page.focus(`.list-row[data-eid="${ids.rail}"]`);
      await page.keyboard.press('Tab');
      await page.waitForFunction((id) => document.querySelector(`.list-row[data-eid="${id}"]`)?.dataset.depth === '1', ids.rail);
      assert.equal(weave.readEntity(ids.rail).fields.Parent?.name ?? weave.readEntity(ids.rail).fields.Parent, 'Passport');
      await page.focus(`.list-row[data-eid="${ids.rail}"]`);
      await page.keyboard.press('Shift+Tab');
      await page.waitForFunction((id) => document.querySelector(`.list-row[data-eid="${id}"]`)?.dataset.depth === '0', ids.rail);
      assert.equal(weave.readEntity(ids.rail).fields.Parent ?? null, null);
    } finally { await page.close(); }
  });

  test('dragging a row into another group sets that level and saves the manual order', async () => {
    seed();
    const page = await open();
    try {
      const grip = page.locator(`.list-row[data-eid="${ids.wifi}"] .list-grip`);
      await page.hover(`.list-row[data-eid="${ids.wifi}"]`);
      const from = await grip.boundingBox();
      const to = await page.locator(`.list-row[data-eid="${ids.pass}"]`).boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + 4, from.y + 10, { steps: 3 });
      await page.mouse.move(from.x + from.width / 2, to.y + 4, { steps: 8 });
      await page.mouse.up();
      await page.waitForFunction(() => [...document.querySelectorAll('.list-group[data-key="Japan › P1"] .list-title')].some((t) => t.textContent === 'Wifi'));
      assert.equal(valueOf(ids.wifi, 'Priority'), 'P1');
      assert.deepEqual(await rowsIn(page, 'Japan › P1'), ['Wifi', 'Passport', 'Rail pass']);
      const pid = (id) => weave.readEntity(id).publicId;
      assert.equal(view().order.indexOf(pid(ids.wifi)) < view().order.indexOf(pid(ids.pass)), true, 'the order is saved in the view');
    } finally { await page.close(); }
  });

  test('a sort orders rows inside each group; a filter hides empty groups and dims a parent it leaves out', async () => {
    seed();
    weave.tableView(`${todo.id}/Standard`, { sort: [{ field: 'Due', dir: 'desc' }] });
    let page = await open();
    try {
      assert.deepEqual(await rowsIn(page, 'Japan › P1'), ['Rail pass', 'Passport']);
    } finally { await page.close(); }
    weave.updateEntity(ids.hotel, { Priority: 'P3' });
    weave.tableView(`${todo.id}/Standard`, { sort: [], filters: { Priority: ['P2'] } });
    page = await open();
    try {
      assert.deepEqual(await page.$$eval('.wv-list > .list-group', (gs) => gs.map((g) => g.dataset.key)), ['Japan'], 'Peru has no P2 row and a filter is on');
      const parent = page.locator(`.list-row[data-eid="${ids.hotel}"]`);
      assert.equal(await parent.evaluate((n) => n.classList.contains('ghost')), true, 'Hotels shows dimmed above its matching sub-row');
      assert.equal(await page.locator('.list-group[data-key="Japan › P2"] > .list-group-head .list-count').textContent(), '1', 'and is not counted');
      assert.equal(await footer(page), '1 of 7 to-dos · 0 completed');
    } finally { await page.close(); }
  });

  test('the View menu switches Table and List without losing the grouping; the Group menu autosaves levels', async () => {
    seed();
    const page = await open();
    try {
      await page.click('.table-view-btn');
      await page.click('.view-layout .seg-opt:text-is("Table")');
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      assert.equal(view().layout, undefined);
      assert.deepEqual(view().group, [{ field: 'Trip', heading: 'chip' }, { field: 'Priority' }], 'Table keeps the list keys');
      if (!await page.locator('.table-view-popover').isVisible()) await page.click('.table-view-btn');
      await page.click('.view-layout .seg-opt:text-is("List")');
      await page.waitForSelector('.wv-list .list-row');
      await page.keyboard.press('Escape');
      await page.click('.table-group-btn');
      await page.click('.table-group-popover .group-level[data-level="Priority"] .group-remove');
      await eventually(() => view().group?.length, 1);
      assert.deepEqual(view().group, [{ field: 'Trip', heading: 'chip' }]);
      await page.waitForFunction(() => document.querySelector('.table-group-btn')?.textContent.includes('Group: Trip') && !document.querySelector('.table-group-btn').textContent.includes('Priority'));
      assert.equal(await page.locator('.wv-list > .list-group[data-key="Japan"] .list-group').count(), 0, 'one level now');
    } finally { await page.close(); }
  });
}
