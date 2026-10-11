import test from 'node:test';
import assert from 'node:assert/strict';
import { engineOf, launch, phoneProfile } from './lib/browser.mjs';

const IPHONE = phoneProfile()?.page ?? null;
const SHOWN = [7, 77, 777, 7777];

const s = await launch('phone list id column', (weave) => {
  weave.createSpace({ name: 'Development' });
  const issues = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.addField(issues, { name: 'Shown', type: 'select', config: { options: ['Yes'] } });
  weave.addField(issues, { name: 'Severity', type: 'select', config: { options: ['Low', 'High'] } });
  for (let n = 1; n <= 7777; n++) {
    weave.createEntity(issues, SHOWN.includes(n)
      ? { name: `Writer token ${n} names the row`, values: { Shown: 'Yes', Severity: 'High' } }
      : { name: `Issue ${n}` });
  }
  weave.updateTable(issues, { filters: { Shown: ['Yes'] } });
  return { table: `#/table/${issues.id}` };
});

const measure = (page) => page.evaluate(() => [...document.querySelectorAll('#main tbody tr.entity-row')].map((tr) => {
  const link = tr.querySelector('.open-link');
  const name = tr.querySelector('.list-name');
  const chip = tr.querySelector('td[data-field] .k');
  const l = link.getBoundingClientRect(), n = name.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(link);
  const ink = range.getBoundingClientRect();
  return {
    id: link.textContent.trim(), gap: n.left - ink.right, nameLeft: n.left, chipLeft: chip?.getBoundingClientRect().left ?? null,
    clipped: link.scrollWidth > link.clientWidth + 0.5, digits: getComputedStyle(link).fontVariantNumeric, linkRight: l.right,
    theme: document.documentElement.dataset.bsTheme,
  };
}));

if (s) {
  const { base, browser, table } = s;
  const engines = [['chromium 390x844', browser, { viewport: { width: 390, height: 844 } }]];
  const webkit = await engineOf('webkit');
  if (webkit && IPHONE) engines.push(['webkit iPhone 15', webkit, IPHONE]);
  const open = async (b, profile, theme) => {
    const page = await b.newPage(profile);
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${table}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelectorAll('#main tbody tr.entity-row').length === 4);
    return page;
  };

  for (const [engine, b, profile] of engines) {
    for (const theme of ['light', 'dark']) {
      test(`on a phone the #id column fits the table's largest id, so every name starts 8px after it on one edge (${engine}, ${theme}, Issue #729)`, async () => {
        const page = await open(b, profile, theme);
        try {
          const rows = await measure(page);
          assert.deepEqual(rows.map((r) => r.id), SHOWN.map((n) => `#${n} ↗`));
          assert.equal(rows[0].theme, theme);
          for (const r of rows) {
            assert.equal(r.clipped, false, `${r.id} shows whole`);
            assert.ok(r.gap >= 8 - 0.5, `${r.id} leaves ${r.gap}px before the name`);
            assert.match(r.digits, /tabular-nums/, 'ids set in tabular figures');
          }
          const lefts = rows.map((r) => r.nameLeft);
          assert.ok(Math.max(...lefts) - Math.min(...lefts) <= 0.5, `the names share one left edge: ${lefts}`);
          for (const r of rows) assert.ok(r.chipLeft === null || Math.abs(r.chipLeft - r.nameLeft) <= 0.5, `${r.id}'s chips line up under its name (${r.chipLeft} vs ${r.nameLeft})`);
        } finally { await page.close(); }
      });
    }
  }

  test('on a desktop the #id cell keeps its column and the phone width token stays unset (Issue #729)', async () => {
    const page = await open(browser, { viewport: { width: 1280, height: 844 } }, 'light');
    try {
      assert.equal(await page.$eval('#main .wv-grid', (t) => t.style.getPropertyValue('--wv-pid-w')), '');
      assert.equal(await page.$eval('#main .wv-grid thead', (h) => getComputedStyle(h).display), 'table-header-group');
    } finally { await page.close(); }
  });
}
