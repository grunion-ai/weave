/* Opening a table raises no ResizeObserver loop error (Issue #464).

   WebKit reports "ResizeObserver loop completed with undelivered
   notifications." as a window `error` event when an observer callback keeps
   changing the size of what it observes. The grid's `fitWatch` did exactly
   that: it toggles `wv-grid-scroll` on the wrap it observes, and that class
   resizes the wrap. The bug recorder listens on `error`, so every Safari
   reader who opened a table before filing a report carried an error in the
   trace that the reader never caused.

   Chromium raises nothing on these pages, so the case is pinned to WebKit
   (same reason as Issue #546). The grid has to be wider than its card for
   `wv-grid-scroll` to come on at all, which is what the narrow viewport and
   the ten fields are for. */
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
  /* The same listener the bug recorder installs (app.js `addEventListener`
     on 'error'), read from the page afterwards: what this collects is what
     the recorder would have filed as `kind: 'error'`. */
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
    // The wrap must be the scrolling one, or the loop this guards never had
    // a chance to fire.
    await page.waitForSelector('.table-wrap.wv-grid-scroll');
    // The loop was measured about 870 ms after navigation (Issue #464), so
    // the window is longer than that: this read is about an error arriving,
    // not about a style settling.
    await page.waitForTimeout(2000);
    const recorded = await page.evaluate(() => globalThis.__wvErrors ?? []);
    assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(' | ')}`);
    assert.deepEqual(recorded, [], `window errors the recorder would file: ${recorded.join(' | ')}`);
    await page.close();
  });

  /* A resized window re-runs the callback with the classes already on. */
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
