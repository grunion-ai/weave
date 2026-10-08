import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage } from './lib/browser.mjs';

const s = await launch('phone shortcut hints', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.addField(issues, { name: 'Severity', type: 'select', config: { options: ['Low', 'High'] } });
  const row = weave.createEntity(issues, { name: 'First issue', values: { Severity: 'Low' } });
  for (let i = 0; i < 5; i++) weave.createEntity(issues, { name: `Issue ${i}` });
  return { table: `#/table/${issues.id}`, docked: `#/table/${issues.id}?e=${row.id}` };
});

const hints = (page) => page.evaluate(() => {
  const KEY = /⌘|Ctrl\b/;
  const shown = (n) => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden';
  const out = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = walk.nextNode(); t; t = walk.nextNode()) {
    const host = t.parentElement;
    if (KEY.test(t.textContent) && host && shown(host) && !host.closest('.vditor')) out.push(`text: ${t.textContent.trim()}`);
  }
  for (const n of document.querySelectorAll('[title], [aria-label]')) {
    if (n.closest('.vditor') || !shown(n)) continue;
    for (const a of ['title', 'aria-label']) if (KEY.test(n.getAttribute(a) ?? '')) out.push(`${a}: ${n.getAttribute(a)}`);
  }
  return { theme: document.documentElement.dataset.bsTheme, out: [...new Set(out)] };
});

if (s) {
  const { base, browser, table, docked } = s;
  const phone = await phoneBrowser();
  const engines = [['chromium 390x844 touch', () => browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })]];
  if (phone) engines.push(['webkit iPhone 15', () => phonePage(phone)]);
  const open = async (make, hash, theme) => {
    const page = await make();
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    return page;
  };

  for (const [engine, make] of engines) {
    for (const theme of ['light', 'dark']) {
      test(`on a touch phone no visible text, title or label offers a keyboard shortcut (${engine}, ${theme}, Issue #736)`, async () => {
        let page = await open(make, table, theme);
        try {
          await page.waitForSelector('#main tbody tr.entity-row');
          let h = await hints(page);
          assert.equal(h.theme, theme);
          assert.deepEqual(h.out, [], 'the table page');
          await page.tap('#main .nav-menu');
          await page.waitForSelector('#app.nav-peek');
          assert.deepEqual((await hints(page)).out, [], 'the menu');
        } finally { await page.close(); }
        page = await open(make, docked, theme);
        try {
          await page.waitForSelector('#dock:not([hidden]) textarea.name-edit');
          assert.deepEqual((await hints(page)).out, [], 'the row page');
          await page.tap('.bug-fab');
          await page.waitForSelector('#bug-panel');
          assert.deepEqual((await hints(page)).out, [], 'the bug panel');
        } finally { await page.close(); }
      });
    }
  }

  test('on a desktop the shortcut hints stay (Issue #736)', async () => {
    const page = await open(() => browser.newPage({ viewport: { width: 1280, height: 844 } }), table, 'light');
    try {
      await page.waitForSelector('#main tbody tr.entity-row');
      assert.ok((await hints(page)).out.length > 0, 'the ⌘K pill and ⌘-click titles show where a keyboard is');
    } finally { await page.close(); }
  });
}
