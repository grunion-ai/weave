import test from 'node:test';
import assert from 'node:assert/strict';
import { engineOf, eventually, launch } from './lib/browser.mjs';

let table, row, stamped;
const s = await launch('date box width', (weave) => {
  weave.createSpace({ name: 'Product' });
  table = weave.createTable({ space: 'Product', name: 'Task' });
  weave.addField(table, { name: 'Lock', type: 'date', config: { format: 'ordinal' } });
  weave.addField(table, { name: 'Due', type: 'date', config: { format: 'iso' } });
  weave.addField(table, { name: 'Created', type: 'date', config: { time: true, width: 192 } });
  row = weave.createEntity(table, { name: 'Sized', values: { Lock: '2026-09-30', Due: '2026-09-30' } });
  stamped = weave.createEntity(table, { name: 'Stamped', values: { Created: '2026-05-28T10:48' } });
});

if (s) {
  const { base, browser } = s;
  const boxes = (page) => page.evaluate((id) => {
    const tr = document.querySelector(`tr[data-eid="${id}"]`);
    const read = (f) => { const i = tr.querySelector(`td[data-field="${f}"] input.date-text`); return { value: i.value, cut: i.scrollWidth - i.clientWidth, width: i.getBoundingClientRect().width }; };
    return { lock: read('Lock'), due: read('Due') };
  }, row.id);

  test('an ordinal date shows whole in the grid; a short one keeps a short box', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(`tr[data-eid="${row.id}"] input.date-text`);
    await page.waitForTimeout(300);
    const b = await boxes(page);
    assert.match(b.lock.value, /30th/, 'the ordinal costume is on');
    assert.ok(b.lock.cut <= 1, `nothing is cut off (${b.lock.cut}px hidden in a ${Math.round(b.lock.width)}px box)`);
    assert.ok(b.lock.width > b.due.width + 40, `the long date got the wider box (${Math.round(b.lock.width)} vs ${Math.round(b.due.width)})`);
    await page.close();
  });

  test('the entity page sizes the same control the same way', async () => {
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${row.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('input.date-text');
    await page.waitForTimeout(300);
    const cut = await page.locator('input.date-text').evaluateAll((is) => is.map((i) => ({ v: i.value, cut: i.scrollWidth - i.clientWidth })));
    const lock = cut.find((c) => /30th/.test(c.v));
    assert.ok(lock, 'the ordinal date is on the page');
    assert.ok(lock.cut <= 1, `nothing is cut off (${lock.cut}px hidden)`);
    await page.close();
  });

  for (const engine of ['chromium', 'webkit']) {
    for (const theme of ['light', 'dark']) {
      test(`a stored column width never cuts the widest date and time short (${engine}, ${theme})`, async (t) => {
        const b = engine === 'chromium' ? browser : await engineOf(engine);
        if (!b) return t.skip(`${engine} is not installed`);
        const page = await b.newPage({ viewport: { width: 1992, height: 1129 } });
        await page.goto(`${base}/#/table/${table.id}`, { waitUntil: 'networkidle' });
        await page.evaluate((th) => document.documentElement.setAttribute('data-bs-theme', th), theme);
        const sel = `tr[data-eid="${stamped.id}"] td[data-field="Created"]`;
        await page.waitForSelector(`${sel} input.date-text`);
        const read = () => page.evaluate((s) => {
          const td = document.querySelector(s);
          const i = td.querySelector('input.date-text');
          return { value: i.value, cut: i.scrollWidth - i.clientWidth, td: Math.round(td.getBoundingClientRect().width), clipped: td.classList.contains('clipped') };
        }, sel);
        await eventually(async () => { const r = await read(); return r.cut <= 0 && !r.clipped; }, true, { timeout: 3000 });
        const got = await read();
        assert.match(got.value, /May 28, 2026 10:48/, 'the date and time are both on show');
        assert.ok(got.cut <= 0, `"${got.value}" loses ${got.cut}px in a ${got.td}px column`);
        assert.equal(got.clipped, false, 'the cell is not marked clipped');
        await page.close();
      });
    }
  }
}
