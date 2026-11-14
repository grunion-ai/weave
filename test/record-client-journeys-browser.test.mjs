import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, painted, eventually } from './lib/browser.mjs';

let slideTable, slide, project, task;
const s = await launch('record client journeys', (weave) => {
  weave.createSpace({ name: 'Dev' });
  slideTable = weave.createTable({ space: 'Dev', name: 'Slide' });
  weave.addField(slideTable.id, { name: 'Model', type: 'document', config: { kind: 'code' } });
  weave.addField(slideTable.id, { name: 'Version', type: 'number' });
  slide = weave.createEntity(slideTable.id, { values: { Name: 'Cover', Version: 1 } });
  weave.setDoc(slide.id, JSON.stringify({ layout: 'content', els: [{ role: 'H1', x: 60, y: 100, w: 800, text: 'Hello' }] }), 'Model');

  const tasks = weave.createTable({ space: 'Dev', name: 'Tasks' });
  weave.addField(tasks.id, { name: 'Status', type: 'select', config: { options: ['Open', 'Done'] } });
  const projects = weave.createTable({ space: 'Dev', name: 'Projects' });
  weave.addRelation(projects.id, { name: 'Tasks', targetDb: 'Tasks', cardinality: 'one-to-many', inverseName: 'Project' });
  project = weave.createEntity(projects.id, { name: 'Alpha' });
  task = weave.createEntity(tasks.id, { name: 'first task', values: { Status: 'Open' } });
  weave.link(project.id, 'Tasks', [task.id]);
});

if (s) {
  const { base, browser, weave } = s;
  const entityPage = async (id) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await painted(page, '.entity-grid');
    return page;
  };
  test('Expand on a slide preview swaps the record for the full deck frame, and Collapse brings it back', async () => {
    const page = await entityPage(slide.id);
    try {
      await page.locator('.deck-section .doc-anchor[title="Expand"]').click();
      const frame = page.locator('.doc-expand iframe.doc-expand-frame');
      await frame.waitFor();
      assert.deepEqual(
        [await frame.getAttribute('src'), await page.locator('.entity-grid').evaluate((n) => n.classList.contains('hidden'))],
        [`/e/${slide.id}/deck.html`, true]);
      await page.locator('.doc-expand-bar button', { hasText: 'Collapse' }).click();
      await page.locator('.doc-expand').waitFor({ state: 'detached' });
      assert.equal(await page.locator('.entity-grid').evaluate((n) => n.classList.contains('hidden')), false);
    } finally { await page.close(); }
  });

  test('New version on a slide clones it at Version 2 and opens the copy', async () => {
    const page = await entityPage(slide.id);
    try {
      const known = new Set(weave.listEntities(slideTable.id).map((e) => e.id));
      await page.locator('.deck-section .deck-new-version').click();
      await page.waitForFunction((id) => /^#\/entity\//.test(location.hash) && !location.hash.endsWith(id), slide.id);
      const opened = (await page.evaluate(() => location.hash)).slice('#/entity/'.length);
      assert.ok(!known.has(opened), 'the page moved to a new row');
      assert.equal(weave.readEntity(opened).fields.Version, 2);
      assert.equal(weave.getDoc(opened, 'Model'), weave.getDoc(slide.id, 'Model'));
      assert.equal(weave.readEntity(slide.id).fields.Version, 1);
    } finally { await page.close(); }
  });

  test('a click on a picker cell of a related table, beside its chip, opens that cell\'s picker', async () => {
    const page = await entityPage(project.id);
    try {
      const cell = page.locator(`.related-block tr[data-eid="${task.id}"] td.cell-pick`);
      await cell.waitFor();
      await cell.click({ position: { x: 4, y: 4 } });
      const pop = page.locator('.picker-pop');
      await pop.waitFor();
      assert.equal((await pop.locator('.picker-title').textContent()).trim(), 'Status');
      await pop.getByText('Done', { exact: true }).click();
      assert.equal(await eventually(() => weave.readEntity(task.id).fields.Status, 'Done'), 'Done');
    } finally { await page.close(); }
  });
}
