import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let issues;
const s = await launch('grid cell inset', (weave) => {
  weave.createSpace({ name: 'Development' });
  issues = weave.createTable({ space: 'Development', name: 'Issue', description: 'Defects and findings.' });
  weave.addField(issues, { name: 'Summary', type: 'text' });
  weave.addField(issues, { name: 'Link', type: 'url' });
  weave.addField(issues, { name: 'Status', type: 'select', config: { options: ['Open', 'Fixed'] } });
  weave.createEntity(issues, { name: 'The header shows the id twice', values: { Description: 'Row 1 and row 2 both name it.', Summary: 'Twice', Link: 'https://example.com', Status: 'Open' } });
});

if (s) {
  const { base, browser } = s;
  const insets = (page) => page.evaluate(() => {
    const firstText = (el) => {
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
      const node = walk.nextNode();
      if (!node) return null;
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getBoundingClientRect().left;
    };
    const heads = [...document.querySelectorAll('.wv-grid thead th.col-head')];
    const row = document.querySelector('.wv-grid tbody tr.entity-row');
    return heads.map((th) => {
      const name = th.querySelector('.col-label')?.firstChild?.textContent.trim();
      const td = [...row.children].find((c) => c.cellIndex === th.cellIndex);
      return { name, head: firstText(th) - th.getBoundingClientRect().left, cell: td && firstText(td) - td.getBoundingClientRect().left };
    });
  });

  for (const density of ['compact', 'comfortable', 'spacious']) {
    test(`every column's cell text starts where its header label starts, and Name and Description share one inset (${density}, Feature #386)`, async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      try {
        await page.goto(`${base}/#/table/${issues.id}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.wv-grid tbody tr.entity-row');
        await page.evaluate((d) => document.querySelector('.wv-grid').setAttribute('data-density', d), density);
        const cols = await insets(page);
        const by = Object.fromEntries(cols.map((c) => [c.name, c]));
        for (const name of ['Name', 'Description', 'Summary', 'Link', 'Status']) {
          const c = by[name];
          assert.ok(c && c.cell != null, `${name} has a header and a cell: ${JSON.stringify(cols)}`);
          assert.ok(Math.abs(c.cell - c.head) <= 1, `${name}: the cell text starts ${c.cell}px in and its header ${c.head}px in`);
        }
        assert.ok(Math.abs(by.Name.cell - by.Description.cell) <= 1, `Name (${by.Name.cell}px) and Description (${by.Description.cell}px) share one inset`);
      } finally { await page.close(); }
    });
  }
}
