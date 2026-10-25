import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { openPane } from './lib/view-pane.mjs';

let jobs;
const s = await launch('one selected ring', (weave) => {
  weave.createSpace({ name: 'Ops' });
  jobs = weave.createTable({ space: 'Ops', name: 'Job' });
  weave.addField(jobs, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'Done', category: 'done' }] } });
  weave.addField(jobs, { name: 'Tags', type: 'multiselect', config: { options: ['bug', 'chore'] } });
  for (const name of ['A', 'B']) weave.createEntity(jobs, { name });
});

const ringOf = (page, sel) => page.evaluate((q) => {
  const n = document.querySelector(q);
  const cs = getComputedStyle(n);
  return { shadow: cs.boxShadow, outline: cs.outlineStyle };
}, sel);

if (s) {
  const { base, browser, weave } = s;

  for (const theme of ['light', 'dark']) {
    test(`a picked option wears one selected ring, in a picker and in a filter (${theme})`, async () => {
      const table = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      const entity = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      try {
        await table.goto(`${base}/#/table/${jobs.id}`, { waitUntil: 'networkidle' });
        await table.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
        await table.waitForSelector('.wv-grid tbody tr.entity-row');
        const token = await table.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--wv-chip-selected-ring').trim());
        assert.notEqual(token, '', 'the shared ring token from Issue #769 is there to read');
        await openPane(table, 'filters');
        await table.waitForSelector('#view-pane .filter-chip');
        await table.evaluate(() => [...document.querySelectorAll('#view-pane .filter-chip')]
          .find((k) => k.textContent.trim() === 'Done').click());
        await table.waitForSelector('#view-pane .filter-chip.on');
        const filter = await ringOf(table, '#view-pane .filter-chip.on');

        const id = weave.createEntity(jobs, { name: 'Ring case' }).id;
        await entity.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
        await entity.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
        await entity.locator('.entity-fields .fieldrow', { hasText: 'Tags' }).first().locator('.ms-box').click();
        await entity.locator('.chip-pop .picker-row', { hasText: 'bug' }).click();
        await entity.waitForSelector('.chip-pop .picker-chip');
        await entity.locator('.chip-pop .picker-chip').first().click();
        await entity.waitForSelector('.chip-pop .picker-chip.sel');
        const picker = await ringOf(entity, '.chip-pop .picker-chip.sel');

        assert.notEqual(filter.shadow, 'none', 'the picked filter value draws the ring');
        assert.deepEqual(picker, filter, 'the picker shows selection the same way the filter does');
        assert.notEqual(picker.outline, 'solid', 'and the picker drops its own 2px primary outline for the shared ring');
      } finally {
        weave.updateTable(jobs, { filters: {} });
        await table.close();
        await entity.close();
      }
    });
  }
}
