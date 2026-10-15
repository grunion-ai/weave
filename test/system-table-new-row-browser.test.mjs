import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tasks, notes, spacesT, tablesT, fieldsT, wfT;
const s = await launch('system table new row', (weave) => {
  weave.createSpace({ name: 'Work' });
  tasks = weave.createTable({ space: 'Work', name: 'Tasks' });
  weave.addField(tasks, { name: 'Note', type: 'text' });
  notes = weave.createTable({ space: 'Work', name: 'Notes' });
  spacesT = weave.getTable('System/Spaces');
  tablesT = weave.getTable('System/Tables');
  fieldsT = weave.getTable('System/Fields');
  wfT = weave.getTable('System/Workflows');
});

if (s) {
  const { base, browser, weave } = s;
  const ids = (db) => weave.listEntities(db.id).map((e) => e.id);
  const focused = (page) => page.evaluate(() => {
    const at = document.activeElement;
    const cell = at?.closest?.('.wv-grid td[data-field]');
    if (!cell) return { eid: null, field: null, tag: at?.tagName ?? null };
    const r = cell.parentElement.getBoundingClientRect();
    return {
      eid: cell.parentElement.dataset.eid, field: cell.dataset.field ?? null, tag: at.tagName,
      onScreen: r.top >= 0 && r.bottom <= innerHeight,
      selected: at.selectionStart != null ? at.value.slice(at.selectionStart, at.selectionEnd) : null,
    };
  });
  const waitForNewRow = (page, known) => page.waitForFunction((k) => {
    const cell = document.activeElement?.closest?.('.wv-grid td[data-field="Name"]');
    return !!cell && !k.includes(cell.parentElement.dataset.eid);
  }, known, { timeout: 5000 });
  const open = async (db) => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${db.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid .add-entity-btn');
    return page;
  };

  test('+ New space on System/Spaces births "New space", selected, and the typed name renames it', async () => {
    const page = await open(spacesT);
    const known = ids(spacesT);
    await page.click('.wv-grid .add-entity-btn');
    await waitForNewRow(page, known);
    const at = await focused(page);
    assert.equal(at.tag, 'INPUT');
    assert.equal(at.field, 'Name');
    assert.equal(at.onScreen, true, 'the new row is on screen');
    assert.equal(at.selected, 'New space', 'the placeholder is selected whole, so typing replaces it');
    await page.keyboard.type('Ops');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('.nav-space')].some((n) => n.textContent.includes('Ops')), null, { timeout: 5000 });
    assert.ok(weave.listSpaces().some((sp) => sp.name === 'Ops'), 'the space exists under its typed name');
    assert.ok(!weave.listSpaces().some((sp) => sp.name === 'New space'), 'the placeholder did not survive the commit');
    await page.close();
  });

  test('Shift+Enter from a Spaces row takes the same door', async () => {
    const page = await open(spacesT);
    const known = ids(spacesT);
    await page.click(`tr[data-eid="${known[0]}"] td[data-field="Name"] input`);
    await page.keyboard.press('Shift+Enter');
    await waitForNewRow(page, known);
    const at = await focused(page);
    assert.equal(at.field, 'Name');
    assert.equal(at.selected, 'New space');
    await page.keyboard.type('Second');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('.nav-space')].some((n) => n.textContent.includes('Second')), null, { timeout: 5000 });
    assert.ok(weave.listSpaces().some((sp) => sp.name === 'Second'));
    await page.close();
  });

  test('+ New workflow on System/Workflows adds an ordinary blank row with the caret in Name', async () => {
    const page = await open(wfT);
    const known = ids(wfT);
    await page.click('.wv-grid .add-entity-btn');
    await waitForNewRow(page, known);
    const at = await focused(page);
    assert.equal(at.tag, 'INPUT');
    assert.equal(at.field, 'Name');
    await page.keyboard.type('Nightly');
    await page.keyboard.press('Enter');
    await page.waitForFunction((id) => document.querySelector(`tr[data-eid="${id}"] td[data-field="Name"] input`)?.value === 'Nightly', at.eid, { timeout: 5000 });
    assert.equal(weave.entityName(weave.getEntity(at.eid)), 'Nightly');
    await page.close();
  });

  test('+ New table on System/Tables opens the tray for the name and the space, then lands on the new row (Issue #778)', async () => {
    const page = await open(tablesT);
    const known = ids(tablesT);
    await page.click('.wv-grid .add-entity-btn');
    await page.waitForSelector('#tray-back input[name="name"]');
    assert.equal(await page.locator('#modal-back').count(), 0, 'create happens in the tray, not a modal');
    await page.click('#tray-back .picker-face');
    await page.waitForSelector('.chip-pop .picker-row');
    const spaces = await page.locator('.chip-pop .picker-row').evaluateAll((rs) => rs.map((r) => r.textContent.trim()));
    assert.ok(!spaces.some((v) => v.includes('System')), 'the system space is not on offer');
    assert.ok(spaces.some((v) => v.includes('Work')));
    await page.fill('.chip-pop .picker-search', 'Work');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#tray-back input[name="space"]')?.value === 'Work');
    await page.fill('#tray-back input[name="name"]', 'Widgets');
    await page.click('#tray-back button[type="submit"]');
    await waitForNewRow(page, known);
    const at = await focused(page);
    assert.equal(at.field, 'Name');
    const made = weave.findTable('Work/Widgets');
    assert.ok(made, 'the table exists in the chosen space');
    assert.equal(weave.getEntity(at.eid).sysId, made.id, 'the focused row is that table');
    await page.close();
  });

  test('the sidebar space + opens the same tray and lands on the new table (Issue #778)', async () => {
    const page = await open(tablesT);
    const from = await page.evaluate(() => location.hash);
    const add = page.locator('#sidebar .nav-add-table').first();
    await add.waitFor();
    await add.click();
    await page.waitForSelector('#tray-back input[name="name"]');
    assert.equal(await page.locator('#modal-back').count(), 0, 'create happens in the tray, not an inline nav input');
    assert.equal(await page.locator('#sidebar .nav-inline-add').count(), 0, 'and not the old inline name box');
    assert.equal(await page.locator('#tray-back input[name="space"], #tray-back .picker-face').count(), 0,
      'the sidebar already knows which space it is adding to');
    await page.fill('#tray-back input[name="name"]', 'Shipments');
    await page.click('#tray-back button[type="submit"]');
    await page.waitForFunction((h) => location.hash.startsWith('#/table/') && location.hash !== h, from);
    const made = weave.listTables().find((t) => t.name === 'Shipments');
    assert.ok(made, 'the table exists');
    assert.equal(await page.evaluate(() => location.hash), `#/table/${made.id}`, 'and the sidebar lands on it');
    await page.close();
  });

  test('+ New field on System/Fields opens the tray with a Table row, no modal in front (Issue #779)', async () => {
    const page = await open(fieldsT);
    await page.click('.wv-grid .add-entity-btn');
    await page.waitForSelector('#tray-back input[name="table"]', { state: 'attached' });
    assert.equal(await page.locator('#modal-back').count(), 0, 'one surface, not a modal that hands off to the tray');
    assert.equal(await page.locator('#tray-back input[name="name"][placeholder="Field name"]').count(), 1,
      'the name and the type are on the same surface as the table');
    assert.equal(await page.inputValue('#tray-back input[name="table"]'), tasks.id, 'a user table is preselected');
    await page.click('#tray-back .picker-face');
    await page.waitForSelector('.chip-pop .picker-row');
    await page.fill('.chip-pop .picker-search', 'Notes');
    await page.keyboard.press('Enter');
    await page.waitForFunction((id) => document.querySelector('#tray-back input[name="table"]')?.value === id, notes.id);
    assert.equal(await page.locator('#modal-back').count(), 0, 'switching tables stays in the tray');
    await page.fill('#tray-back input[name="name"][placeholder="Field name"]', 'Owner');
    await page.click('#tray-back button[type="submit"]');
    await page.waitForFunction(() => [...document.querySelectorAll('.wv-grid tr[data-eid] td[data-field="Name"] input')].some((i) => i.value === 'Owner'), null, { timeout: 5000 });
    assert.ok(Object.values(weave.getTable(notes.id).fields).some((f) => f.name === 'Owner'), 'the field landed on the table chosen in the tray');
    assert.ok(!Object.values(weave.getTable(tasks.id).fields).some((f) => f.name === 'Owner'), 'and not on the one it opened with');
    await page.close();
  });

  test('a column header opens the same tray with no Table row, since the table is known (Issue #779)', async () => {
    const page = await open(tasks);
    await page.click('#main .add-field-btn');
    await page.waitForSelector('#tray-back input[name="name"][placeholder="Field name"]');
    assert.equal(await page.locator('#modal-back').count(), 0, 'no modal in front of the tray');
    assert.equal(await page.locator('#tray-back input[name="table"]').count(), 0,
      'the column header already knows its table, so the tray asks for none');
    await page.close();
  });

  test('a refused create is said out loud: the engine error lands in a toast', async () => {
    const page = await open(spacesT);
    await page.route('**/api/tables/*/entities', (route) => route.request().method() === 'POST'
      ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Space name is taken', code: 'invalid' }) })
      : route.continue());
    await page.click('.wv-grid .add-entity-btn');
    await page.waitForSelector('.wv-toast.err');
    assert.equal(await page.textContent('.wv-toast.err'), 'Space name is taken');
    await page.close();
  });

  test('regular table: the foot still posts a blank row and lands the caret in it', async () => {
    const page = await open(tasks);
    const known = ids(tasks);
    await page.click('.wv-grid .add-entity-btn');
    await waitForNewRow(page, known);
    const at = await focused(page);
    assert.equal(at.field, 'Name');
    assert.equal(at.selected, '', 'a regular row starts empty');
    await page.close();
  });
}
