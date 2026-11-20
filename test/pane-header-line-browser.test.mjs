import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, settled } from './lib/browser.mjs';

let deals, acme;
const s = await launch('pane header line', (weave) => {
  weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deals' });
  acme = weave.createEntity(deals, { name: 'Acme Working Capital' });
  weave.createEntity(deals, { name: 'Bolt Equipment Lease' });
});

if (s) {
  const { base, browser } = s;

  const openDocked = async ({ width, theme }) => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${base}/#/table/${deals.id}?e=${acme.id}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector('#dock:not([hidden]) .name-edit');
    await page.waitForSelector('#main .wv-grid tbody tr.entity-row');
    await settled(page.locator('#dock .view-header .crumb-row'));
    await settled(page.locator('#main .view-header .crumb-row'));
    return page;
  };

  const read = (page) => page.evaluate(() => {
    const mid = (r) => r.top + r.height / 2;
    const pane = (scope) => {
      const row = document.querySelector(`${scope} .view-header .crumb-row`);
      const bar = document.querySelector(`${scope} .view-header .head-bar`);
      const path = row.querySelector('.crumb-path').getBoundingClientRect();
      const controls = [...bar.querySelectorAll(':scope > .crumb-actions > :is(button, .table-search), :scope > .dl-wrap > button, :scope > .new-record-btn')]
        .map((n) => ({ label: n.getAttribute('aria-label') || n.title || n.className, r: n.getBoundingClientRect() }))
        .filter((c) => c.r.height)
        .map((c) => ({ label: c.label, mid: mid(c.r), height: c.r.height }));
      return { rowTop: row.getBoundingClientRect().top, path: mid(path), bar: mid(bar.getBoundingClientRect()), controls };
    };
    return { main: pane('#main'), dock: pane('#dock') };
  });

  for (const width of [1920, 1600, 1280]) {
    {
      const theme = 'light';
      test(`${width}px ${theme}: the list header and the docked record header share both lines (Issue #1807, Feature #384)`, async () => {
        const page = await openDocked({ width, theme });
        try {
          assert.equal(await page.locator('#dock').evaluate((n) => getComputedStyle(n).paddingTop), await page.locator('#main').evaluate((n) => getComputedStyle(n).paddingTop), 'both panes pad their top by one value');
          const m = await read(page);
          assert.ok(Math.abs(m.main.path - m.dock.path) <= 1, `breadcrumb centres: main ${m.main.path} vs dock ${m.dock.path}`);
          const line = m.dock.bar;
          assert.ok(Math.abs(m.main.bar - line) <= 1, `row 2 centres: main ${m.main.bar} vs dock ${line}`);
          assert.ok(m.main.controls.length, 'the list header has controls on row 2');
          assert.ok(m.dock.controls.length, 'the dock header has controls on row 2');
          if (width === 1920) assert.ok(m.main.controls.some((c) => /table-search/.test(c.label)), `the toolbar fits row 2: ${JSON.stringify(m.main.controls)}`);
          for (const pane of ['main', 'dock']) {
            for (const c of m[pane].controls) {
              assert.ok(Math.abs(c.mid - line) <= 1, `${pane} ${c.label} centre ${c.mid} vs the shared line ${line}`);
            }
          }
        } finally { await page.close(); }
      });
    }
  }

  test('the header controls keep their drawn size (Issue #1807)', async () => {
    const page = await openDocked({ width: 1920, theme: 'light' });
    try {
      const m = await read(page);
      const search = m.main.controls.find((c) => /table-search/.test(c.label));
      assert.equal(search?.height, 28, `the search bar is the 28px of every bar tool: ${JSON.stringify(m.main.controls)}`);
      const share = await page.locator('#dock .view-header .head-bar .table-share-btn').evaluate((n) => n.getBoundingClientRect().height);
      assert.equal(share, 28, `the dock's share button keeps its 28px: ${share}`);
    } finally { await page.close(); }
  });
}
