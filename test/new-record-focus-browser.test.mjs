import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const FIT = { width: 1600, height: 720 };

let tasks, projects, alpha, seeded;
const s = await launch('new record focus', (weave) => {
  weave.createSpace({ name: 'Work' });
  tasks = weave.createTable({ space: 'Work', name: 'Tasks' });
  weave.addField(tasks, { name: 'Note', type: 'text' });
  projects = weave.createTable({ space: 'Work', name: 'Projects' });
  weave.addRelation(projects, { name: 'Tasks', targetDb: 'Tasks', cardinality: 'one-to-many', inverseName: 'Project' });
  alpha = weave.createEntity(projects, { name: 'Alpha' });
  seeded = [];
  for (let i = 0; i < 60; i++) seeded.push(weave.createEntity(tasks, { name: `task ${i}`, values: { Note: 'n' } }).id);
});

if (s) {
  const { base, browser, weave } = s;
  const nameOf = (id) => weave.entityName(weave.getEntity(id));

  const setTheme = (page, want) => page.evaluate((w) => {
    const btn = document.querySelector('#theme-toggle');
    for (let i = 0; i < 4 && document.documentElement.dataset.bsTheme !== w; i++) btn.click();
  }, want);

  const focused = (page) => page.evaluate(() => {
    const at = document.activeElement;
    const cell = at?.closest?.('tr[data-eid] > td');
    if (!cell) return { eid: null, field: null, tag: at?.tagName ?? null };
    const r = cell.parentElement.getBoundingClientRect();
    return {
      eid: cell.parentElement.dataset.eid, field: cell.dataset.field ?? null, tag: at.tagName,
      onScreen: r.top >= 0 && r.bottom <= innerHeight,
      caret: at.selectionStart != null ? [at.selectionStart, at.selectionEnd] : null,
    };
  });
  const waitForNewRow = (page, known) => page.waitForFunction((ids) => {
    const cell = document.activeElement?.closest?.('tr[data-eid] > td');
    return !!cell && !ids.includes(cell.parentElement.dataset.eid);
  }, known, { timeout: 5000 });
  const settle = (page) => page.waitForTimeout(400);

  for (const theme of ['light', 'dark']) {
    test(`${theme}: + New record on the table page lands the caret in the new row's Name cell`, async () => {
      const page = await browser.newPage({ viewport: FIT });
      await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector(`tr[data-eid="${seeded[0]}"] td[data-field="Name"] input`);
      await setTheme(page, theme);

      await page.click('.wv-grid .add-entity-btn');
      await waitForNewRow(page, seeded);
      await settle(page);

      const at = await focused(page);
      assert.equal(at.tag, 'INPUT', 'the Name editor holds focus');
      assert.equal(at.field, 'Name', 'it is the Name cell');
      assert.ok(at.eid && !seeded.includes(at.eid), 'it is the new row');
      assert.equal(at.onScreen, true, 'the new row is scrolled into view');
      assert.deepEqual(at.caret, [0, 0], 'the caret sits inside the empty cell');

      await page.keyboard.type('fresh');
      await page.keyboard.press('Enter');
      await page.waitForFunction((id) => document.querySelector(`tr[data-eid="${id}"] td[data-field="Name"] input`)?.value === 'fresh', at.eid);
      await settle(page);
      assert.equal(nameOf(at.eid), 'fresh', 'the typed name is stored');
      await page.close();
    });
  }

  test('Shift+Enter from a row commits it and lands in the next new row', async () => {
    const page = await browser.newPage({ viewport: FIT });
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    const first = seeded[0];
    await page.waitForSelector(`tr[data-eid="${first}"] td[data-field="Name"] input`);
    const known = await page.evaluate(() => [...document.querySelectorAll('tr[data-eid]')].map((r) => r.dataset.eid));

    await page.click(`tr[data-eid="${first}"] td[data-field="Name"] input`);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('!');
    await page.keyboard.press('Shift+Enter');
    await waitForNewRow(page, known);
    await settle(page);

    const at = await focused(page);
    assert.equal(at.tag, 'INPUT', 'the Name editor holds focus');
    assert.equal(at.field, 'Name', 'it is the Name cell');
    assert.ok(at.eid && !known.includes(at.eid), 'it is the new row');
    assert.equal(at.onScreen, true, 'the new row is scrolled into view');
    assert.equal(nameOf(first), 'task 0!', 'the edit Shift+Enter left behind was committed');

    await page.keyboard.type('second');
    await page.keyboard.press('Shift+Enter');
    await waitForNewRow(page, [...known, at.eid]);
    await settle(page);
    const again = await focused(page);
    assert.equal(again.field, 'Name');
    assert.ok(again.eid && again.eid !== at.eid && !known.includes(again.eid), 'a third row, and focus is in it');
    assert.equal(nameOf(at.eid), 'second');
    await page.close();
  });

  test('+ New table on the space page creates the table here, not a row in the last table visited', async () => {
    const page = await browser.newPage({ viewport: FIT });
    await page.addInitScript(() => localStorage.setItem('weave-schema-open', '1'));
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid .add-entity-btn');
    const before = weave.listEntities(tasks.id).length;
    const space = tasks.spaceId;
    await page.goto(`${base}/#/space/${space}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid .add-entity-btn');
    const known = await page.evaluate(() => [...document.querySelectorAll('tr[data-eid]')].map((r) => r.dataset.eid));

    await page.click('.wv-grid .add-entity-btn');
    await waitForNewRow(page, known);
    await settle(page);

    const at = await focused(page);
    assert.equal(at.tag, 'INPUT');
    assert.equal(at.field, 'Name', 'the new table row\'s Name cell holds focus');
    assert.equal(weave.listEntities(tasks.id).length, before, 'no stray row landed in Tasks');
    const made = weave.listTables().find((t) => t.name === 'New table');
    assert.ok(made, 'a table named "New table" exists');
    assert.equal(made.spaceId, space, 'in this space');
    await page.keyboard.type('Bugs');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !!document.querySelector('.wv-grid'));
    await settle(page);
    assert.ok(weave.listTables().some((t) => t.name === 'Bugs'), 'typing over the placeholder renamed the table');
    await page.close();
  });

  test('+ New on a relation grid of the entity page creates, links and lands in the new row', async () => {
    const page = await browser.newPage({ viewport: FIT });
    await page.goto(`${base}/#/entity/${alpha.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.related-block .add-entity-btn');

    await page.click('.related-block .add-entity-btn');
    await waitForNewRow(page, seeded);
    await settle(page);

    const at = await focused(page);
    assert.equal(at.tag, 'INPUT', 'the Name editor holds focus');
    assert.ok(at.eid && !seeded.includes(at.eid), 'it is the new row');
    assert.ok(await page.evaluate(() => !!document.activeElement.closest('.related-block')), 'inside the relation grid');
    const rel = Object.values(weave.getTable(projects.id).fields).find((f) => f.name === 'Tasks');
    const linked = weave.getEntity(alpha.id).values[rel.id] ?? [];
    assert.ok((Array.isArray(linked) ? linked : [linked]).includes(at.eid), 'the new task is linked to Alpha');
    await page.close();
  });
}
