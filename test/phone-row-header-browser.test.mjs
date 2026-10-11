import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage } from './lib/browser.mjs';

const s = await launch('phone row page header', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.addField(issues, { name: 'Severity', type: 'select', config: { options: ['Low', 'High'] } });
  const row = weave.createEntity(issues, { name: 'Looks broken: a phone row page shows an Expand button and small header buttons', values: { Severity: 'Low' } });
  return { hash: `#/table/${issues.id}?e=${row.id}` };
});

const header = (page) => page.evaluate(() => {
  const row = document.querySelector('#dock .dock-entity > .view-header .crumb-row');
  const shown = (n) => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden';
  const controls = [...row.querySelectorAll('button, a[href]')].filter(shown).map((n) => {
    const r = n.getBoundingClientRect();
    return { label: n.getAttribute('aria-label') || n.title || n.textContent.trim().slice(0, 30), w: r.width, h: r.height, top: r.top, kind: n.closest('.crumb-path') ? 'crumb' : 'control' };
  });
  return {
    theme: document.documentElement.dataset.bsTheme,
    controls,
    expand: [...row.querySelectorAll('.pose-btn')].some(shown),
    copy: [...row.querySelectorAll('.crumb-copy')].some(shown),
    eye: [...row.querySelectorAll('.eye-btn')].some(shown),
    scrollWidth: document.documentElement.scrollWidth - innerWidth,
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
    return page;
  };

  for (const [engine, make] of engines) {
    for (const theme of ['light', 'dark']) {
      test(`on a phone the row header drops Expand, moves copy link and fields into the row menu, and every control is 44px on one line (${engine}, ${theme}, Issue #734)`, async () => {
        const page = await open(make, theme);
        try {
          const h = await header(page);
          assert.equal(h.theme, theme);
          assert.equal(h.expand, false, 'no Expand on a full-screen row');
          assert.equal(h.copy, false, 'Copy permalink moved off the header');
          assert.equal(h.eye, false, 'Show or hide fields moved off the header');
          const controls = h.controls.filter((c) => c.kind === 'control');
          assert.deepEqual(controls.map((c) => c.label), ['Row actions', 'Close']);
          for (const c of controls) assert.ok(c.w >= 44 && c.h >= 44, `${c.label} is ${c.w}x${c.h}`);
          assert.equal(new Set(h.controls.map((c) => Math.round(c.top + c.h / 2))).size <= 2, true, 'the header keeps one line');
          assert.equal(h.scrollWidth, 0, 'no sideways scroll');
          await page.click('#dock .crumb-row .dots-btn');
          const items = await page.locator('#dock .dl-menu:not(.hidden) .dropdown-item').evaluateAll((ns) => ns.filter((n) => n.getClientRects().length).map((n) => n.textContent.trim()));
          assert.ok(items.includes('Copy link') && items.includes('Show or hide fields'), `the row menu holds them: ${items}`);
          await page.click('#dock .dl-menu:not(.hidden) .dropdown-item:has-text("Show or hide fields")');
          await page.waitForSelector('.chip-pop .eye-row, .chip-pop input[type="checkbox"]');
        } finally { await page.close(); }
      });
    }
  }

  test('on a desktop the row pane keeps Expand, the eye and the copy button, and its menu shows no phone items (Issue #734)', async () => {
    const page = await open(() => browser.newPage({ viewport: { width: 1280, height: 844 } }));
    try {
      const h = await header(page);
      assert.equal(h.expand, true);
      assert.equal(h.eye, true);
      await page.click('#dock .crumb-row .dots-btn');
      const items = await page.locator('#dock .dl-menu:not(.hidden) .dropdown-item').evaluateAll((ns) => ns.filter((n) => n.getClientRects().length).map((n) => n.textContent.trim()));
      assert.equal(items.includes('Copy link') || items.includes('Show or hide fields'), false, `${items}`);
    } finally { await page.close(); }
  });
}
