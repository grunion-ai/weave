import test from 'node:test';
import assert from 'node:assert/strict';
import { eachPhone, eventually, launch, phoneMatrix } from './lib/browser.mjs';

let tasks, task, project, projectField;

const s = await launch('relation unlink undo', (weave) => {
  weave.createSpace({ name: 'Product' });
  const projects = weave.createTable({ space: 'Product', name: 'Project' });
  weave.addField(projects, { name: 'Budget', type: 'number', config: { format: 'currency', currency: 'USD' } });
  tasks = weave.createTable({ space: 'Product', name: 'Task' });
  projectField = weave.addRelation(tasks, { name: 'Project', targetDb: projects, cardinality: 'many-to-one', inverseName: 'Tasks' }).field;
  project = weave.createEntity(projects, { name: 'Atlas rebuild', values: { Budget: 48000 } });
  task = weave.createEntity(tasks, { name: 'Draft the schema' });
  weave.link(task.id, 'Project', [project.id]);
});

if (s) {
  const { base, browser, weave } = s;
  const CHIP = '#main .fieldrow[data-field="Project"] .k-rel';
  const linked = () => {
    const v = weave.getEntity(task.id).values[projectField.id];
    return Array.isArray(v) ? v[0] ?? null : v ?? null;
  };
  const open = async (id, { colorScheme = 'light' } = {}) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'load' });
    return page;
  };
  const undoToast = (page) => page.locator('#wv-toasts .wv-toast-action', { hasText: 'Undo' }).first();

  for (const colorScheme of ['light', 'dark']) {
    test(`the relation chip x unlinks behind an Undo toast that puts the link back (${colorScheme}, Issue #1404)`, async () => {
      const page = await open(task.id, { colorScheme });
      try {
        await page.waitForSelector(`${CHIP} > .x`);
        await page.click(`${CHIP} > .x`);
        await undoToast(page).waitFor();
        assert.equal(await eventually(linked, null), null, 'the chip x unlinked the project');
        await undoToast(page).click();
        assert.equal(await eventually(linked, project.id), project.id, 'Undo put the link back');
      } finally {
        await page.close();
      }
    });
  }

  test('the related grid unlink button unlinks behind an Undo toast that puts the link back (Issue #1404)', async () => {
    const page = await open(project.id);
    const row = `.related-section [data-eid="${task.id}"] .unlink-btn`;
    try {
      await page.waitForSelector(row);
      await page.locator(row).click();
      await undoToast(page).waitFor();
      assert.equal(await eventually(linked, null), null, 'the related grid unlinked the task');
      await undoToast(page).click();
      assert.equal(await eventually(linked, project.id), project.id, 'Undo put the link back');
    } finally {
      await page.close();
    }
  });

  test('a phone record page keeps the remove x out of the relation chip and still offers the link picker (Issue #1404)', async (t) => {
    await eachPhone(t, await phoneMatrix(browser), async (page) => {
      await page.goto(`${base}/#/entity/${task.id}`, { waitUntil: 'load' });
      await page.waitForSelector('.fieldrow[data-field="Project"] .k-rel');
      if (!(await page.evaluate(() => matchMedia('(max-width: 600px)').matches))) return 'wider than a phone sheet';
      const v = await page.evaluate(() => {
        const row = document.querySelector('.fieldrow[data-field="Project"]');
        return {
          removes: row.querySelectorAll('.k-rel > .x').length,
          buttons: [...row.querySelectorAll('button')].map((b) => (b.textContent || b.title || b.className).trim()),
        };
      });
      assert.equal(v.removes, 0, `the chip still carries a remove x (buttons: ${v.buttons.join(', ')})`);
      assert.ok(v.buttons.some((label) => /link/i.test(label)), `the field row offers no way to change the link (buttons: ${v.buttons.join(', ')})`);
    });
  });
}
