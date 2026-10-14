import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let jobs;
const s = await launch('filter chips are the baseline chip', (weave) => {
  weave.createSpace({ name: 'Ops' });
  jobs = weave.createTable({ space: 'Ops', name: 'Job' });
  weave.addField(jobs, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'Doing', category: 'in-progress' },
    { name: 'Done', category: 'done' }] } });
  for (const [name, Status] of [['A', 'Open'], ['B', 'Doing'], ['C', 'Done']]) {
    weave.createEntity(jobs, { name, values: { Status } });
  }
});

const SHAPE = ['borderTopWidth', 'borderTopLeftRadius', 'fontSize', 'fontWeight', 'paddingLeft'];

const readShape = (page, label) => page.evaluate(({ label, props }) => {
  const text = (n) => n.textContent.trim();
  const cell = [...document.querySelectorAll('.wv-grid tbody .k-state')].find((k) => text(k) === label);
  const filter = [...document.querySelectorAll('.table-filter-popover .filter-chip')].find((k) => text(k) === label);
  const pick = (n) => n && Object.fromEntries(props.map((p) => [p, getComputedStyle(n).getPropertyValue(p.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`))]));
  return { cell: pick(cell), filter: pick(filter), filterIsChip: !!filter?.classList.contains('k') };
}, { label, props: SHAPE });

if (s) {
  const { base, browser } = s;

  for (const theme of ['light', 'dark']) {
    test(`a filter chip and the cell chip for the same option are one chip build in ${theme}`, async () => {
      const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      try {
        await page.goto(`${base}/#/table/${jobs.id}`, { waitUntil: 'networkidle' });
        await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
        await page.waitForSelector('.wv-grid tbody tr.entity-row');
        await page.click('.table-filter-btn');
        await page.waitForSelector('.table-filter-popover .filter-chip');
        const seen = await readShape(page, 'Done');
        assert.ok(seen.cell, 'the grid draws a state chip for Done');
        assert.ok(seen.filter, 'the filter popover draws a value for Done');
        assert.equal(seen.filterIsChip, true, 'the filter value is the baseline .k chip, not a second build');
        assert.deepEqual(seen.filter, seen.cell, 'border, radius, size and padding match the cell chip');
      } finally {
        await page.close();
      }
    });
  }

  test('a picked filter chip wears the shared selected ring token', async () => {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${jobs.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      await page.click('.table-filter-btn');
      await page.waitForSelector('.table-filter-popover .filter-chip');
      const token = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--wv-chip-selected-ring').trim());
      assert.notEqual(token, '', 'a shared --wv-chip-selected-ring token exists');
      await page.evaluate(() => [...document.querySelectorAll('.table-filter-popover .filter-chip')]
        .find((k) => k.textContent.trim() === 'Done').click());
      await page.waitForSelector('.table-filter-popover .filter-chip.on');
      const ring = await page.locator('.table-filter-popover .filter-chip.on').first().evaluate((n) => {
        const cs = getComputedStyle(n);
        return { shadow: cs.boxShadow, weight: cs.fontWeight };
      });
      assert.notEqual(ring.shadow, 'none', 'the picked chip draws the shared ring');
      assert.equal(ring.weight, '400', 'the ruling keeps the picked chip at weight 400');
    } finally {
      await page.close();
    }
  });
}
