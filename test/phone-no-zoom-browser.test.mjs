import test from 'node:test';
import assert from 'node:assert/strict';
import { engineOf, launch, phoneProfile } from './lib/browser.mjs';

const IPHONE = phoneProfile()?.page ?? null;

const AREAS = Array.from({ length: 12 }, (_, i) => `Area ${i + 1}`);

const s = await launch('phone text controls never zoom', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.addField(issues, { name: 'Status', type: 'workflow', config: { states: [
    { name: 'Open', category: 'not-started', default: true },
    { name: 'Fixed', category: 'done' }] } });
  weave.addField(issues, { name: 'Area', type: 'select', config: { options: AREAS } });
  weave.addField(issues, { name: 'Notes', type: 'text' });
  const row = weave.createEntity(issues, { name: 'Looks broken', values: { Status: 'Open', Area: 'Area 1', Notes: 'a note' } });
  weave.setDoc(row.id, 'A paragraph of the row document.');
  for (let i = 0; i < 4; i++) weave.createEntity(issues, { name: `Issue ${i}`, values: { Status: 'Open' } });
  return { table: `#/table/${issues.id}`, docked: `#/table/${issues.id}?e=${row.id}` };
});

const sweep = (page, where) => page.evaluate((where) => {
  const TEXT = 'input:not([type="checkbox"], [type="radio"], [type="range"], [type="color"], [type="file"], [type="hidden"], [type="button"], [type="submit"]), textarea, select, [contenteditable]:not([contenteditable="false"])';
  const was = document.activeElement;
  const shown = [...document.querySelectorAll(TEXT)].filter((n) => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden');
  const seen = shown.map((n) => ({ where, what: `${n.tagName.toLowerCase()}.${[...n.classList].join('.')}${n.getAttribute('aria-label') ? `[${n.getAttribute('aria-label')}]` : ''}`, px: parseFloat(getComputedStyle(n).fontSize) }));
  shown.forEach((n, i) => {
    if (!n.isConnected) return;
    n.focus({ preventScroll: true });
    if (document.activeElement === n) seen[i].focused = parseFloat(getComputedStyle(n).fontSize);
  });
  was?.focus?.({ preventScroll: true });
  return seen;
}, where);

if (s) {
  const { base, browser, table, docked } = s;
  const engines = [['chromium 390x844', browser, { viewport: { width: 390, height: 844 } }]];
  const webkit = await engineOf('webkit');
  if (webkit && IPHONE) engines.push(['webkit iPhone 15', webkit, IPHONE]);
  const open = async (b, { profile = { viewport: { width: 1280, height: 844 } }, theme = 'light', at = table } = {}) => {
    const page = await b.newPage(profile);
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${at}`, { waitUntil: 'networkidle' });
    return page;
  };

  for (const [engine, b, profile] of engines) {
    for (const theme of ['light', 'dark']) {
      test(`on a phone every text control computes 16px or more, so iOS never zooms on focus (${engine}, ${theme}, Issue #724)`, async () => {
        const seen = [];
        let page = await open(b, { profile, theme });
        try {
          assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
          assert.match(await page.$eval('meta[name="viewport"]', (m) => m.content), /maximum-scale=1/, 'the viewport tag forbids the focus zoom');
          await page.waitForSelector('#main .table-tools-btn');
          await page.click('#main .table-tools-btn');
          seen.push(...await sweep(page, 'table sheet'));
          await page.click('#main .crumb-actions .table-view-btn');
          await page.waitForSelector('.table-view-popover .view-add');
          await page.click('.table-view-popover .view-add');
          await page.waitForSelector('.table-view-popover .view-name-input');
          seen.push(...await sweep(page, 'view popover'));
        } finally { await page.close(); }
        page = await open(b, { profile, theme });
        try {
          await page.click('.bug-fab');
          await page.waitForSelector('#bug-panel .bug-note');
          seen.push(...await sweep(page, 'bug panel'));
          await page.keyboard.press('Escape');
          await page.click('.phone-search');
          await page.waitForSelector('#cmdk-input');
          seen.push(...await sweep(page, 'search'));
        } finally { await page.close(); }
        page = await open(b, { profile, theme, at: docked });
        try {
          await page.waitForSelector('#dock:not([hidden]) .chip-trigger[title="Area"]');
          seen.push(...await sweep(page, 'row'));
          await page.click('#dock .chip-trigger[title="Area"]');
          await page.waitForSelector('.picker-pop .picker-search');
          seen.push(...await sweep(page, 'picker'));
        } finally { await page.close(); }
        const where = new Set(seen.map((c) => c.where));
        for (const w of ['table sheet', 'view popover', 'bug panel', 'search', 'row', 'picker']) assert.ok(where.has(w), `the sweep reached the ${w}: ${[...where]}`);
        const names = seen.map((c) => c.what).join(' ');
        for (const want of ['bug-note', 'picker-search', 'view-name-input', 'textarea.name-edit', 'vditor-reset']) assert.ok(names.includes(want), `the sweep focused a ${want}: ${names}`);
        const small = seen.filter((c) => !(c.px >= 16) || (c.focused !== undefined && !(c.focused >= 16)));
        assert.deepEqual(small, [], `every focused text control is at least 16px: ${JSON.stringify(small)}`);
      });
    }
  }

  test('on a desktop the text controls keep their compact sizes (Issue #724)', async () => {
    const page = await open(browser);
    try {
      await page.click('.bug-fab');
      await page.waitForSelector('#bug-panel .bug-note');
      assert.equal(await page.locator('#bug-panel .bug-note').first().evaluate((n) => getComputedStyle(n).fontSize), '12px', 'the bug note stays 12px');
      await page.keyboard.press('Escape');
      await page.click('#main .table-view-btn');
      await page.click('.table-view-popover .view-add');
      await page.waitForSelector('.table-view-popover .view-name-input');
      assert.equal(await page.locator('.table-view-popover .view-name-input').first().evaluate((n) => getComputedStyle(n).fontSize), '13px', 'the view name input stays 13px');
    } finally { await page.close(); }
  });
}
