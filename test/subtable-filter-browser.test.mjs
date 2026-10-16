import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually } from './lib/browser.mjs';

let projectDb, apollo, zeus;
const s = await launch('subtable filters', (weave) => {
  weave.createSpace({ name: 'Work' });
  projectDb = weave.createTable({ space: 'Work', name: 'Project' });
  weave.createTable({ space: 'Work', name: 'Task' });
  weave.addField('Task', {
    name: 'State', type: 'workflow',
    config: { states: [{ name: 'Todo', category: 'not-started', default: true }, { name: 'Doing', category: 'in-progress' }, { name: 'Done', category: 'done' }] },
  });
  weave.addField('Task', { name: 'Notes', type: 'text' });
  weave.addRelation(projectDb, { name: 'Tasks', targetDb: 'Task', cardinality: 'one-to-many', inverseName: 'Project' });
  weave.updateTable('Task', { hiddenFields: ['Chip', 'Card'] });
  const seed = (project, done, todo, doing) => {
    const ids = [];
    const make = (state, n) => {
      for (let i = 0; i < n; i++) {
        const t = weave.createEntity('Task', { name: `${project.name} ${state} ${i + 1}`, values: { Notes: 'n' } });
        if (state !== 'Todo') weave.setState(t.id, 'State', state);
        ids.push(t.id);
      }
    };
    make('Done', done); make('Todo', todo); make('Doing', doing);
    weave.link(project.id, 'Tasks', ids);
  };
  apollo = weave.createEntity(projectDb, { name: 'Apollo' });
  zeus = weave.createEntity(projectDb, { name: 'Zeus' });
  seed(apollo, 48, 7, 5);
  seed(zeus, 1, 1, 1);
});

if (s) {
  const { base, browser, weave } = s;
  const tasksField = () => weave.getField(projectDb.id, 'Tasks');
  const reset = () => weave.updateField(projectDb.id, tasksField().id, { config: { subtable: null } });
  const open = async (id, colorScheme) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'load' });
    await page.waitForSelector('.related-section .related-count');
    return page;
  };
  const count = (page) => page.$eval('.related-section .related-count', (n) => n.textContent.trim()).catch(() => null);
  const rows = (page) => page.$$eval('.related-section tbody tr.entity-row', (trs) => trs.length);
  const heads = (page) => page.$$eval('.related-section thead th', (ths) => ths.map((t) => t.textContent.trim()).filter(Boolean));

  test('an unfiltered subtable shows every linked row and a bare count', async () => {
    reset();
    const page = await open(apollo.id, 'light');
    assert.equal(await count(page), '60');
    assert.equal(await rows(page), 60);
    assert.ok(await page.$('.related-section .related-head .eye-btn'), 'the subtable header carries the eye');
    await page.close();
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`the subtable eye filters every Project page to open tasks and reads shown / total (${colorScheme})`, async () => {
      reset();
      try {
        const page = await open(apollo.id, colorScheme);
        assert.equal(await page.$eval('html', (h) => h.dataset.bsTheme), colorScheme);
        await page.click('.related-section .related-head .eye-btn');
        const pop = page.locator('.subtable-popover');
        await pop.waitFor();
        const surface = await pop.evaluate((p) => getComputedStyle(p).backgroundColor);
        assert.notEqual(surface, 'rgba(0, 0, 0, 0)', `the popover paints a surface in ${colorScheme}`);
        await pop.locator('.filter-chip', { hasText: 'Todo' }).click();
        await pop.locator('.filter-chip', { hasText: 'Doing' }).click();
        assert.equal(await eventually(() => count(page), '12 / 60'), '12 / 60');
        assert.equal(await rows(page), 12, 'only the open tasks render');
        assert.deepEqual(tasksField().config.subtable.filter, [['State', 'in', ['Todo', 'Doing']]], 'the filter lands on the relation field config as where triples');

        await page.reload({ waitUntil: 'load' });
        await page.waitForSelector('.related-section .related-count');
        assert.equal(await count(page), '12 / 60', 'the filter survives a reload');

        await page.evaluate((pid) => {
          const db = allTables().find((d) => d.id === pid);
          editFieldDialog(db, db.fields.find((x) => x.name === 'Tasks'));
        }, projectDb.id);
        const shown = page.locator('.subtable-config');
        await shown.waitFor();
        assert.deepEqual(JSON.parse(await shown.textContent()).subtable.filter, [['State', 'in', ['Todo', 'Doing']]], 'the field dialog shows the relation config JSON');
        assert.notEqual(await shown.evaluate((n) => getComputedStyle(n).backgroundColor), 'rgba(0, 0, 0, 0)', `the config block paints in ${colorScheme}`);
        await page.keyboard.press('Escape');
        await shown.waitFor({ state: 'detached' });

        await page.goto(`${base}/#/entity/${zeus.id}`, { waitUntil: 'load' });
        assert.equal(await eventually(() => count(page), '2 / 3'), '2 / 3');
        assert.equal(await rows(page), 2, 'one edit narrows every Project page');

        const full = await (await fetch(`${base}/api/entities/${apollo.id}`)).json();
        assert.equal(full.fields.Tasks.length, 60, 'the API still returns the full relation');
        await page.close();
      } finally { reset(); }
    });
  }

  test('the subtable eye hides a field in every Project subtable', async () => {
    reset();
    try {
      const page = await open(apollo.id, 'light');
      await page.waitForSelector('.related-section thead');
      assert.ok((await heads(page)).includes('Notes'));
      await page.click('.related-section .related-head .eye-btn');
      const pop = page.locator('.subtable-popover');
      await pop.locator('.eye-row', { hasText: 'Notes' }).click();
      assert.equal(await eventually(async () => (await heads(page)).includes('Notes'), false), false, 'Notes leaves the subtable');
      assert.deepEqual(tasksField().config.subtable.fields, ['Name', 'State']);
      await page.close();
    } finally { reset(); }
  });
}
