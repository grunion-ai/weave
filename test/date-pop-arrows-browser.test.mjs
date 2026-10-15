import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, painted } from './lib/browser.mjs';

let sprints;
const s = await launch('date pop arrows', (weave) => {
  weave.createSpace({ name: 'Product' });
  sprints = weave.createTable({ space: 'Product', name: 'Sprint' });
  weave.addField(sprints, { name: 'Due', type: 'date', config: { format: 'iso' } });
  weave.addField(sprints, { name: 'Window', type: 'daterange', config: { format: 'iso' } });
});

if (s) {
  const { base, browser, weave } = s;
  const fresh = () => weave.createEntity(sprints, { name: 'Arrow case', values: { Due: '2026-09-15', Window: { start: '2026-09-01', end: '2026-09-12' } } }).id;
  const open = async (id, field, colorScheme = 'light') => {
    const page = await browser.newPage({ colorScheme, viewport: { width: 1200, height: 900 } });
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), colorScheme);
    await painted(page, '.entity-fields .fieldrow .date-pick-btn');
    await page.locator('.entity-fields .fieldrow', { hasText: field }).first().locator('.date-pick-btn').click();
    await painted(page, '.date-pop .date-pop-head');
    return page;
  };
  const head = (page) => page.evaluate(() => {
    const h = document.querySelector('.date-pop .date-pop-head');
    return {
      titles: [...h.querySelectorAll('.date-pop-title')].map((b) => b.textContent.trim()),
      arrows: [...h.querySelectorAll('.date-pop-arrow')].map((b) => ({ text: b.textContent.trim(), label: b.getAttribute('aria-label') })),
    };
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`the day view steps months with ‹ and ›, and › from September 2026 shows October 2026 (Issue #801, ${colorScheme})`, async () => {
      const page = await open(fresh(), 'Due', colorScheme);
      try {
        assert.equal((await page.locator('.date-pop .picker-title').textContent()).trim(), 'Due', 'the date picker names its field');
        const before = await head(page);
        assert.deepEqual(before.titles, ['September', '2026'], 'the month and year dropdowns stay');
        assert.deepEqual(before.arrows, [{ text: '‹', label: 'Previous month' }, { text: '›', label: 'Next month' }]);
        await page.locator('.date-pop .date-pop-arrow[aria-label="Next month"]').click();
        assert.deepEqual((await head(page)).titles, ['October', '2026']);
        await page.locator('.date-pop .date-pop-arrow[aria-label="Previous month"]').click();
        assert.deepEqual((await head(page)).titles, ['September', '2026']);
        assert.deepEqual(await page.locator('.date-pop .date-pop-foot .date-pop-link').allTextContents(), ['Clear', 'Today']);
        assert.equal(await page.locator('.date-pop .date-smart').count(), 1, 'the smart input stays');

        await page.locator('.date-pop .date-pop-title', { hasText: 'September' }).click();
        assert.deepEqual((await head(page)).arrows.map((a) => a.text), ['‹', '›'], 'the month view steps years with the same glyphs');
        await page.locator('.date-pop .date-pop-arrow').last().click();
        assert.deepEqual((await head(page)).titles, ['2027']);

        await page.locator('.date-pop .date-pop-title', { hasText: '2027' }).click();
        assert.deepEqual((await head(page)).titles, ['September', '2027'], 'the year title returns to the days');
        await page.locator('.date-pop .date-pop-title', { hasText: '2027' }).click();
        assert.deepEqual((await head(page)).arrows.map((a) => a.text), ['‹', '›'], 'the year view steps decades with the same glyphs');
      } finally { await page.close(); }
    });
  }

  test('the range picker keeps Today and Clear and names its field (Issue #801)', async () => {
    const page = await open(fresh(), 'Window');
    try {
      assert.equal((await page.locator('.date-pop.range .picker-title').textContent()).trim(), 'Window');
      assert.deepEqual((await head(page)).arrows.map((a) => a.text), ['‹', '›']);
      assert.deepEqual(await page.locator('.date-pop.range .date-pop-foot .date-pop-link').allTextContents(), ['Clear', 'Today']);
    } finally { await page.close(); }
  });
}
