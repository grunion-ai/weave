import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch } from './lib/browser.mjs';
const svg = readFileSync(new URL('../brand/kit/svg/poster-contour-banner.svg', import.meta.url));
let ids;
const s = await launch('cover under header', (w) => {
  const space = w.createSpace({ name: 'Documentation' });
  const table = w.createTable({ space: space.id, name: 'Page' });
  for (const t of [table, 'System/Tables']) {
    w.addField(t, { name: 'Header', type: 'attachments', config: { multiple: false, preview: 'cover' } });
    w.addField(t, { name: 'Introduction', type: 'attachments', config: { multiple: false, preview: 'intro' } });
  }
  const html = Buffer.from('<!doctype html><style>body{margin:0;font:32px/1.2 system-ui}</style><h1>Start with one example.</h1><p>Then connect an agent.</p>');
  const long = Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1} gives the page enough height to scroll under its header.`).join('\n\n');
  const row = w.createEntity(table, { name: 'Quickstart', doc: long });
  const bare = w.createEntity(table, { name: 'Changelog', doc: long });
  for (let i = 0; i < 120; i++) w.createEntity(table, { name: `page ${i}` });
  const tableRow = w.query('System/Tables', {}).items.find((r) => r.sysId === table.id);
  for (const r of [row, tableRow]) {
    w.attachToField(r.id, 'Header', { name: 'banner.svg', mime: 'image/svg+xml', bytes: svg });
    w.attachToField(r.id, 'Introduction', { name: 'intro.html', mime: 'text/html', bytes: html });
  }
  const notes = w.createTable({ space: space.id, name: 'Note' });
  w.addField(notes, { name: 'Header', type: 'attachments', config: { multiple: false, preview: 'cover' } });
  const note = w.createEntity(notes, { name: 'Release note' });
  w.attachToField(note.id, 'Header', { name: 'banner.svg', mime: 'image/svg+xml', bytes: svg });
  ids = { row: row.id, bare: bare.id, table: table.id, note: note.id, notes: notes.id };
});
if (s) {
  const { base, browser } = s;
  const measure = (page) => page.evaluate(() => {
    const main = document.querySelector('#main');
    const header = main.querySelector(':scope > .view-header');
    const cover = main.querySelector('.entity-cover');
    const pad = parseFloat(getComputedStyle(main).paddingTop);
    const m = main.getBoundingClientRect();
    const h = header.getBoundingClientRect();
    const tops = [...header.querySelectorAll('.crumb-row, .crumb-actions button')].map((n) => n.getBoundingClientRect()).filter((r) => r.height > 0).map((r) => r.top);
    return {
      first: main.firstElementChild === header,
      coverInHeader: !!cover && cover.parentElement === header,
      inset: Math.min(...tops) - m.top, pad,
      left: h.left - m.left, right: m.left + main.clientWidth - h.right,
      bottom: h.bottom - m.top,
      scrolled: main.scrollTop,
    };
  });
  const headerParts = (page, pane) => page.evaluate((sel) => {
    const names = ['crumb-row', 'entity-cover', 'entity-head', 'view-title-row'];
    return [...document.querySelector(`${sel} > .view-header`).children]
      .map((n) => names.find((c) => n.classList.contains(c)))
      .filter(Boolean);
  }, pane);
  const settledCover = async (page, pane) => {
    await page.locator(`${pane} .entity-cover img`).waitFor();
    await page.waitForFunction((sel) => document.querySelector(`${sel} .entity-cover img`)?.naturalWidth > 0, pane);
  };
  const scrollPane = async (page) => {
    await page.evaluate(() => document.querySelector('#main').scrollTo({ top: 900, behavior: 'instant' }));
    await page.waitForFunction(() => document.querySelector('#main').scrollTop > 400);
  };

  const pages = [['record', () => `#/entity/${ids.row}`], ['table landing', () => `#/table/${ids.table}`]];
  for (const [kind, route] of pages) for (const width of [1440, 390]) {
    test(`the crumbs and toolbar sit above the cover and keep the pane inset (${kind}, ${width})`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      try {
        await page.goto(`${base}/${route()}`, { waitUntil: 'networkidle' });
        await settledCover(page, '#main');
        const rest = await measure(page);
        assert.ok(rest.first, 'the view header is the first thing in the pane');
        assert.ok(rest.coverInHeader, 'the cover sits inside the view header');
        assert.ok(rest.inset >= rest.pad - 1, `the crumbs and toolbar keep the pane's top inset: ${rest.inset} < ${rest.pad}`);
        assert.ok(Math.abs(rest.left) <= 1 && Math.abs(rest.right) <= 1, `the header covers the pane edge to edge: left=${rest.left} right=${rest.right}`);
        await scrollPane(page);
        const held = await measure(page);
        assert.ok(held.bottom <= 1, `a header carrying a banner leaves with the page instead of holding half the pane: bottom ${held.bottom}`);
      } finally { await page.close(); }
    });
  }

  for (const width of [1440, 390]) {
    test(`a header without a banner still holds the crumbs at the pane inset (record, ${width})`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      try {
        await page.goto(`${base}/#/entity/${ids.bare}`, { waitUntil: 'networkidle' });
        await page.locator('#main .entity-head .name-edit').waitFor();
        await scrollPane(page);
        const held = await measure(page);
        assert.ok(held.inset >= held.pad - 1, `the held crumbs and toolbar keep the pane's top inset: ${held.inset} < ${held.pad}`);
        assert.ok(Math.abs(held.left) <= 1 && Math.abs(held.right) <= 1, `the held header covers the pane edge to edge: left=${held.left} right=${held.right}`);
      } finally { await page.close(); }
    });
  }

  const inHeader = [
    ['a record with an introduction', () => `#/entity/${ids.row}`, ['crumb-row', 'entity-cover', 'entity-head']],
    ['a record without an introduction', () => `#/entity/${ids.note}`, ['crumb-row', 'entity-cover', 'entity-head']],
    ['a table landing', () => `#/table/${ids.table}`, ['crumb-row', 'entity-cover', 'view-title-row']],
  ];
  for (const [kind, route, order] of inHeader) {
    test(`the cover draws under the crumbs and toolbar and over the title (${kind}, Issue #1551)`, async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 800 } });
      try {
        await page.goto(`${base}/${route()}`, { waitUntil: 'networkidle' });
        await settledCover(page, '#main');
        assert.deepEqual(await headerParts(page, '#main'), order);
      } finally { await page.close(); }
    });
  }

  test('a cover that arrives after the first paint lands in the same place (Issue #1551)', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 800 } });
    try {
      await page.goto(`${base}/#/table/${ids.notes}`, { waitUntil: 'networkidle' });
      await page.click(`tr[data-eid="${ids.note}"] .open-link`);
      await page.waitForSelector('#dock:not([hidden]) .name-edit');
      await settledCover(page, '#dock .dock-entity');
      assert.deepEqual(await headerParts(page, '#dock .dock-entity'), ['crumb-row', 'entity-cover', 'entity-head']);
    } finally { await page.close(); }
  });
}
