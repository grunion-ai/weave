/* Issue #386 — the first-run empty state. A fresh root workspace holds only
   the registry (the system Workspace space), and it used to open on the
   Spaces registry grid; the welcome line waited for zero tables, which a
   root never has. Now an empty workspace shows one primary New table action
   and three templates, and the registry grids on the home and space pages
   fold under a Schema disclosure, one click away. A populated workspace
   shows no empty state and keeps its relation map. Both themes are checked.
   Playwright is NOT a dependency of weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { seed } from '../scripts/seed.mjs';

const empty = await launch('first run: empty workspace');
const full = empty && await launch('first run: populated workspace', (weave) => {
  seed(weave);
  return { product: weave.getSpace('Product') };
});

async function open(s, hash, theme = 'light', { schemaOpen = false } = {}) {
  const page = await s.browser.newPage();
  await page.addInitScript(([t, o]) => {
    localStorage.setItem('weave-theme', t);
    if (o) localStorage.setItem('weave-schema-open', '1');
  }, [theme, schemaOpen]);
  await page.goto(`${s.base}/${hash}`);
  await page.waitForSelector('.view-header');
  return page;
}

if (empty) {
  for (const theme of ['light', 'dark']) {
    test(`${theme}: an empty workspace opens on New table and three templates, not the registry grid`, async () => {
      const page = await open(empty, '#/', theme);
      await page.waitForSelector('.wv-start');
      assert.equal((await page.locator('.wv-start .wv-start-new').textContent()).trim(), '+ New table');
      assert.deepEqual(await page.locator('.wv-start-template .wv-start-title').allTextContents(), ['Tasks', 'CRM', 'Docs']);
      assert.match(await page.locator('.wv-start-lead').textContent(), /space/);
      // The registry is folded, closed, and drew nothing.
      await page.waitForSelector('details.wv-schema');
      assert.equal(await page.locator('details.wv-schema').evaluate((d) => d.open), false);
      assert.equal(await page.locator('.wv-grid').count(), 0, 'no grid on the first screen');
      assert.equal(await page.locator('.home-map').count(), 0, 'no map with nothing to draw');
      // The primary action reads on its ground in this theme.
      const btn = await page.locator('.wv-start-new').evaluate((b) => [getComputedStyle(b).color, getComputedStyle(b).backgroundColor]);
      assert.notEqual(btn[0], btn[1], `${theme}: button text and ground differ`);
      await page.close();
    });
  }

  test('opening Schema draws the Spaces registry grid, and the choice sticks', async () => {
    const page = await open(empty, '#/');
    await page.click('details.wv-schema > summary');
    await page.waitForSelector('details.wv-schema .wv-grid tbody tr.entity-row');
    assert.equal(await page.evaluate(() => localStorage.getItem('weave-schema-open')), '1');
    await page.reload();
    await page.waitForSelector('details.wv-schema[open] .wv-grid tbody tr.entity-row');
    await page.click('details.wv-schema > summary');
    // The toggle event lands a task after the click.
    await page.waitForFunction(() => localStorage.getItem('weave-schema-open') === '0');
    await page.close();
  });

  test('New table with no space yet names one, then lands on the new table', async () => {
    const page = await open(empty, '#/');
    await page.click('.wv-start-new');
    await page.waitForSelector('#modal-back input[name="name"]');
    assert.equal(await page.inputValue('#modal-back input[name="space"]'), 'General');
    await page.fill('#modal-back input[name="name"]', 'Notes');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.hash.startsWith('#/table/'));
    assert.ok(empty.weave.findTable('General/Notes'), 'the table exists in a new General space');
    // Home is no longer empty.
    await page.goto(`${empty.base}/#/`);
    await page.waitForSelector('.home-map');
    assert.equal(await page.locator('.wv-start').count(), 0);
    empty.weave.deleteSpace('General', { hard: true });
    await page.close();
  });

  test('the Tasks template builds its table with a workflow and opens it, once on a double click', async () => {
    const page = await open(empty, '#/');
    const spacePosts = [];
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/spaces')) spacePosts.push(r.url()); });
    await page.dblclick('.wv-start-template[data-template="tasks"]');
    await page.waitForFunction(() => location.hash.startsWith('#/table/'));
    assert.equal(spacePosts.length, 1, 'the second click found the card disabled');
    const tasks = empty.weave.findTable('Work/Tasks');
    assert.ok(tasks, 'Work/Tasks exists');
    assert.equal(empty.weave.findField(tasks, 'Status')?.type, 'workflow');
    assert.ok(page.url().endsWith(`#/table/${tasks.id}`), 'landed on it');
    empty.weave.deleteSpace('Work', { hard: true });
    await page.close();
  });
}

if (full) {
  for (const theme of ['light', 'dark']) {
    test(`${theme}: a populated workspace shows no empty state and keeps its relation map`, async () => {
      const page = await open(full, '#/', theme);
      await page.waitForSelector('.home-map');
      assert.equal(await page.locator('.wv-start').count(), 0);
      assert.equal(await page.locator('details.wv-schema').evaluate((d) => d.open), false);
      assert.equal(await page.locator('.wv-grid').count(), 0, 'the Spaces grid waits behind Schema');
      await page.close();
    });
  }

  test('a space page lists its tables plainly and folds the Tables grid under Schema', async () => {
    const page = await open(full, `#/space/${full.product.id}`);
    await page.waitForSelector('.space-tables .list-row');
    const names = await page.locator('.space-tables .list-row:not(.list-row-add) > span:first-child').allTextContents();
    assert.deepEqual(names.sort(), ['Project', 'Task']);
    assert.match(await page.locator('.space-tables').textContent(), /\d+ (records|tasks|projects)/);
    assert.equal(await page.locator('.wv-grid').count(), 0);
    await page.click('details.wv-schema > summary');
    await page.waitForSelector('details.wv-schema .wv-grid tbody tr.entity-row');
    assert.equal(await page.locator('details.wv-schema .wv-grid tbody tr.entity-row').count(), 2, 'this space\'s two Tables rows');
    // A row in the plain list opens the table.
    await page.locator('.space-tables .list-row', { hasText: 'Task' }).first().click();
    await page.waitForFunction(() => location.hash.startsWith('#/table/'));
    await page.close();
  });
}
