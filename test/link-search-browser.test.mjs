import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let issueDb, releaseDb, personDb, release, grid, second, ada, grace;

const s = await launch('relation linking through workspace search', (weave) => {
  weave.createSpace({ name: 'Dev' });
  issueDb = weave.createTable({ space: 'Dev', name: 'Issue' });
  releaseDb = weave.createTable({ space: 'Dev', name: 'Release' });
  personDb = weave.createTable({ space: 'Dev', name: 'Person' });
  weave.addField(issueDb, { name: 'Notes', type: 'text' });
  weave.updateTable(issueDb.id, { noun: 'issue' });
  weave.addField(personDb, { name: 'Handle', type: 'text' });
  weave.addRelation(releaseDb, { name: 'Fixes', targetDb: 'Issue', cardinality: 'one-to-many', inverseName: 'Fixed in' });
  weave.addRelation(releaseDb, { name: 'Owner', targetDb: 'Person', cardinality: 'many-to-one', inverseName: 'Owns' });
  grid = weave.createEntity(issueDb, { name: 'Grid paints twice' });
  weave.updateEntity(grid.id, { Notes: 'quasar flicker on first load' });
  second = weave.createEntity(issueDb, { name: 'Second issue' });
  weave.createEntity(releaseDb, { name: 'quasar decoy release' });
  ada = weave.createEntity(personDb, { name: 'Ada' });
  grace = weave.createEntity(personDb, { name: 'Grace' });
  weave.updateEntity(grace.id, { Handle: 'admiral-cobol' });
  release = weave.createEntity(releaseDb, { name: 'v1.0' });
  weave.link(release.id, 'Fixes', [second.id]);
  weave.link(release.id, 'Owner', [ada.id]);
});

if (s) {
  const { base, browser, weave } = s;
  const linkedIds = (field) => {
    const v = weave.readEntity(release.id).fields[field];
    return (Array.isArray(v) ? v : v ? [v] : []).map((x) => x.id).sort();
  };
  const open = async (colorScheme = 'light') => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
    const nameOnly = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/api\/tables\/[^/]+\/query$/.test(new URL(r.url()).pathname)
        && /"select":\["Name"\]/.test(r.postData() ?? '')) nameOnly.push(r.url());
    });
    await page.goto(`${base}/#/entity/${release.id}`, { waitUntil: 'load' });
    await page.waitForSelector('.related-section .add-entity-btn');
    return { page, nameOnly };
  };
  const typeIn = async (page, text) => {
    await page.fill('#cmdk-input', text);
    await page.waitForFunction((t) => document.querySelector('#cmdk-results')?.dataset.query === t, text);
  };
  const rowNamed = (page, name) => page.locator('#cmdk-results .result', { hasText: name });

  test('+ Link existing opens the workspace search scoped to the target table, finds a row by a non-Name field, and links it', async () => {
    const { page, nameOnly } = await open();
    await page.locator('.related-section .add-entity-btn', { hasText: 'Link existing' }).click();
    await page.waitForSelector('#cmdk-input');
    await typeIn(page, 'quasar');
    const names = await page.$$eval('#cmdk-results .result .cmdk-name', (ns) => ns.map((n) => n.textContent));
    assert.deepEqual(names, ['Grid paints twice'], 'only Issue rows come back; the Release named quasar stays out');
    assert.match(await rowNamed(page, 'Grid paints twice').textContent(), /quasar flicker/, 'the excerpt shows the Notes text that matched');
    assert.equal(await page.locator('#cmdk-results .result.cmdk-create').count(), 1, 'a + New row sits at the end');
    assert.match(await page.locator('#cmdk-results .result').last().textContent(), /\+ New issue/);
    await rowNamed(page, 'Grid paints twice').click();
    assert.equal(await page.locator('#cmdk-back').count(), 1, 'a to-many relation stays open after a pick');
    assert.equal(await rowNamed(page, 'Grid paints twice').getAttribute('aria-checked'), 'true');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#cmdk-back', { state: 'detached' });
    await page.waitForFunction(() => document.querySelectorAll('.related-section tbody tr.entity-row').length === 2);
    assert.deepEqual(linkedIds('Fixes'), [grid.id, second.id].sort(), 'Esc committed the pick: both issues are linked');
    assert.deepEqual(nameOnly, [], 'no Name-only preload of the target table');
    await page.close();
  });

  test('a to-many relation shows linked rows checked and toggles one off; Enter on an empty input commits', async () => {
    const { page } = await open('dark');
    await page.locator('.related-section .add-entity-btn', { hasText: 'Link existing' }).click();
    await page.waitForSelector('#cmdk-results .result');
    assert.equal(await rowNamed(page, 'Second issue').getAttribute('aria-checked'), 'true', 'the linked row is listed and checked before typing');
    assert.equal(await page.$eval('html', (h) => h.dataset.bsTheme), 'dark');
    const paint = await rowNamed(page, 'Second issue').locator('.cmdk-check').evaluate((n) => getComputedStyle(n).backgroundColor);
    assert.notEqual(paint, 'rgba(0, 0, 0, 0)', 'the check box fills in the dark theme');
    await rowNamed(page, 'Second issue').click();
    assert.equal(await rowNamed(page, 'Second issue').getAttribute('aria-checked'), 'false');
    await page.focus('#cmdk-input');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#cmdk-back', { state: 'detached' });
    await page.waitForFunction(() => document.querySelectorAll('.related-section tbody tr.entity-row').length === 1);
    assert.deepEqual(linkedIds('Fixes'), [grid.id], 'the unchecked row was unlinked, the other kept');
    await page.close();
  });

  test('a to-one relation on the entity page replaces its value on pick and closes', async () => {
    const { page, nameOnly } = await open();
    await page.locator('.fieldrow[data-field="Owner"] button', { hasText: 'link' }).click();
    await page.waitForSelector('#cmdk-results .result');
    assert.equal(await rowNamed(page, 'Ada').getAttribute('aria-checked'), 'true', 'the current owner shows checked');
    await typeIn(page, 'cobol');
    assert.deepEqual(await page.$$eval('#cmdk-results .result .cmdk-name', (ns) => ns.map((n) => n.textContent)), ['Grace']);
    await rowNamed(page, 'Grace').click();
    await page.waitForSelector('#cmdk-back', { state: 'detached' });
    await page.waitForFunction(() => /Grace/.test(document.querySelector('.fieldrow[data-field="Owner"]')?.textContent ?? ''));
    assert.deepEqual(linkedIds('Owner'), [grace.id], 'Grace replaced Ada');
    assert.deepEqual(nameOnly, []);
    await page.close();
  });

  test('+ New in the link search creates the row from the typed text and links it', async () => {
    const { page } = await open();
    await page.locator('.related-section .add-entity-btn', { hasText: 'Link existing' }).click();
    await page.waitForSelector('#cmdk-input');
    await typeIn(page, 'Brand new bug');
    await page.locator('#cmdk-results .result.cmdk-create').click();
    await page.waitForFunction(() => [...document.querySelectorAll('#cmdk-results .result[aria-checked="true"]')].some((r) => r.textContent.includes('Brand new bug')));
    await page.keyboard.press('Escape');
    await page.waitForSelector('#cmdk-back', { state: 'detached' });
    const made = weave.query(issueDb.id, { where: [['Name', '=', 'Brand new bug']] }).items;
    assert.equal(made.length, 1, 'the row was created once');
    assert.ok(linkedIds('Fixes').includes(made[0].id), 'and linked');
    await page.close();
  });
}
