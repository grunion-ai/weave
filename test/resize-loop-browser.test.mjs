import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const FIELDS = [
  ['Status', 'select', { options: ['Open', 'Done'] }],
  ['Owner', 'text'],
  ['Reviewer', 'text'],
  ['Due', 'date'],
  ['Points', 'number'],
  ['Price', 'number', { currency: 'USD' }],
  ['Done', 'checkbox'],
  ['Link', 'url'],
  ['Approved by finance', 'checkbox'],
  ['Notes for the next reader', 'text'],
];

const ids = {};
const s = await launch('resize observer loop', (weave) => {
  weave.createSpace({ name: 'Loop' });
  const db = weave.createTable({ space: 'Loop', name: 'Task' });
  for (const [name, type, config] of FIELDS) weave.addField(db, { name, type, ...(config ? { config } : {}) });
  for (let i = 0; i < 30; i++) {
    weave.createEntity(db, { name: `Row ${i}`, values: { Owner: 'Sam', Reviewer: 'Ada', Points: i, Price: i * 10, Link: 'https://example.com' } });
  }
  ids.db = db.id;
}, { engine: 'webkit' });

if (s) {
  const { base, browser } = s;
  const COLLECT = () => {
    globalThis.__wvErrors = [];
    addEventListener('error', (e) => globalThis.__wvErrors.push(String(e.message ?? e.error?.message ?? 'error')));
  };

  test('opening a grid wider than its card raises no window error', async () => {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e.message ?? e)));
    await page.addInitScript(COLLECT);
    await page.goto(`${base}/#/table/${ids.db}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await page.waitForSelector('.table-wrap.wv-grid-scroll');
    await page.waitForTimeout(2000);
    const recorded = await page.evaluate(() => globalThis.__wvErrors ?? []);
    assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`);
    assert.deepEqual(recorded, [], `window errors the recorder would file: ${recorded.join(' | ')}`);
    await page.close();
  });

  test('resizing the window raises no window error', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e.message ?? e)));
    await page.addInitScript(COLLECT);
    await page.goto(`${base}/#/table/${ids.db}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    for (const width of [700, 1300, 820]) await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(1500);
    const recorded = await page.evaluate(() => globalThis.__wvErrors ?? []);
    assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`);
    assert.deepEqual(recorded, [], `window errors the recorder would file: ${recorded.join(' | ')}`);
    await page.close();
  });
}
