import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const FIELDS = [
  ['Severity', 'select', { options: ['Low', 'Medium', 'High'] }],
  ['Status', 'select', { options: ['Open', 'Fixed'] }],
  ['Symptom', 'select', { options: ['Slow', 'Looks broken', 'Wrong data', 'Error'] }],
  ['Area', 'text'],
  ['Reporter', 'text'],
  ['Filed', 'date'],
  ['Points', 'number'],
  ['Link', 'url'],
  ['Confirmed', 'checkbox'],
];

let n = 0;
const s = await launch('grid scroll edge', (weave) => {
  weave.createSpace({ name: 'Development' });
});
if (s) {
  const { base, browser, weave } = s;
  const issueTable = ({ frozen = 0 } = {}) => {
    const db = weave.createTable({ space: 'Development', name: `Issue ${++n}` });
    for (const [name, type, config] of FIELDS) weave.addField(db, { name, type, ...(config ? { config } : {}) });
    for (let i = 0; i < 8; i++) {
      weave.createEntity(db, { name: `Looks broken: row ${i}`, values: { Severity: 'Medium', Status: 'Open', Area: 'Grid', Reporter: 'Kyle', Points: i, Link: 'https://example.com' } });
    }
    if (frozen) weave.tableView(`${db.id}/${weave.tableView(db.id).views[0].id}`, { frozen });
    return db;
  };
  const openGrid = async (db) => {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 });
    await page.goto(`${base}/#/table/${db.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    return page;
  };
  const edges = (page, selectors) => page.evaluate((sels) => {
    const wrap = document.querySelector('.table-wrap');
    const out = { scrolled: wrap.classList.contains('wv-scrolled-x') };
    for (const [key, sel] of Object.entries(sels)) {
      const cell = document.querySelector(sel);
      const border = getComputedStyle(cell).borderRightColor;
      const before = getComputedStyle(cell, '::before');
      const drawn = before.content !== 'none' && Number(before.opacity) > 0 && before.backgroundColor !== 'rgba(0, 0, 0, 0)';
      out[key] = drawn || !/rgba\(0, 0, 0, 0\)|transparent/.test(border);
    }
    return out;
  }, selectors);
  const frame = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const scrollTo = async (page, x) => {
    await page.evaluate((v) => { document.querySelector('.table-wrap').scrollLeft = v; }, x);
    await frame(page);
  };
  const settleAt = async (page, x) => {
    await page.evaluate((v) => {
      const wrap = document.querySelector('.table-wrap');
      Object.defineProperty(wrap, 'scrollLeft', { configurable: true, get: () => v, set() {} });
      wrap.dispatchEvent(new Event('scroll'));
    }, x);
    await frame(page);
  };
  const release = (page) => page.evaluate(() => { delete document.querySelector('.table-wrap').scrollLeft; });

  const PID = {
    head: '.wv-grid thead th.pid-head',
    cell: '.wv-grid tbody tr.entity-row td.pid-cell',
  };

  test('the # edge shows only while the grid sits scrolled, and clears at a fractional left edge (Issue #1031)', async () => {
    const page = await openGrid(issueTable());
    try {
      assert.deepEqual(await edges(page, PID), { scrolled: false, head: false, cell: false }, 'at rest nothing paints beside #');
      await scrollTo(page, 300);
      const wide = await page.evaluate(() => document.querySelector('.table-wrap').scrollLeft);
      assert.ok(wide > 100, `the grid scrolls sideways (${wide})`);
      assert.deepEqual(await edges(page, PID), { scrolled: true, head: true, cell: true }, 'scrolled right, the # column draws its edge');
      await scrollTo(page, 0.4);
      const real = await page.evaluate(() => document.querySelector('.table-wrap').scrollLeft);
      assert.ok(real < 1, `a 0.4 scroll lands at the left edge (${real})`);
      assert.deepEqual(await edges(page, PID), { scrolled: false, head: false, cell: false }, `back at ${real} the edge is gone`);
      await scrollTo(page, 300);
      await settleAt(page, 0.4);
      assert.deepEqual(await edges(page, PID), { scrolled: false, head: false, cell: false }, 'a momentum settle at 0.4 clears the edge');
      await release(page);
      await scrollTo(page, 0);
      assert.deepEqual(await edges(page, PID), { scrolled: false, head: false, cell: false }, 'at 0 the edge is gone');
    } finally { await page.close(); }
  });

  test('with a frozen field the edge moves to the last frozen cell and clears the same way (Issue #1031)', async () => {
    const page = await openGrid(issueTable({ frozen: 1 }));
    try {
      const sels = {
        ...PID,
        frozenHead: '.wv-grid thead th[data-col="Name"]',
        frozenCell: '.wv-grid tbody tr.entity-row td[data-field="Name"]',
      };
      const none = { scrolled: false, head: false, cell: false, frozenHead: false, frozenCell: false };
      assert.deepEqual(await edges(page, sels), none, 'at rest nothing paints beside # or Name');
      await scrollTo(page, 300);
      assert.deepEqual(await edges(page, sels), { scrolled: true, head: false, cell: false, frozenHead: true, frozenCell: true },
        'scrolled right, the edge sits on the frozen field and not on #');
      await settleAt(page, 0.4);
      assert.deepEqual(await edges(page, sels), none, 'a momentum settle at 0.4 clears it');
      await release(page);
      await scrollTo(page, 0);
      assert.deepEqual(await edges(page, sels), none, 'at 0 it is gone');
    } finally { await page.close(); }
  });

  test('the edge is drawn by an overlay on the sticky cell, never by recolouring its border (Issue #1031)', async () => {
    const page = await openGrid(issueTable({ frozen: 1 }));
    try {
      const read = () => page.evaluate(() => [
        document.querySelector('.wv-grid tbody tr.entity-row td.pid-cell'),
        document.querySelector('.wv-grid thead th.pid-head'),
        document.querySelector('.wv-grid tbody tr.entity-row td[data-field="Name"]'),
        document.querySelector('.wv-grid thead th[data-col="Name"]'),
      ].map((c) => getComputedStyle(c).borderRightColor));
      const rest = await read();
      await scrollTo(page, 300);
      assert.deepEqual(await read(), rest, 'scrolling leaves every sticky border colour as it was');
      const edge = await page.evaluate(() => {
        const cell = document.querySelector('.wv-grid tbody tr.entity-row td[data-field="Name"]');
        const b = getComputedStyle(cell, '::before');
        const probe = document.createElement('div');
        probe.style.color = 'var(--tblr-border-color)';
        document.body.append(probe);
        const want = getComputedStyle(probe).color;
        probe.remove();
        return { bg: b.backgroundColor, want, width: b.width, position: b.position, events: b.pointerEvents };
      });
      assert.equal(edge.bg, edge.want, 'the overlay takes the border colour');
      assert.equal(edge.width, '1px', 'and is one pixel wide');
      assert.equal(edge.position, 'absolute', 'and takes no room in the row');
      assert.equal(edge.events, 'none', 'and never catches a click');
    } finally { await page.close(); }
  });
}
