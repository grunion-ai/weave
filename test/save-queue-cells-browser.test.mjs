import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, settled } from './lib/browser.mjs';

const FIELDS = ['A', 'B', 'C', 'D'];
let orders, row, page2;
const s = await launch('cell and record edits go through the save queue', (weave) => {
  weave.createSpace({ name: 'Ops' });
  orders = weave.createTable({ space: 'Ops', name: 'Order' });
  for (const f of FIELDS) weave.addField(orders, { name: f, type: 'text' });
  weave.addField(orders, { name: 'Priority', type: 'select', config: { options: ['P0', 'P1', 'P2'] } });
  row = weave.createEntity(orders, { name: 'Sensor boards', values: Object.fromEntries(FIELDS.map((f) => [f, `${f.toLowerCase()}0`])) });
  page2 = weave.createEntity(orders, { name: 'Cables', values: { A: 'start' } });
});

if (s) {
  const { base, browser, weave } = s;
  const stored = (id, f) => weave.readEntity(id).fields[f];
  const reset = () => weave.updateEntity(row.id, Object.fromEntries(FIELDS.map((f) => [f, `${f.toLowerCase()}0`])));
  const cell = (id, f) => `tr[data-eid="${id}"] td[data-field="${f}"]`;
  const open = async (hash = `#/table/${orders.id}`) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.__patches = [];
    page.on('request', (r) => {
      if (r.method() === 'PATCH' && /\/api\/entities\/[^/]+$/.test(new URL(r.url()).pathname)) page.__patches.push(JSON.parse(r.postData() || '{}').values);
    });
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      window.__toasts = 0;
      window.__glyphs = 0;
      new MutationObserver(() => {
        window.__toasts = Math.max(window.__toasts, document.querySelectorAll('#wv-toasts .wv-toast').length);
        window.__glyphs = Math.max(window.__glyphs, [...document.querySelectorAll('.save-glyph')].filter((g) => !g.hidden).length);
      }).observe(document.body, { subtree: true, childList: true, attributes: true });
    });
    return page;
  };
  const edit = async (page, id, f, text) => {
    await page.click(`${cell(id, f)} .text-dressed`);
    await page.fill(`${cell(id, f)} input`, text);
    await page.keyboard.press('Tab');
  };
  const until = async (read, want, ms = 5000) => {
    const end = Date.now() + ms;
    while (read() !== want && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
    return read();
  };

  test('four quick cell edits show one glyph and no toast, land as four PATCHes in order, then the tick (Feature #217)', async () => {
    reset();
    const since = new Date().toISOString();
    const page = await open();
    try {
      await page.waitForSelector(`${cell(row.id, 'A')} .text-dressed`);
      for (const f of FIELDS) await edit(page, row.id, f, `${f.toLowerCase()}1`);
      await page.waitForSelector('.save-glyph[data-state="pending"]:not([hidden])');
      await page.waitForSelector('.save-glyph[data-state="saved"]:not([hidden])', { timeout: 10000 });
      assert.deepEqual(page.__patches, FIELDS.map((f) => ({ [f]: `${f.toLowerCase()}1` })), 'four PATCHes, one per cell, in the order they were made');
      assert.equal(await page.evaluate(() => window.__glyphs), 1, 'exactly one glyph showed');
      assert.equal(await page.evaluate(() => window.__toasts), 0, 'and no toast');
      for (const f of FIELDS) assert.equal(stored(row.id, f), `${f.toLowerCase()}1`);
      const log = weave.activityFeed({ entityId: row.id }).items
        .filter((a) => a.kind === 'field-updated' && a.ts >= since)
        .sort((a, b) => a.seq - b.seq)
        .map((a) => [a.detail.field, a.detail.from, a.detail.to]);
      assert.deepEqual(log, FIELDS.map((f) => [f, `${f.toLowerCase()}0`, `${f.toLowerCase()}1`]), 'the activity log reads one change per cell, in order');
    } finally { await page.close(); }
  });

  test('with the server unreachable an edit turns the glyph red; a tap once it answers lands the edit (Feature #217)', async () => {
    reset();
    const page = await open();
    try {
      await page.waitForSelector(`${cell(row.id, 'A')} .text-dressed`);
      let down = true;
      let refused = 0;
      await page.route(/\/api\/entities\/[^/]+$/, (route) => {
        if (down && route.request().method() === 'PATCH') { refused++; return route.abort('connectionrefused'); }
        return route.continue();
      });
      await edit(page, row.id, 'A', 'typed while down');
      await page.waitForSelector('.save-glyph[data-state="failed"]:not([hidden])', { timeout: 10000 });
      assert.equal(refused, 2, 'one try and one retry');
      const note = page.locator('#wv-toasts .wv-toast.err');
      await note.waitFor();
      await settled(note);
      assert.match(await note.locator('.wv-toast-msg').textContent(), /A was not saved: could not reach the server/, 'the error toast stays');
      assert.equal(await page.textContent(`${cell(row.id, 'A')} .text-dressed`), 'typed while down', 'the typed text stays in the cell');
      assert.equal(stored(row.id, 'A'), 'a0');
      down = false;
      await page.click('.save-glyph');
      assert.equal(await until(() => stored(row.id, 'A'), 'typed while down'), 'typed while down', 'the tap lands the edit');
      await page.waitForSelector('.save-glyph[data-state="saved"]');
    } finally { await page.close(); }
  });

  test('the page going hidden mid-edit lands the typed value within one second (Feature #217)', async () => {
    const page = await open(`#/entity/${page2.id}`);
    try {
      const row2 = `.fieldrow[data-field="A"]`;
      await page.click(`${row2} .text-dressed`);
      await page.fill(`${row2} input`, 'typed then hidden');
      assert.equal(await page.evaluate((q) => document.activeElement === document.querySelector(q), `${row2} input`), true, 'the field still holds focus, as iOS keeps it');
      const t0 = Date.now();
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      assert.equal(await until(() => stored(page2.id, 'A'), 'typed then hidden', 1000), 'typed then hidden');
      assert.ok(Date.now() - t0 <= 1000, `landed in ${Date.now() - t0} ms`);
    } finally { await page.close(); }
  });

  test('a record page field edit goes through the queue: one glyph, no toast (Feature #217)', async () => {
    const page = await open(`#/entity/${page2.id}`);
    try {
      const row2 = `.fieldrow[data-field="B"]`;
      await page.waitForSelector(`${row2} input`);
      await page.fill(`${row2} input`, 'on the page');
      await page.keyboard.press('Tab');
      await page.waitForSelector('#main .view-header .crumb-row > .save-glyph[data-state="pending"]');
      assert.equal(await until(() => stored(page2.id, 'B'), 'on the page'), 'on the page');
      await page.waitForSelector('.save-glyph[data-state="saved"]');
      assert.equal(await page.evaluate(() => window.__toasts), 0);
    } finally { await page.close(); }
  });

  test('a pick shows at once and survives a reload made before its write is due (Feature #217)', async () => {
    weave.updateEntity(page2.id, { Priority: 'P0' });
    const page = await open(`#/entity/${page2.id}`);
    try {
      const row2 = page.locator('.entity-fields .fieldrow', { hasText: 'Priority' }).first();
      await row2.locator('.chip-trigger').click();
      await page.locator('.chip-pop .picker-row', { hasText: 'P2' }).click();
      assert.match(await row2.locator('.chip-trigger').textContent(), /P2/, 'the chip shows the pick before any write');
      assert.deepEqual(page.__patches, [], 'and the write still waits in the queue');
      await page.reload({ waitUntil: 'networkidle' });
      assert.equal(await until(() => stored(page2.id, 'Priority'), 'P2', 1000), 'P2', 'leaving the page sent the pick');
      assert.match(await page.locator('.entity-fields .fieldrow', { hasText: 'Priority' }).first().locator('.chip-trigger').textContent(), /P2/, 'and the reloaded page shows it');
    } finally { await page.close(); }
  });

  test('Cmd-Z right after a cell edit undoes that edit, as before the queue (Feature #217)', async () => {
    reset();
    const page = await open();
    try {
      await page.waitForSelector(`${cell(row.id, 'C')} .text-dressed`);
      await edit(page, row.id, 'C', 'c-undo');
      await page.keyboard.press('ControlOrMeta+z');
      const note = page.locator('#wv-toasts .wv-toast', { hasText: 'Undone' });
      await note.waitFor();
      assert.equal(await until(() => stored(row.id, 'C'), 'c0'), 'c0', 'the edit just made is the one undone');
      assert.equal(stored(row.id, 'B'), 'b0', 'and nothing older');
    } finally { await page.close(); }
  });
}
