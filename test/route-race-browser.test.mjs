import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage } from './lib/browser.mjs';

let tasks, people, alpha, beta, ana;
const s = await launch('route race', (weave) => {
  weave.createSpace({ name: 'Net' });
  tasks = weave.createTable({ space: 'Net', name: 'Task' });
  people = weave.createTable({ space: 'Net', name: 'Person' });
  weave.addField(tasks, { name: 'Owner', type: 'text' });
  weave.addRelation(tasks, { name: 'Lead', targetDb: people.id, cardinality: 'many-to-one', inverseName: 'Tasks' });
  ana = weave.createEntity(people, { name: 'Ana Reyes' });
  alpha = weave.createEntity(tasks, { name: 'Alpha', values: { Owner: 'ana' }, doc: '# Alpha\n\nThe body only the record read carries.\n' });
  beta = weave.createEntity(tasks, { name: 'Beta', values: { Owner: 'bo' }, doc: '# Beta\n\nAnother body.\n' });
  for (let i = 0; i < 8; i++) weave.createEntity(tasks, { name: `Filler ${i + 1}` });
  weave.updateEntity(alpha.id, { Lead: ana.id });
});

if (s) {
  const { base, browser } = s;
  const dockName = (page) => page.evaluate(() => document.querySelector('#dock .name-edit')?.value ?? null);
  const dockEid = (page) => page.evaluate(() => document.querySelector('#dock')?.dataset.eid ?? null);
  const dockUp = (page) => page.evaluate(() => !!document.querySelector('#dock:not([hidden])'));
  const routeError = (page) => page.evaluate(() => document.querySelector('.wv-route-error-msg')?.textContent ?? null);
  const gridRows = (page) => page.evaluate(() => document.querySelectorAll('#main tr.entity-row').length);
  const thrown = (page) => page.evaluate(() => window.__wvThrown ?? []);

  async function collectThrown(page) {
    await page.addInitScript(() => {
      window.__wvThrown = [];
      addEventListener('error', (e) => window.__wvThrown.push(String(e.message)));
      addEventListener('unhandledrejection', (e) => window.__wvThrown.push(String(e.reason?.message ?? e.reason)));
    });
    return page;
  }

  const newPage = async () => collectThrown(await browser.newPage({ viewport: { width: 1400, height: 900 } }));

  async function holdReadsOf(page, id, tails = ['', '/references', '/references-from']) {
    const held = [];
    let mode = 'hold';
    let caught;
    const first = new Promise((resolve) => { caught = resolve; });
    const take = (route) => {
      if (mode !== 'hold') return route.continue();
      held.push(route);
      caught();
    };
    for (const tail of tails) await page.route(`**/api/entities/${id}${tail}`, take);
    return {
      first: () => first,
      count: () => held.length,
      release: async () => { mode = 'pass'; for (const r of held.splice(0)) await r.continue(); },
      fail: async () => { mode = 'pass'; for (const r of held.splice(0)) await r.abort('failed'); },
    };
  }

  async function gridUp(page) {
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'commit' });
    await page.waitForSelector(`#main tr[data-eid="${beta.id}"] .open-link`);
    await page.waitForSelector(`#main tr[data-eid="${alpha.id}"] .doc-preview`);
  }

  const openWithoutHeldRow = async (page) => {
    await page.click(`#main tr[data-eid="${alpha.id}"] .doc-preview`);
    await page.waitForFunction(() => !!dock);
  };

  test('closing the dock while its record reads are held leaves the table up and throws nothing (Issue #1444)', async () => {
    const page = await newPage();
    const hold = await holdReadsOf(page, alpha.id);
    await gridUp(page);
    await openWithoutHeldRow(page);
    assert.equal(await dockUp(page), false, 'the dock has not painted yet');
    assert.ok(hold.count() > 0, 'the record reads are held');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !dock);
    await hold.release();
    await page.waitForLoadState('networkidle');
    assert.deepEqual(await thrown(page), [], 'the released read threw');
    assert.equal(await routeError(page), null, 'the released read must not paint the route error card');
    assert.equal(await dockUp(page), false, 'the dock stays closed');
    assert.equal(await page.locator('#dock .dock-entity').count(), 0, 'no editor is built for the closed row');
    assert.equal(await page.evaluate(() => !!dock), false, 'no dock state is restored');
    assert.ok(await gridRows(page) > 0, 'the table is still on screen');
    await page.close();
  });

  test('a record opened while an older record read is held keeps the dock, and the older read never repaints it (Issue #1444)', async () => {
    const page = await newPage();
    const hold = await holdReadsOf(page, alpha.id);
    await gridUp(page);
    await openWithoutHeldRow(page);
    await page.click(`#main tr[data-eid="${beta.id}"] .open-link`);
    await page.waitForFunction((id) => document.querySelector('#dock')?.dataset.eid === id, beta.id);
    assert.equal(await dockName(page), 'Beta', 'the newer record opens while the older read is held');
    assert.ok(hold.count() > 0, 'the older record read is still held');
    await hold.release();
    await page.waitForLoadState('networkidle');
    assert.deepEqual(await thrown(page), [], 'the released read threw');
    assert.equal(await dockEid(page), beta.id, 'the older read must not take the dock');
    assert.equal(await dockName(page), 'Beta');
    assert.match(await page.evaluate(() => location.hash), new RegExp(`\\?e=${beta.id}$`));
    assert.equal(await page.locator(`#main tr[data-eid="${beta.id}"].row-docked`).count(), 1, 'the docked row marker stays on the newer record');
    await page.close();
  });

  test('an older record read that fails never closes the dock the newer record owns (Issue #1444)', async () => {
    const page = await newPage();
    const hold = await holdReadsOf(page, alpha.id);
    await gridUp(page);
    await openWithoutHeldRow(page);
    await page.click(`#main tr[data-eid="${beta.id}"] .open-link`);
    await page.waitForFunction((id) => document.querySelector('#dock')?.dataset.eid === id, beta.id);
    await hold.fail();
    await page.waitForLoadState('networkidle');
    assert.equal(await dockUp(page), true, 'the dock the newer record owns stays open');
    assert.equal(await dockEid(page), beta.id);
    assert.equal(await page.locator('#wv-toasts .toast').count(), 0, 'the old failure paints no error over the newer record');
    await page.close();
  });

  test('a record route that answers after the hash moved on does not paint over the newer route (Issue #1444)', async () => {
    const page = await newPage();
    const hold = await holdReadsOf(page, alpha.id);
    await page.goto(`${base}/#/entity/${alpha.id}`, { waitUntil: 'commit' });
    await hold.first();
    assert.ok(hold.count() > 0, 'the record read is held');
    await page.evaluate((h) => { location.hash = h; }, `#/table/${tasks.id}`);
    await page.waitForSelector(`#main tr[data-eid="${beta.id}"]`);
    await hold.release();
    await page.waitForLoadState('networkidle');
    assert.equal(await page.evaluate(() => location.hash), `#/table/${tasks.id}`);
    assert.ok(await gridRows(page) > 0, 'the held record read painted over the newer table route');
    assert.equal(await page.locator('#main .entity-values').count(), 0, 'no record page is left under the table route');
    await page.close();
  });

  test('on a phone, stepping back in the dock keeps it on the record the step chose (Issue #1444)', async () => {
    const page = await collectThrown(await phonePage(await phoneBrowser(), { colorScheme: 'light' }));
    const hold = await holdReadsOf(page, ana.id, ['/references', '/references-from']);
    await page.goto(`${base}/#/`, { waitUntil: 'networkidle' });
    await page.evaluate((id) => { location.hash = `#/table/${id}`; }, tasks.id);
    await page.waitForSelector(`#main tr[data-eid="${alpha.id}"] .list-name`);
    const box = await page.locator(`#main tr[data-eid="${alpha.id}"] .list-name`).boundingBox();
    await page.mouse.click(box.x + 20, box.y + 8);
    await page.waitForFunction((id) => document.querySelector('#dock')?.dataset.eid === id, alpha.id);
    await page.click(`#dock a[href="#/entity/${ana.id}"]`);
    await hold.first();
    assert.equal(await dockEid(page), alpha.id, 'the related record has not painted yet');
    await page.keyboard.press('Escape');
    await page.waitForFunction((id) => !!dock && dock.state.chain[dock.state.chain.length - 1]?.id === id, alpha.id);
    await hold.release();
    await page.waitForLoadState('networkidle');
    assert.deepEqual(await thrown(page), [], 'the released read threw');
    assert.equal(await dockEid(page), alpha.id, 'the step back owns the dock, not the read it left behind');
    assert.equal(await dockName(page), 'Alpha');
    assert.equal(await routeError(page), null, 'the released read must not paint the route error card');
    await page.close();
  });
}
