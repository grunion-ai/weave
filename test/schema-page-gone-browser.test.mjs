/* The legacy "<Space> / <Table> — fields" schema page is gone (Issue #196).

   Kyle, 2026-09-05, with a screenshot of "Workspace / Spaces — fields": "what
   is this page and why is it needed?" It was openSchemaEditor(), the v0.3.0
   one-table-per-screen schema editor the field tray (Feature #109) and the
   column ⋮ menu (Feature #144) replaced. Nothing opened it on purpose; the
   add-field tray's after-hook fell back to it whenever the add did not
   start on a #/table route — which is every registry grid: the Spaces grid
   on the workspace home, the Tables grid on a space page. Add a column
   there and you landed on a page with no undo, no reorder, no type detail.

   Now the tray hands you back to wherever you were: the table keeps its
   scroll, any other surface redraws its route. openSchemaEditor and the
   addRelationDialog only it reached are deleted; the source gate below
   keeps them out. Playwright is NOT a dependency; the suite skips when
   absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch } from './lib/browser.mjs';

const APP = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('no code path renders the "— fields" schema page', () => {
  assert.doesNotMatch(APP, /openSchemaEditor/, 'the v0.3.0 schema editor is gone');
  assert.doesNotMatch(APP, /— fields`/, 'and so is its heading');
  assert.doesNotMatch(APP, /addRelationDialog/, 'the relation dialog only it reached went with it — relation is a type in the field tray');
  assert.doesNotMatch(CSS, /\.schema-table/, 'its stylesheet rules went too');
  const after = APP.match(/function addFieldDialog\(db\) \{[\s\S]*?\n\}/)[0];
  assert.match(after, /renderRoute\(\)/, 'off a #/table route the add hands you back to the route you were on');
});

let sales;
const s = await launch('schema page gone', (weave) => {
  sales = weave.createSpace({ name: 'Sales' });
  weave.createTable({ space: 'Sales', name: 'Deals' });
});

if (s) {
  const { base, browser, weave } = s;
  const addField = async (page, name) => {
    await page.click('.wv-grid .add-field-btn');
    await page.waitForSelector('#tray');
    await page.fill('#tray input[name="name"]', name);
    await page.click('#tray .btn-primary');
    await page.waitForSelector('#tray', { state: 'detached' });
  };

  test('adding a column to the Spaces registry from the workspace home redraws the home, not the schema page', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await addField(page, 'Region');
    await page.waitForSelector('.wv-grid th:has-text("Region")');
    assert.equal(await page.locator('#main h1:has-text("— fields")').count(), 0, 'the schema page never appears');
    assert.equal(await page.evaluate(() => location.hash || '#/'), '#/', 'still on the workspace home');
    assert.ok(await page.locator('.wv-grid tbody tr.entity-row').count() >= 1, 'the Spaces grid is back, with the new column');
    assert.ok(weave.getField('Workspace/Spaces', 'Region'), 'the field landed on the registry table');
    await page.close();
  });

  test('the same from a space page: the Tables registry redraws in place', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/space/${sales.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await addField(page, 'Owner');
    await page.waitForSelector('.wv-grid th:has-text("Owner")');
    assert.equal(await page.locator('#main h1:has-text("— fields")').count(), 0);
    assert.equal(await page.evaluate(() => location.hash), `#/space/${sales.id}`, 'still on the space page');
    await page.close();
  });

  test('from the table itself the add still lands back on the table', async () => {
    const deals = weave.getTable('Deals');
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid');
    await addField(page, 'Stage');
    await page.waitForSelector('.wv-grid th:has-text("Stage")');
    assert.equal(await page.evaluate(() => location.hash), `#/table/${deals.id}`);
    await page.close();
  });
}
