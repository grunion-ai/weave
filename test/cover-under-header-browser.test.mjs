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
  for (let i = 0; i < 120; i++) w.createEntity(table, { name: `page ${i}` });
  const tableRow = w.query('System/Tables', {}).items.find((r) => r.sysId === table.id);
  for (const r of [row, tableRow]) {
    w.attachToField(r.id, 'Header', { name: 'banner.svg', mime: 'image/svg+xml', bytes: svg });
    w.attachToField(r.id, 'Introduction', { name: 'intro.html', mime: 'text/html', bytes: html });
  }
  ids = { row: row.id, table: table.id };
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
      coverAfter: !!(header.compareDocumentPosition(cover) & Node.DOCUMENT_POSITION_FOLLOWING),
      inset: Math.min(...tops) - m.top, pad,
      left: h.left - m.left, right: m.left + main.clientWidth - h.right,
      scrolled: main.scrollTop,
    };
  });
  const pages = [['record', () => `#/entity/${ids.row}`], ['table landing', () => `#/table/${ids.table}`]];
  for (const [kind, route] of pages) for (const width of [1440, 390]) {
    test(`the crumbs and toolbar sit above the cover and keep the pane inset when held (${kind}, ${width})`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      try {
        await page.goto(`${base}/${route()}`, { waitUntil: 'networkidle' });
        await page.locator('#main .entity-cover img').waitFor();
        await page.waitForFunction(() => document.querySelector('#main .entity-cover img')?.naturalWidth > 0);
        const rest = await measure(page);
        assert.ok(rest.first, 'the view header is the first thing in the pane');
        assert.ok(rest.coverAfter, 'the cover follows the view header');
        await page.evaluate(() => document.querySelector('#main').scrollTo({ top: 900, behavior: 'instant' }));
        await page.waitForFunction(() => document.querySelector('#main').scrollTop > 400);
        const held = await measure(page);
        assert.ok(held.inset >= held.pad - 1, `the held crumbs and toolbar keep the pane's top inset: ${held.inset} < ${held.pad}`);
        assert.ok(Math.abs(held.left) <= 1 && Math.abs(held.right) <= 1, `the held header covers the pane edge to edge: left=${held.left} right=${held.right}`);
      } finally { await page.close(); }
    });
  }
}
