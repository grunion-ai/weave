import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, settled } from './lib/browser.mjs';

const MANY = Array.from({ length: 12 }, (_, i) => `Area ${i + 1}`);

const s = await launch('phone picker sheets', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.addField(issues, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'In Progress', category: 'in-progress' },
    { name: 'Fixed', category: 'done' }] } });
  weave.addField(issues, { name: 'Area', type: 'select', config: { options: MANY } });
  const row = weave.createEntity(issues, { name: 'Looks broken', values: { Status: 'Open', Area: 'Area 1' } });
  return { docked: `#/table/${issues.id}?e=${row.id}` };
});

if (s) {
  const { base, browser, docked } = s;
  const open = async ({ width = 390, theme = 'light' } = {}) => {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${docked}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#dock:not([hidden]) .chip-trigger[title="Status"]');
    return page;
  };
  const pop = async (page) => { await settled(page.locator('.picker-pop')); return page.evaluate(() => {
    const p = document.querySelector('.picker-pop');
    const r = p.getBoundingClientRect();
    const input = p.querySelector('.picker-search');
    return {
      theme: document.documentElement.dataset.bsTheme,
      left: r.left, right: r.right, bottom: Math.round(r.bottom), top: r.top,
      rows: [...p.querySelectorAll('.picker-row')].map((n) => Math.round(n.getBoundingClientRect().height)),
      typing: document.activeElement === input,
      boxShown: !!input && input.getClientRects().length > 0,
      vh: innerHeight,
    };
  }); };

  for (const theme of ['light', 'dark']) {
    test(`on a phone a short picker opens as a bottom sheet of 56px options without the keyboard (${theme}, Feature #274)`, async () => {
      const page = await open({ theme });
      try {
        await page.click('#dock .chip-trigger[title="Status"]');
        await page.waitForSelector('.picker-pop .picker-row');
        const p = await pop(page);
        assert.equal(p.theme, theme);
        assert.deepEqual([p.left, p.right, p.bottom], [0, 390, p.vh], 'the sheet spans the bottom of the screen');
        assert.ok(p.rows.length >= 3 && p.rows.every((h) => h >= 56), `every option is 56px: ${p.rows}`);
        assert.equal(p.typing, false, 'the text box does not take focus, so no keyboard');
        assert.equal(p.boxShown, false, 'and a short list shows no text box');
        await page.click('.picker-pop .picker-row:has-text("In Progress")');
        await page.waitForSelector('.picker-pop', { state: 'detached' });
        await page.waitForFunction(() => document.querySelector('#dock .chip-trigger[title="Status"]')?.textContent.includes('In Progress'));
      } finally { await page.close(); }
    });
  }

  test('on a phone a long picker keeps its search box and focuses it (Feature #274)', async () => {
    const page = await open();
    try {
      await page.click('#dock .chip-trigger[title="Area"]');
      await page.waitForSelector('.picker-pop .picker-row');
      const p = await pop(page);
      assert.deepEqual([p.left, p.right, p.bottom], [0, 390, p.vh], 'it is a bottom sheet too');
      assert.ok(p.typing && p.boxShown, 'with the search box focused for 12 options');
      assert.ok(p.top >= 60, `the sheet leaves the top of the screen clear (${p.top})`);
    } finally { await page.close(); }
  });

  test('on a desktop the picker stays anchored to its chip with the search box focused (Feature #274)', async () => {
    const page = await open({ width: 1280 });
    try {
      await page.click('#dock .chip-trigger[title="Status"]');
      await page.waitForSelector('.picker-pop .picker-row');
      const p = await pop(page);
      assert.ok(p.left > 0 && p.right - p.left < 600, `the picker is a popover (${p.left}..${p.right})`);
      assert.ok(p.rows.every((h) => h < 40), `rows keep their desktop height: ${p.rows}`);
      assert.ok(p.typing, 'the search box is focused');
    } finally { await page.close(); }
  });
}
