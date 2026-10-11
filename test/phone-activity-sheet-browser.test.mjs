import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, eventually, phoneBrowser, phonePage } from './lib/browser.mjs';

const s = await launch('phone activity sheet', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.addField(issues, { name: 'Severity', type: 'select', config: { options: ['Low', 'High'] } });
  const row = weave.createEntity(issues, { name: 'Looks broken', values: { Severity: 'Low' } });
  weave.updateEntity(row.id, { Severity: 'High' });
  return { hash: `#/table/${issues.id}?e=${row.id}` };
});

const sheet = (page) => page.evaluate(() => {
  const p = document.querySelector('aside.wv-activity');
  if (!p) return null;
  const r = p.getBoundingClientRect();
  const list = p.querySelector('.wv-act-list').getBoundingClientRect();
  const close = p.querySelector('.wv-act-close').getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return {
    theme: document.documentElement.dataset.bsTheme, left: r.left, top: r.top, right: r.right, bottom: r.bottom,
    vw: document.documentElement.clientWidth, vh: innerHeight, list: list.width, close: [close.width, close.height],
    onTop: !!hit?.closest('aside.wv-activity'), rows: p.querySelectorAll('.wv-act-row').length,
    filters: [...p.querySelectorAll('.wv-act-filters button')].map((b) => Math.round(b.getBoundingClientRect().height)),
  };
});

if (s) {
  const { base, browser, hash } = s;
  const phone = await phoneBrowser();
  const engines = [['chromium 390x844', () => browser.newPage({ viewport: { width: 390, height: 844 } })]];
  if (phone) engines.push(['webkit iPhone 15', () => phonePage(phone)]);
  const open = async (make, theme = 'light') => {
    const page = await make();
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
    await page.click('#dock .dots-btn');
    await page.click('#dock .dl-menu:not(.hidden) .dropdown-item:has-text("Activity")');
    await page.waitForSelector('aside.wv-activity .wv-act-list');
    return page;
  };

  for (const [engine, make] of engines) {
    for (const theme of ['light', 'dark']) {
      test(`on a phone a row's Activity opens as a full-screen sheet with 44px controls, and Back closes it (${engine}, ${theme}, Issue #733)`, async () => {
        const page = await open(make, theme);
        try {
          const p = await sheet(page);
          assert.equal(p.theme, theme);
          assert.deepEqual([p.left, p.top, Math.round(p.right), Math.round(p.bottom)], [0, 0, p.vw, p.vh], 'the sheet covers the screen');
          assert.ok(p.onTop, 'above the row');
          assert.ok(p.list >= 300, `its list is ${p.list}px wide`);
          assert.deepEqual(p.close.map(Math.round), [44, 44], 'Close is a 44px target');
          assert.ok(p.filters.every((h) => h >= 44), `filters are 44px targets: ${p.filters}`);
          assert.ok(p.rows >= 1, 'the history shows');
          await page.goBack();
          assert.equal(await eventually(() => page.locator('aside.wv-activity').count(), 0), 0, 'Back closes the sheet');
          assert.equal(await page.locator('#dock:not([hidden]) textarea.name-edit').count(), 1, 'and leaves the row open');
          await page.click('#dock .dots-btn');
          await page.click('#dock .dl-menu:not(.hidden) .dropdown-item:has-text("Activity")');
          await page.waitForSelector('aside.wv-activity');
          const before = await page.evaluate(() => history.length);
          await page.click('aside.wv-activity .wv-act-close');
          assert.equal(await eventually(() => page.locator('aside.wv-activity').count(), 0), 0, 'Close shuts it');
          await page.waitForTimeout(200);
          assert.equal(await page.locator('#dock:not([hidden]) textarea.name-edit').count(), 1, 'the row stays open after Close');
          assert.ok(await page.evaluate(() => history.state?.wvSheet !== 'activity'), `Close takes back the history step it added (${before})`);
        } finally { await page.close(); }
      });
    }
  }

  test('on a desktop Activity stays a 328px side panel (Issue #733)', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 844 } });
    try {
      await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
      await page.click('#dock .dots-btn');
      await page.click('#dock .dl-menu:not(.hidden) .dropdown-item:has-text("Activity")');
      await page.waitForSelector('aside.wv-activity');
      const p = await sheet(page);
      assert.equal(Math.round(p.right - p.left), 328);
    } finally { await page.close(); }
  });
}
