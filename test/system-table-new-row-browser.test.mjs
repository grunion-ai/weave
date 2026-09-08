/* + New on the Workspace registries (Issue #241).
   The grid foot on a regular table posts a blank row and lands the caret in
   its Name cell. On Workspace/Spaces the engine refused the blank row —
   `Name is required` — and the grid swallowed the 400: no row, no toast,
   focus left on <body>. Kyle read it as a dead button. The row IS the space,
   so it is born as "New space" with the name selected for the caret to
   replace (the home page already did this); a Tables or Fields row needs
   more than a name and the foot opens the dialog that asks for it; a
   Workflows row is ordinary data and takes the ordinary path; a refused
   create always surfaces as a toast. Playwright is NOT a dependency; the
   suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tasks, spacesT, tablesT, fieldsT, wfT;
const s = await launch('system table new row', (weave) => {
  weave.createSpace({ name: 'Work' });
  tasks = weave.createTable({ space: 'Work', name: 'Tasks' });
  weave.addField(tasks, { name: 'Note', type: 'text' });
  spacesT = weave.getTable('Workspace/Spaces');
  tablesT = weave.getTable('Workspace/Tables');
  fieldsT = weave.getTable('Workspace/Fields');
  wfT = weave.getTable('Workspace/Workflows');
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

  test('+ New space on Workspace/Spaces births "New space", selected, and the typed name renames it', async () => {
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

  test('+ New workflow on Workspace/Workflows adds an ordinary blank row with the caret in Name', async () => {
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

  test('+ New table on Workspace/Tables asks for the name and the space, then lands on the new row', async () => {
    const page = await open(tablesT);
    const known = ids(tablesT);
    await page.click('.wv-grid .add-entity-btn');
    await page.waitForSelector('#modal input[name="name"]');
    // The space is picked in the one dialect (search bar, list under it).
    await page.click('#modal .picker-face');
    await page.waitForSelector('.chip-pop .picker-row');
    const spaces = await page.$$eval('.chip-pop .picker-row', (rs) => rs.map((r) => r.textContent.trim()));
    assert.ok(!spaces.some((v) => v.includes('Workspace')), 'the system space is not on offer');
    assert.ok(spaces.some((v) => v.includes('Work')));
    await page.fill('.chip-pop .picker-search', 'Work');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#modal input[name="space"]')?.value === 'Work');
    await page.fill('#modal input[name="name"]', 'Widgets');
    await page.click('#modal button[type="submit"]');
    await waitForNewRow(page, known);
    const at = await focused(page);
    assert.equal(at.field, 'Name');
    const made = weave.findTable('Work/Widgets');
    assert.ok(made, 'the table exists in the chosen space');
    assert.equal(weave.getEntity(at.eid).sysId, made.id, 'the focused row is that table');
    await page.close();
  });

  test('+ New field on Workspace/Fields asks which table, then opens the field dialog for it', async () => {
    const page = await open(fieldsT);
    await page.click('.wv-grid .add-entity-btn');
    await page.waitForSelector('#modal input[name="table"]', { state: 'attached' });
    assert.equal(await page.inputValue('#modal input[name="table"]'), tasks.id, 'a user table is preselected, so Next works as is');
    await page.click('#modal button[type="submit"]');
    await page.waitForSelector('input[name="name"][placeholder="Field name"]');
    await page.fill('input[name="name"][placeholder="Field name"]', 'Owner');
    await page.click('#tray button[type="submit"], #modal button[type="submit"]');
    await page.waitForFunction(() => [...document.querySelectorAll('.wv-grid tr[data-eid] td[data-field="Name"] input')].some((i) => i.value === 'Owner'), null, { timeout: 5000 });
    assert.ok(Object.values(weave.getTable(tasks.id).fields).some((f) => f.name === 'Owner'), 'the field landed on the chosen table');
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
