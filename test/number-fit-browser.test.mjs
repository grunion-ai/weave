import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { probe } from './lib/cutoff.mjs';

const FULL = '$98,765,432,109.87';
const COMPACT = '$98.8B';
let table;
const s = await launch('number fit', (weave) => {
  weave.createSpace({ name: 'Lab' });
  table = weave.createTable({ space: 'Lab', name: 'Sample' });
  weave.addField(table, { name: 'Amount', type: 'number', config: { format: 'currency', currency: 'USD' } });
  weave.addField(table, { name: 'Share', type: 'number', config: { format: 'percent' } });
  weave.createEntity(table, { name: 'Big', values: { Amount: 98765432109.87, Share: 0.5 } });
  weave.createEntity(table, { name: 'Small', values: { Amount: 12.5, Share: 0.25 } });
  const v = weave.tableView(table.id).views[0];
  weave.tableView(`${table.id}/${v.id}`, { widths: { Amount: 110, Share: 110 } });
});

if (s) {
  const { base, browser } = s;
  const SEL = 'tr.entity-row td[data-field="Amount"] .num-dressed';
  const read = (page) => page.$$eval(SEL, (nodes) => nodes.map((n) => ({
    text: n.textContent, title: n.getAttribute('title'), cut: n.scrollWidth > n.clientWidth,
  })));
  const shows = (page, text) => page.waitForFunction(([sel, t]) => [...document.querySelectorAll(sel)].some((n) => n.textContent === t), [SEL, text]);
  async function open(theme) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector(SEL);
    return page;
  }

  for (const theme of ['light', 'dark']) {
    test(`${theme}: an amount too wide for its column shows the compact form with the full amount on hover (Issue #1160)`, async () => {
      const page = await open(theme);
      try {
        await shows(page, COMPACT);
        const got = await read(page);
        const big = got.find((c) => c.text === COMPACT);
        assert.equal(big.title, FULL, 'the full amount sits on hover');
        assert.equal(big.cut, false, 'the compact form fits whole');
        const small = got.find((c) => c.text === '$12.50');
        assert.ok(small, `a small amount keeps its full figure, got ${JSON.stringify(got)}`);
        assert.equal(small.title, null);
        const share = await page.$$eval('tr.entity-row td[data-field="Share"] .num-dressed', (nodes) => nodes.map((n) => n.textContent));
        assert.deepEqual(share.sort(), ['25%', '50%'], 'a percent never compacts');
        const cut = (await page.evaluate(probe, 'tr.entity-row td[data-field="Amount"]')).filter((f) => f.selector.includes('num-dressed'));
        assert.deepEqual(cut, [], 'the probe finds no cut-off text in the amount cells');
      } finally { await page.close(); }
    });
  }

  test('widening the column brings the full figure back, and narrowing it compacts again', async () => {
    const page = await open('light');
    try {
      await shows(page, COMPACT);
      const grip = page.locator('.wv-grid thead th', { hasText: 'Amount' }).locator('.col-resize');
      const drag = async (dx) => {
        const box = await grip.boundingBox();
        const y = box.y + box.height / 2;
        await page.mouse.move(box.x + box.width / 2, y);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + dx, y, { steps: 6 });
        await page.mouse.up();
      };
      await drag(160);
      await shows(page, FULL);
      const big = (await read(page)).find((c) => c.text === FULL);
      assert.equal(big.title, null, 'the full figure needs no hover');
      assert.equal(big.cut, false);
      await drag(-160);
      await shows(page, COMPACT);
    } finally { await page.close(); }
  });
}
