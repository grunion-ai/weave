import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, settled } from './lib/browser.mjs';

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

const s = await launch('phone header unchanged', (weave) => {
  weave.createSpace({ name: 'Sales' });
  const deals = weave.createTable({ space: 'Sales', name: 'Deals' });
  weave.addField(deals, { name: 'Stage', type: 'select', config: { options: ['Lead', 'Won'] } });
  weave.addField(deals, { name: 'Amount', type: 'number' });
  const acme = weave.createEntity(deals, { name: 'Acme Working Capital', values: { Stage: 'Lead', Amount: 1200 } });
  weave.createEntity(deals, { name: 'Northwind rollout', values: { Stage: 'Won', Amount: 800 } });
  weave.setDoc(acme.id, 'Notes on the deal.');
  return { table: `#/table/${deals.id}`, record: `#/entity/${acme.id}`, dock: `#/table/${deals.id}?e=${acme.id}` };
});

const header = (page, scope) => page.evaluate((scope) => {
  const half = (v) => Math.round(v * 2) / 2;
  const row = document.querySelector(`${scope} .view-header .crumb-row`);
  const seen = (n) => {
    if (!n.getClientRects().length || getComputedStyle(n).visibility === 'hidden') return false;
    for (let x = n; x && x !== row; x = x.parentElement) if (getComputedStyle(x).opacity === '0') return false;
    return n.getBoundingClientRect().width > 1.5;
  };
  const name = (n) => ['nav-menu', 'crumb-nav', 'dock-back', 'crumb-more', 'crumb-copy', 'table-search-btn', 'table-view-btn', 'table-density-btn', 'table-filter-btn', 'table-group-btn', 'table-sort-btn',
    'activity-btn', 'eye-btn', 'table-share-btn', 'dots-btn', 'pose-btn', 'dock-close', 'table-tools-btn'].find((c) => n.classList.contains(c)) ?? n.getAttribute('aria-label');
  const controls = [...row.querySelectorAll('button')].filter(seen).map((n) => {
    const r = n.getBoundingClientRect();
    const cs = getComputedStyle(n);
    const icon = n.querySelector('svg')?.getBoundingClientRect();
    return {
      name: name(n), w: half(r.width), h: half(r.height), left: r.left, right: r.right,
      icon: icon ? half(icon.width) : null,
      border: parseFloat(cs.borderTopWidth) > 0 && !/, 0\)$|transparent/.test(cs.borderTopColor),
      fill: !/, 0\)$|transparent/.test(cs.backgroundColor),
    };
  }).sort((a, b) => a.left - b.left);
  const tools = controls.filter((c) => !['nav-menu', 'crumb-nav', 'dock-back', 'crumb-more', 'crumb-copy'].includes(c.name));
  return {
    row: half(row.getBoundingClientRect().height),
    controls: controls.map((c) => `${c.name} ${c.w}x${c.h} icon ${c.icon}${c.border ? ' border' : ''}${c.fill ? ' fill' : ''}`),
    gaps: tools.slice(1).map((c, i) => half(c.left - tools[i].right)),
    edge: half(row.getBoundingClientRect().right - (controls.at(-1)?.right ?? 0)),
    scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}, scope);

const menuRows = async (page, scope) => {
  await page.click(`${scope} .view-header .crumb-row .dots-btn`);
  await page.waitForSelector('.chip-pop.wv-menu.wv-menu-sheet [role^="menuitem"]');
  await settled(page.locator('.chip-pop.wv-menu'));
  const rows = await page.locator('.chip-pop.wv-menu [role^="menuitem"]').evaluateAll((list) => list.map((r) => `${(r.querySelector('.wv-menu-label, .hold-label')?.textContent ?? r.textContent).trim()} ${Math.round(r.getBoundingClientRect().height)}`));
  await page.keyboard.press('Escape');
  await page.waitForSelector('.chip-pop.wv-menu', { state: 'detached' });
  return rows;
};

