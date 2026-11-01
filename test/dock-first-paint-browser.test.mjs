import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage } from './lib/browser.mjs';

let tasks, compact, task, other;
const s = await launch('dock first paint', (weave) => {
  weave.createSpace({ name: 'Work' });
  tasks = weave.createTable({ space: 'Work', name: 'Task' });
  weave.addField(tasks, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'Doing', category: 'in-progress' },
    { name: 'Done', category: 'done' }] } });
  weave.addField(tasks, { name: 'Owner', type: 'text' });
  weave.addField(tasks, { name: 'Points', type: 'number' });
  task = weave.createEntity(tasks, { name: 'Write the brief', values: { Status: 'Doing', Owner: 'bo', Points: 5 }, doc: '# Brief\n\nA paragraph the grid never carries.\n' });
  other = weave.createEntity(tasks, { name: 'Ship it', values: { Status: 'Open', Owner: 'ana' } });
  compact = weave.tableView(`${tasks.id}/Compact`, { from: 'blank', fields: ['Name', 'Status'] });
});

if (s) {
  const { base, browser } = s;
  const ENTITY = /\/api\/entities\/[^/?]+$/;
  const DOCK_STATUS = '#dock:not([hidden]) .fieldrow[data-field="Status"]';
  const DOC_MOUNTED = '#dock .doc-section[data-doc-field="Description"] :is(.vditor-ir [contenteditable="true"], textarea.doc-source)';

  async function holdEntityReads(page) {
    const held = [];
    let holding = true;
    await page.route(ENTITY, (route) => {
      if (holding && route.request().method() === 'GET') held.push(route);
      else route.continue();
    });
    return {
      count: () => held.length,
      release: async () => { holding = false; for (const r of held.splice(0)) await r.continue(); },
    };
  }

  const fieldOrder = (page) => page.$$eval('#dock .entity-values > .fieldrow', (rows) => rows.map((r) => r.dataset.field));
  const statusText = (page) => page.$eval(`${DOCK_STATUS} .chip-trigger, ${DOCK_STATUS} .picker-face`, (n) => n.textContent.trim());

  for (const colorScheme of ['light', 'dark']) {
    test(`opening a row paints the dock from the grid row before the entity request answers, in ${colorScheme} (Issue #1057)`, async () => {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
      await page.goto(`${base}/#/table/${tasks.id}/view/${compact.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector(`tr[data-eid="${task.id}"] .open-link`);
      const hold = await holdEntityReads(page);
      await page.click(`tr[data-eid="${task.id}"] .open-link`);
      await page.waitForSelector(DOCK_STATUS, { timeout: 3000 });
      assert.equal(hold.count(), 1, 'the entity request is in flight while the dock is already up');
      assert.equal(await page.inputValue('#dock .name-edit'), 'Write the brief', 'the name comes from the grid row');
      assert.match(await statusText(page), /Doing/, 'the Status chip comes from the grid row');
      assert.equal(await page.locator('#dock .fieldrow[data-field="Owner"] .fieldrow-pending').count(), 1, 'a field the grid does not hold waits as an empty slot');
      assert.equal(await page.locator('#dock .sk-entity, #dock [aria-busy="true"]').count(), 0, 'no skeleton and no busy state');
      assert.equal(await page.locator(DOC_MOUNTED).count(), 0, 'the document waits for the entity');
      const before = await fieldOrder(page);
      await page.$eval(`${DOCK_STATUS}`, (row) => { row.children[2].dataset.firstPaint = 'yes'; });
      await hold.release();
      await page.waitForSelector(DOC_MOUNTED);
      await page.waitForFunction(() => document.querySelector('#dock .fieldrow[data-field="Owner"] .text-dressed')?.textContent === 'bo');
      assert.equal(await page.locator('#dock .fieldrow-pending').count(), 0, 'every slot is filled');
      assert.deepEqual(await fieldOrder(page), before, 'the field order does not move');
      assert.equal(await page.$eval(DOCK_STATUS, (row) => row.children[2].dataset.firstPaint), 'yes', 'a value the grid painted is left in place');
      assert.match(await statusText(page), /Doing/);
      assert.equal(await page.$eval('html', (h) => h.dataset.bsTheme), colorScheme);
      await page.close();
    });
  }

  test('the fetched entity stays in the warm cache, so reopening the row sends no second request (Issue #1057)', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/table/${tasks.id}/view/${compact.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`tr[data-eid="${task.id}"] .open-link`);
    const reads = [];
    page.on('request', (r) => { if (r.method() === 'GET' && r.url().endsWith(`/api/entities/${task.id}`)) reads.push(r.url()); });
    await page.click(`tr[data-eid="${task.id}"] .open-link`);
    await page.waitForSelector(DOC_MOUNTED);
    assert.equal(reads.length, 1);
    await page.click(`tr[data-eid="${other.id}"] .open-link`);
    await page.waitForFunction(() => document.querySelector('#dock .name-edit')?.value === 'Ship it');
    await page.click(`tr[data-eid="${task.id}"] .open-link`);
    await page.waitForFunction(() => document.querySelector('#dock .name-edit')?.value === 'Write the brief');
    await page.waitForSelector(DOC_MOUNTED);
    assert.equal(reads.length, 1, 'the second open reads the cached entity');
    await page.close();
  });

  test('a grid value that changed on the server is redrawn when the entity lands', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/table/${tasks.id}/view/${compact.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`tr[data-eid="${other.id}"] .open-link`);
    const hold = await holdEntityReads(page);
    await page.click(`tr[data-eid="${other.id}"] .open-link`);
    await page.waitForSelector(DOCK_STATUS, { timeout: 3000 });
    assert.match(await statusText(page), /Open/);
    s.weave.updateEntity(other.id, { Status: 'Done' });
    await hold.release();
    await page.waitForFunction((sel) => /Done/.test(document.querySelector(sel)?.textContent ?? ''), `${DOCK_STATUS} .chip-trigger, ${DOCK_STATUS} .picker-face`);
    await page.close();
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`on a phone, tapping a row opens the record from the list row before the server answers, in ${colorScheme} (Issue #1059)`, async () => {
      const page = await phonePage(await phoneBrowser(), { colorScheme });
      await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
      await page.evaluate((h) => { location.hash = h; }, `#/table/${tasks.id}/view/${compact.id}`);
      await page.waitForSelector(`tr[data-eid="${task.id}"] .list-name`);
      const hold = await holdEntityReads(page);
      const box = await page.locator(`tr[data-eid="${task.id}"] .list-name`).boundingBox();
      await page.touchscreen.tap(box.x + 20, box.y + box.height / 2);
      await page.waitForSelector('#dock:not([hidden]) textarea.name-edit', { timeout: 3000 });
      assert.equal(hold.count(), 1, 'the entity request is still held');
      assert.equal(await page.inputValue('#dock .name-edit'), 'Write the brief');
      await page.waitForSelector(DOCK_STATUS);
      assert.match(await statusText(page), /Doing/);
      await hold.release();
      await page.waitForSelector(DOC_MOUNTED);
      await page.waitForFunction(() => document.querySelector('#dock .fieldrow[data-field="Owner"] .text-dressed')?.textContent === 'bo');
      await page.close();
    });
  }
}
