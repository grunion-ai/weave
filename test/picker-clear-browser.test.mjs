import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, painted, eventually } from './lib/browser.mjs';

const s = await launch('a picker of real values only', (weave) => {
  weave.createSpace({ name: 'Dev' });
  const task = weave.createTable({ space: 'Dev', name: 'Task' });
  weave.addField('Task', { name: 'Priority', type: 'select', config: { options: ['Low', 'Medium', 'High'] } });
  weave.addField('Task', {
    name: 'Stage', type: 'workflow',
    config: { states: [{ name: 'Backlog', category: 'not-started' }, { name: 'Building', category: 'in-progress' }, { name: 'Shipped', category: 'done' }] },
  });
  return { task };
});

if (s) {
  const { base, browser, weave, task } = s;

  const freshRow = (values) => weave.createEntity('Task', { name: 'Ship it', ...values }).id;
  const openCell = async (page, id, field) => {
    await page.goto(`${base}/#/table/${task.id}`, { waitUntil: 'networkidle' });
    const sel = `tr[data-eid="${id}"] td[data-field="${field}"] .chip-trigger`;
    await painted(page, sel);
    await page.locator(sel).click();
    await painted(page, '.picker-pop .picker-row');
  };
  const rows = (page) => page.$$eval('.picker-pop .picker-row', (ns) => ns.map((n) => ({
    num: n.querySelector('.picker-num')?.textContent ?? '',
    label: n.querySelector('.k, .picker-label')?.textContent.trim() ?? '',
    title: n.getAttribute('title'),
  })));

  test('a select lists its real options only, so Option+1 is the first one anyone wants (Issue #797)', async () => {
    const page = await browser.newPage();
    try {
      const id = freshRow({ Priority: 'Medium' });
      await openCell(page, id, 'Priority');
      assert.deepEqual(await rows(page), [
        { num: '1', label: 'Low', title: 'Option+1' },
        { num: '2', label: 'Medium', title: 'Option+2' },
        { num: '3', label: 'High', title: 'Option+3' },
      ], 'no empty row at the top, and the key hint is spelled out rather than left as a glyph');
      await page.keyboard.press('Alt+Digit1');
      await eventually(() => Promise.resolve(weave.readEntity(id).fields.Priority), 'Low');
    } finally { await page.close(); }
  });

  test('a workflow field lists its real states only (Issue #797)', async () => {
    const page = await browser.newPage();
    try {
      await openCell(page, freshRow({ Stage: 'Building' }), 'Stage');
      const drawn = await rows(page);
      assert.deepEqual(drawn.map((r) => [r.num, r.label]), [['1', 'Backlog'], ['2', 'Building'], ['3', 'Shipped']],
        'no "No state" row and no empty row: Option+1 is the first real state');
      assert.deepEqual(await page.$$eval('.picker-pop .picker-divider', (ns) => ns.map((n) => n.textContent.trim())),
        ['Not started', 'In progress', 'Done'], 'the Issue #796 dividers stay, and None is not one of them');
    } finally { await page.close(); }
  });

  test('backspace on an empty search clears the cell, and the picker says so (Issue #797)', async () => {
    const page = await browser.newPage();
    try {
      const id = freshRow({ Priority: 'Medium' });
      await openCell(page, id, 'Priority');
      assert.match(await page.locator('.picker-pop .picker-foot').textContent(), /⌫\s*clear/,
        'a single picker holding a value names the key that empties it');
      assert.equal(await page.locator('.picker-pop .picker-chip').textContent(), 'Medium', 'the value sits in the box as a chip');
      await page.keyboard.press('Backspace');
      await eventually(() => Promise.resolve(weave.readEntity(id).fields.Priority ?? '(unset)'), '(unset)');
      await painted(page, '.picker-pop', { state: 'detached' });
    } finally { await page.close(); }
  });

  test('the chip’s clear control empties a workflow cell, with no row for it in the list (Issue #797)', async () => {
    const page = await browser.newPage();
    try {
      const id = freshRow({ Stage: 'Building' });
      await openCell(page, id, 'Stage');
      await page.locator('.picker-pop .picker-chip > span.x').click();
      await eventually(() => Promise.resolve(weave.readEntity(id).fields.Stage ?? '(unset)'), '(unset)');
    } finally { await page.close(); }
  });

  test('a picker with nothing set shows no clear hint (Issue #797)', async () => {
    const page = await browser.newPage();
    try {
      await openCell(page, freshRow({}), 'Priority');
      assert.equal(await page.locator('.picker-pop .picker-foot:visible').count(), 0,
        'there is nothing to clear, so the footer stays out of the way');
    } finally { await page.close(); }
  });
}
