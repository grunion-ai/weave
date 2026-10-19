import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage } from './lib/browser.mjs';

let bare, marked, picks;
const s = await launch('phone table head', (weave) => {
  weave.createSpace({ name: 'Sales' });
  bare = weave.createTable({ space: 'Sales', name: 'Deal' });
  for (const name of ['Acme renewal', 'Globex expansion']) weave.createEntity(bare, { name });
  marked = weave.createTable({ space: 'Sales', name: 'Lead', icon: 'lucide:star' });
  weave.createEntity(marked, { name: 'Initech pilot' });
  picks = weave.createTable({ space: 'Sales', name: 'Account' });
  weave.createEntity(picks, { name: 'Umbrella' });
});

const head = (page) => page.evaluate(() => {
  const box = (sel) => { const n = document.querySelector(sel); if (!n) return null; const r = n.getBoundingClientRect(); return r.width && r.height ? r.toJSON() : null; };
  const input = document.querySelector('#main .view-title-row .view-title');
  const pad = parseFloat(getComputedStyle(input).paddingLeft) + parseFloat(getComputedStyle(input).borderLeftWidth);
  return {
    slot: box('#main .view-title-row > .icon-btn'),
    ghost: document.querySelectorAll('#main .view-title-row .icon-ghost').length,
    gutter: box('#main .crumb-row .nav-menu')?.left ?? null,
    text: input.getBoundingClientRect().left + pad,
    title: box('#main .view-title-row'),
    row: box('#main tr.entity-row'),
  };
});

if (s) {
  const { base, browser } = s;
  const phone = await phoneBrowser();
  const engines = [['chromium 390x844', () => browser.newPage({ viewport: { width: 390, height: 844 } })]];
  if (phone) engines.push(['webkit iPhone 15', () => phonePage(phone)]);
  const open = async (make, table, theme = 'light') => {
    const page = await make();
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#main tr.entity-row');
    return page;
  };

  for (const [engine, make] of engines) {
    for (const theme of ['light', 'dark']) {
      test(`a table on a phone with no icon draws no empty icon slot, its title sits at the gutter and its rows follow close under it (${engine}, ${theme}, Issue #981)`, async () => {
        const page = await open(make, bare, theme);
        try {
          const h = await head(page);
          assert.equal(h.slot, null, `no icon slot is drawn (${JSON.stringify(h.slot)})`);
          assert.ok(Math.abs(h.text - h.gutter) <= 2, `the title text starts at the gutter (${h.text} vs ${h.gutter})`);
          const gap = h.row.top - h.title.bottom;
          assert.ok(gap >= 0 && gap <= 16, `the first row starts ${gap}px under the title`);
        } finally { await page.close(); }
      });
    }

    test(`a table on a phone with an icon still shows it beside the title (${engine}, Issue #981)`, async () => {
      const page = await open(make, marked);
      try {
        const h = await head(page);
        assert.ok(h.slot && h.slot.width >= 44 && h.slot.height >= 44, `the icon shows as a 44px target (${JSON.stringify(h.slot)})`);
        assert.equal(h.ghost, 0);
      } finally { await page.close(); }
    });
  }

  test('on a phone a table with no icon offers Add icon… in its menu, and the picked icon shows beside the title (Issue #981)', async () => {
    const page = await open(engines.at(-1)[1], picks);
    try {
      await page.click('#main .dots-btn[title="Table actions"]');
      await page.locator('.wv-menu >> text=Add icon…').click();
      const cell = page.locator('.picker-pop .picker-cell:not(.picker-none)').first();
      await cell.waitFor();
      await cell.click();
      await page.waitForFunction(() => document.querySelector('#main .view-title-row > .icon-btn svg'));
      const h = await head(page);
      assert.ok(h.slot && h.slot.width >= 44, `the icon shows beside the title (${JSON.stringify(h.slot)})`);
      await page.click('#main .dots-btn[title="Table actions"]');
      await page.waitForSelector('.wv-menu .wv-menu-row');
      assert.equal(await page.locator('.wv-menu >> text=Add icon…').count(), 0, 'and the menu stops offering it');
    } finally { await page.close(); }
  });

  test('on a desktop the empty icon slot stays beside the title for picking one (Issue #981)', async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${bare.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main tr.entity-row');
      const h = await head(page);
      assert.ok(h.slot, 'the slot shows');
      assert.equal(h.ghost, 1, 'as the ghost ring');
      await page.click('#main .dots-btn[title="Table actions"]');
      await page.waitForSelector('.wv-menu .wv-menu-row');
      assert.equal(await page.locator('.wv-menu >> text=Add icon…').count(), 0, 'so the menu needs no Add icon row');
    } finally { await page.close(); }
  });
}
