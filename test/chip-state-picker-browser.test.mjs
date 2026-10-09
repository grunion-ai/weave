import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, painted, eventually } from './lib/browser.mjs';

const s = await launch('the chip state picker', (weave) => {
  weave.createSpace({ name: 'Dev' });
  const task = weave.createTable({ space: 'Dev', name: 'Task' });
  weave.addField('Task', {
    name: 'State',
    type: 'workflow',
    config: {
      states: [
        { name: 'Backlog', category: 'not-started' },
        { name: 'Triage', category: 'not-started' },
        { name: 'In progress', category: 'in-progress' },
        { name: 'Shipped', category: 'done' },
        { name: 'Dropped', category: 'canceled' },
      ],
    },
  });
  weave.addField('Task', { name: 'Areas', type: 'multiselect', config: { options: ['Engine', 'Editor', 'Grid'] } });
  const target = weave.createEntity('Task', { name: 'Ship the editor', State: 'Backlog', Areas: ['Engine'] });
  weave.updateField(task.id, 'Chip', { config: { state: true, fields: ['Areas'] } });
  const holder = weave.createTable({ space: 'Dev', name: 'Release' });
  weave.addRelation(holder.id, { name: 'Ships', targetDb: task.id, cardinality: 'many-to-many' });
  const release = weave.createEntity('Release', { name: 'v0.5' });
  weave.link(release.id, 'Ships', [target.id]);
  return { task, holder, target };
});

if (s) {
  const { base, browser, weave, holder, target } = s;

  const openCell = async (page) => {
    await page.goto(`${base}/#/table/${holder.id}`, { waitUntil: 'networkidle' });
    await painted(page, `.k-rel[data-eid="${target.id}"] [data-seg="state"]`);
  };

  test('the state mark in a relation cell opens a picker grouped by category and writes the row', async () => {
    const page = await browser.newPage();
    try {
      await openCell(page);
      const mark = page.locator(`.k-rel[data-eid="${target.id}"] [data-seg="state"]`);
      assert.equal(await mark.textContent(), 'Backlog', 'the mark is the real state chip, named');
      assert.match(await mark.getAttribute('class'), /\bk k-state cat-not-started\b/);

      await mark.click();
      await painted(page, '.chip-pop .picker-cat');
      const groups = await page.$$eval('.chip-pop .picker-cat', (ns) => ns.map((n) => n.textContent));
      assert.deepEqual(groups, ['None', 'Not started', 'In progress', 'Done', 'Canceled'],
        'every category is a heading, in the engine’s order');
      const rows = await page.$$eval('.chip-pop .picker-term', (ns) => ns.map((n) => n.textContent));
      assert.deepEqual(rows, ['No state', 'Backlog', 'Triage', 'In progress', 'Shipped', 'Dropped'],
        'the named states sit under their heading');
      assert.ok(await page.$eval('.chip-pop .picker-term .k.k-state', (n) => n.classList.contains('cat-not-started')),
        'a picker row wears the state chip it will set');

      await page.locator('.chip-pop .picker-term', { hasText: 'Shipped' }).first().click();
      await eventually(() => Promise.resolve(weave.readEntity(target.id).fields.State), 'Shipped');
      await eventually(() => mark.getAttribute('class').then((c) => /cat-done/.test(c)), true);
      assert.equal(await mark.textContent(), 'Shipped', 'the mark repaints without a reload');
    } finally { await page.close(); }
  });

  test('the name navigates and the mark does not', async () => {
    const page = await browser.newPage();
    try {
      await openCell(page);
      await page.locator(`.k-rel[data-eid="${target.id}"] [data-seg="state"]`).click();
      await painted(page, '.chip-pop .picker-cat');
      assert.match(page.url(), /#\/table\//, 'the mark is the one pixel inside the chip that does not navigate');
      await page.keyboard.press('Escape');

      await page.locator(`.k-rel[data-eid="${target.id}"] > a.mention`).click();
      await page.waitForFunction((id) => location.hash.includes(id) || !!document.querySelector('#dock:not([hidden])'), target.id);
    } finally { await page.close(); }
  });

}
