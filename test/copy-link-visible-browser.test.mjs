import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
let table, row;
const s = await launch('copy link visible at rest', (weave) => {
  weave.createSpace({ name: 'Development' });
  table = weave.createTable({ space: 'Development', name: 'Issue' });
  weave.addField(table, { name: 'Notes', type: 'document' });
  row = weave.createEntity(table, { name: 'copy link should always show' });
  weave.setDoc(row.id, '# Notes\n\nbody\n', 'Notes');
});
if (s) {
  const { base, browser } = s;
  const seen = (page, sel) => page.$eval(sel, (n) => {
    const cs = getComputedStyle(n);
    const r = n.getBoundingClientRect();
    return { opacity: Number(cs.opacity), visibility: cs.visibility, w: r.width, h: r.height, tag: n.tagName, label: n.getAttribute('aria-label') };
  });
  const atRest = async (page) => {
    await page.mouse.move(0, 899);
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForTimeout(250);
  };
  for (const theme of ['light', 'dark']) {
    test(`${theme}: the row page shows its copy-link controls without a hover`, async () => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
      await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main .view-header .crumb-copy');
      await page.waitForSelector('#main .doc-section .permalink-copy');
      await atRest(page);
      const crumb = await seen(page, '#main .view-header .crumb-copy');
      assert.equal(crumb.opacity, 1, 'the crumb copy-link is fully visible at rest');
      assert.equal(crumb.visibility, 'visible');
      assert.ok(crumb.w > 0 && crumb.h > 0, 'and takes space');
      assert.equal(crumb.label, 'Copy permalink');
      const doc = await seen(page, '#main .doc-section .permalink-copy');
      assert.ok(doc.opacity >= 0.7, `the document copy-link is visible at rest (opacity ${doc.opacity})`);
      assert.equal(doc.visibility, 'visible');
      assert.equal(doc.tag, 'BUTTON', 'the document copy-link is a focusable button');
      assert.equal(doc.label, 'Copy link to this document');
      const tools = await page.$eval('#main .doc-section .doc-dl > .dots-btn', (n) => Number(getComputedStyle(n).opacity));
      assert.equal(tools, 0, 'the other section tools still wait for a hover');
      await page.close();
    });
  }
  test('the dock row header shows its copy-link without a hover', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${base}/#/table/${table.id}?e=${row.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#dock:not([hidden]) .crumb-copy');
    await atRest(page);
    const crumb = await seen(page, '#dock .crumb-copy');
    assert.equal(crumb.opacity, 1, 'the dock copy-link is fully visible at rest');
    await page.close();
  });
}
