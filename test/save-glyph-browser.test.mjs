import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage, styleOf } from './lib/browser.mjs';

let orders, order;
const s = await launch('save glyph', (weave) => {
  weave.createSpace({ name: 'Ops' });
  orders = weave.createTable({ space: 'Ops', name: 'Order' });
  weave.addField(orders, { name: 'Note', type: 'text' });
  order = weave.createEntity(orders, { name: 'Sensor boards' });
});

const GLYPH = '#main .view-header .crumb-row > .save-glyph';

const arm = (page) => page.evaluate(() => {
  window.__sent = [];
  window.__down = 0;
  window.__job = (value) => window.weaveSaves.push({
    key: `test:${value}`, value,
    send: async (j) => {
      if (window.__down > 0) {
        window.__down--;
        throw Object.assign(new Error('Could not reach the server; nothing was saved'), { code: 'offline' });
      }
      window.__sent.push({ value: j.value, at: performance.now() });
      return { ok: true };
    },
  });
});
const glyph = (page) => page.evaluate(() => {
  const b = document.querySelector('.save-glyph');
  return b && { hidden: b.hidden, state: b.dataset.state, label: b.getAttribute('aria-label') };
});

if (s) {
  const { base, browser } = s;
  const open = async (o = {}, make = (opts) => browser.newPage({ viewport: { width: 1400, height: 900 }, ...opts })) => {
    const page = await make(o);
    await page.goto(`${base}/#/table/${orders.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    await arm(page);
    return page;
  };

  test('the save glyph is hidden while nothing is waiting (Feature #217)', async () => {
    const page = await open();
    try {
      assert.equal((await glyph(page))?.hidden ?? true, true);
      assert.equal(await page.locator('.save-glyph:visible').count(), 0);
    } finally { await page.close(); }
  });

  test('a pending save shows a clock top right of the header, then a tick for two seconds, then nothing (Feature #217)', async () => {
    const page = await open();
    try {
      const t0 = await page.evaluate(() => { window.__job('a'); return performance.now(); });
      await page.waitForSelector(`${GLYPH}[data-state="pending"]:not([hidden])`);
      const g = await glyph(page);
      assert.match(g.label, /^Saving 1 change\. Save now$/, 'it says what is waiting and what a tap does');
      assert.match(await page.locator(GLYPH).innerHTML(), /clock/, 'a clock');
      const right = await page.evaluate(() => {
        const row = document.querySelector('#main .view-header .crumb-row');
        const mark = row.querySelector(':scope > .save-glyph').getBoundingClientRect();
        const others = [...row.children].filter((n) => !n.matches('.save-glyph, .dl-wrap') && n.getClientRects().length);
        return { mark: mark.right, others: Math.max(...others.map((n) => n.getBoundingClientRect().right)), row: row.getBoundingClientRect().right };
      });
      assert.ok(right.mark >= right.others && right.row - right.mark < 48, `right of every header control, beside the menu at the edge (${JSON.stringify(right)})`);
      await page.waitForSelector(`${GLYPH}[data-state="saved"]:not([hidden])`);
      assert.equal(await page.locator(GLYPH).getAttribute('aria-label'), 'All changes saved');
      assert.match(await page.locator(GLYPH).innerHTML(), /check/, 'a tick');
      const sent = await page.evaluate(() => window.__sent[0].at);
      assert.ok(sent - t0 >= 550, `the write waited out the debounce (${Math.round(sent - t0)} ms)`);
      await page.waitForSelector(`${GLYPH}[hidden]`, { state: 'attached' });
      const gone = await page.evaluate(() => performance.now());
      assert.ok(gone - sent >= 1900, `the tick showed for two seconds (${Math.round(gone - sent)} ms)`);
    } finally { await page.close(); }
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`a save that fails twice turns the glyph red; a tap sends it again and it lands (${colorScheme}, Feature #217)`, async () => {
      const page = await open({ colorScheme });
      try {
        await page.evaluate(() => { window.__down = 2; window.__job('kept'); });
        await page.waitForSelector(`${GLYPH}[data-state="failed"]:not([hidden])`);
        assert.equal(await page.locator(GLYPH).getAttribute('aria-label'), '1 change not saved. Try again');
        const danger = await page.evaluate(() => {
          const probe = document.createElement('span');
          probe.style.color = 'var(--tblr-danger)';
          document.querySelector('#main').append(probe);
          const c = getComputedStyle(probe).color;
          probe.remove();
          return c;
        });
        assert.equal(await styleOf(page.locator(GLYPH), 'color', danger), danger, 'red');
        assert.deepEqual(await page.evaluate(() => window.__sent.length), 0);
        await page.click(GLYPH);
        await page.waitForSelector(`${GLYPH}[data-state="saved"]`);
        assert.deepEqual(await page.evaluate(() => window.__sent.map((x) => x.value)), ['kept']);
      } finally { await page.close(); }
    });
  }

  test('the glyph stays in the header when the page under it redraws (Feature #217)', async () => {
    const page = await open();
    try {
      await page.evaluate(() => {
        window.__slow = new Promise((r) => { window.__release = r; });
        window.weaveSaves.push({ key: 'test:slow', value: 'slow', send: () => window.__slow });
        window.weaveSaves.flush();
      });
      await page.waitForSelector(`${GLYPH}[data-state="pending"]`);
      await page.evaluate((id) => { location.hash = `#/entity/${id}`; }, order.id);
      await page.waitForSelector('#main .view-header .entity-head');
      await page.waitForSelector(`${GLYPH}[data-state="pending"]:not([hidden])`);
      await page.evaluate(() => window.__release({ ok: true }));
      await page.waitForSelector(`${GLYPH}[data-state="saved"]`);
    } finally { await page.close(); }
  });

  test('Escape sends a waiting save at once (Feature #217)', async () => {
    const page = await open();
    try {
      const t0 = await page.evaluate(() => { window.__job('esc'); return performance.now(); });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.__sent.length === 1);
      const at = await page.evaluate(() => window.__sent[0].at);
      assert.ok(at - t0 < 500, `Escape did not wait for the debounce (${Math.round(at - t0)} ms)`);
    } finally { await page.close(); }
  });

  test('a tap on the clock sends a waiting save at once (Feature #217)', async () => {
    const page = await open();
    try {
      const t0 = await page.evaluate(() => { window.__job('tap'); return performance.now(); });
      await page.click(GLYPH);
      await page.waitForFunction(() => window.__sent.length === 1);
      const at = await page.evaluate(() => window.__sent[0].at);
      assert.ok(at - t0 < 500, `the tap did not wait for the debounce (${Math.round(at - t0)} ms)`);
    } finally { await page.close(); }
  });

  test('on a phone the glyph is a 44 px target with its name (Feature #217)', async () => {
    const phone = await phoneBrowser();
    const page = await open({}, phone ? (o) => phonePage(phone, o) : (o) => browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, ...o }));
    try {
      await page.evaluate(() => { window.__down = 99; window.__job('phone'); });
      const sel = '.save-glyph[data-state="failed"]:not([hidden])';
      await page.waitForSelector(sel);
      const box = await page.locator(sel).boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44, `44 px target (${box.width} x ${box.height})`);
      assert.equal(await page.locator(sel).getAttribute('aria-label'), '1 change not saved. Try again');
    } finally { await page.close(); }
  });
}
