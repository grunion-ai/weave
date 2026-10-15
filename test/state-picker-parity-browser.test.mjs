import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, painted } from './lib/browser.mjs';

const s = await launch('one state picker everywhere', (weave) => {
  weave.createSpace({ name: 'Dev' });
  const task = weave.createTable({ space: 'Dev', name: 'Task' });
  weave.addField('Task', {
    name: 'Stage',
    type: 'workflow',
    config: {
      states: [
        { name: 'Backlog', category: 'not-started' },
        { name: 'Building', category: 'in-progress' },
        { name: 'Shipped', category: 'done' },
        { name: 'Dropped', category: 'canceled' },
      ],
    },
  });
  const target = weave.createEntity('Task', { name: 'Ship the editor', Stage: 'Building' });
  weave.updateField(task.id, 'Chip', { config: { state: true } });
  const holder = weave.createTable({ space: 'Dev', name: 'Release' });
  weave.addRelation(holder.id, { name: 'Ships', targetDb: task.id, cardinality: 'many-to-many' });
  const release = weave.createEntity('Release', { name: 'v0.5' });
  weave.link(release.id, 'Ships', [target.id]);
  return { task, holder, target };
});

if (s) {
  const { base, browser, task, holder, target } = s;

  const shape = (page) => page.evaluate(() => ({
    rows: [...document.querySelectorAll('.picker-pop .picker-row')].map((r) => ({
      num: r.querySelector('.picker-num')?.textContent ?? '',
      label: r.querySelector('.picker-label, .k')?.textContent.trim() ?? '',
      current: !!r.querySelector('.chip-pop-check'),
    })),
    dividers: [...document.querySelectorAll('.picker-pop .picker-divider')].map((d) => d.textContent.trim()),
    grids: document.querySelectorAll('.picker-pop .picker-cells').length,
  }));

  const openAt = async (url, open) => {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await open(page);
    await painted(page, '.picker-pop .picker-row');
    const got = await shape(page);
    await page.close();
    return got;
  };

  test('the Stage picker draws the same numbered rows and category dividers in a table cell, on the record page and on a chip (Issue #796)', async () => {
    const cell = await openAt(`${base}/#/table/${task.id}`, async (page) => {
      await painted(page, `tr[data-eid="${target.id}"] td[data-field="Stage"] .chip-trigger`);
      await page.click(`tr[data-eid="${target.id}"] td[data-field="Stage"] .chip-trigger`);
    });

    assert.deepEqual(cell.dividers, ['Not started', 'In progress', 'Done', 'Canceled'],
      'the four categories are thin dividers, in the engine’s order');
    assert.deepEqual(cell.rows.map((r) => [r.num, r.label]), [
      ['1', '—'], ['2', 'Backlog'], ['3', 'Building'], ['4', 'Shipped'], ['5', 'Dropped'],
    ], 'every row is numbered and the dividers never shift a number');
    assert.deepEqual(cell.rows.filter((r) => r.current).map((r) => r.label), ['Building'],
      'the current state carries the check');
    assert.equal(cell.grids, 0, 'no option grid anywhere');

    const record = await openAt(`${base}/#/entity/${target.id}`, async (page) => {
      await painted(page, '.entity-fields .fieldrow');
      await page.evaluate(() => [...document.querySelectorAll('.entity-fields .fieldrow')]
        .find((r) => r.querySelector('.fieldrow-label')?.textContent.trim() === 'Stage')
        .querySelector('.chip-trigger').click());
    });
    assert.deepEqual(record, cell, 'the record page opens the very same picker');

    const chip = await openAt(`${base}/#/table/${holder.id}`, async (page) => {
      await painted(page, `.k-rel[data-eid="${target.id}"] [data-seg="state"]`);
      await page.click(`.k-rel[data-eid="${target.id}"] [data-seg="state"]`);
    });
    assert.deepEqual(chip, cell, 'and so does the state mark on the chip');
  });
}