const WANT = {
  table: {
    row: 44,
    controls: ['nav-menu 44x44 icon 20 border fill', 'dots-btn 44x44 icon 16 border fill', 'table-tools-btn 44x44 icon 20 border fill'],
    gaps: [12], edge: 0, scroll: 0,
  },
  tableMenu: ['Add icon… 44', 'Add description… 44', 'Move to space… 44', 'Duplicate 44', 'Open trash 44', 'New share page… 44', 'Forms… 44', 'Copy create link 44', 'CSV 44', 'Move to trash 44'],
  sheet: ['table-view-btn 44', 'table-share-btn 44', 'table-density-btn 44', 'eye-btn 44', 'table-filter-btn 44', 'table-group-btn 44', 'table-sort-btn 44'],
  record: {
    row: 44,
    controls: ['nav-menu 44x44 icon 20 border fill', 'crumb-more 36x36 icon 16 fill', 'crumb-copy 22x22 icon 16', 'eye-btn 33x27 icon 15 border fill', 'dots-btn 28x22 icon 16', 'Close — back to the table 34x28 icon 16 border fill'],
    gaps: [10, 12], edge: 0, scroll: 0,
  },
  recordMenu: ['Activity 44', 'Share (Beta) 44', 'Collapse beside the table 44', 'Duplicate 44', 'Report a problem 44', 'Markdown 44', 'HTML 44', 'PDF 44', 'Move to trash 44'],
  dock: {
    row: 44,
    controls: ['crumb-copy 22x22 icon 16', 'eye-btn 44x44 icon 15 border fill', 'dots-btn 44x44 icon 16 border fill', 'dock-close 44x44 icon 16 border fill'],
    gaps: [3, 3], edge: 0, scroll: 0,
  },
  dockMenu: ['Activity 44', 'Share (Beta) 44', 'Duplicate 44', 'Report a problem 44', 'Markdown 44', 'HTML 44', 'PDF 44', 'Move to trash 44'],
};

if (s) {
  const { base, browser } = s;
  const open = async (hash, ready) => {
    const page = await browser.newPage(PHONE);
    await page.addInitScript(() => localStorage.setItem('weave-theme', 'light'));
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(ready);
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    return page;
  };

  test('a phone table header keeps its three 44 px buttons, its tools sheet and its menu rows', async () => {
    const page = await open(s.table, '#main .table-tools-btn');
    try {
      assert.deepEqual(await header(page, '#main'), WANT.table);
      assert.deepEqual(await menuRows(page, '#main'), WANT.tableMenu);
      await page.click('#main .table-tools-btn');
      await settled(page.locator('#main .crumb-actions'));
      const sheet = await page.locator('#main .crumb-row.tools-open > .crumb-actions > *').evaluateAll((list) => list
        .filter((n) => n.getClientRects().length)
        .map((n) => `${[...n.classList].find((c) => /^(table-.*-btn|eye-btn|table-search)$/.test(c))} ${Math.round(n.getBoundingClientRect().height)}`));
      assert.deepEqual(sheet, WANT.sheet);
      assert.equal(await page.locator('.phone-bar').isVisible(), true, 'the bottom bar still shows under a table');
    } finally { await page.close(); }
  });

  test('a phone record page keeps its header controls, their sizes and its menu rows', async () => {
    const page = await open(s.record, '#main .view-header .crumb-cur');
    try {
      assert.deepEqual(await header(page, '#main'), WANT.record);
      assert.deepEqual(await menuRows(page, '#main'), WANT.recordMenu);
    } finally { await page.close(); }
  });

  test('a phone record over its table keeps its 44 px header controls and its menu rows', async () => {
    const page = await open(s.dock, '#dock:not([hidden]) .view-header .crumb-cur');
    try {
      assert.deepEqual(await header(page, '#dock'), WANT.dock);
      assert.deepEqual(await menuRows(page, '#dock'), WANT.dockMenu);
    } finally { await page.close(); }
  });
}
