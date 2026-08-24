/* Double-click-to-fit on a column grip, driven through a real browser.
   Issue: "table resize double click does not snap to properly" (Kyle,
   2026-08-24). Grid cells clip (`max-width` + ellipsis) and hold <input>s
   whose intrinsic width is the browser's default box, not their value — so a
   fit measured with scrollWidth reads back the width the column already has
   and every double-click just adds the padding constant. Only a live browser
   can see that, so this suite is Playwright and skips when it is absent
   (house rule: zero runtime deps). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const chromium = await import('playwright')
  .then((pw) => pw.chromium)
  .catch(() => null);

if (!chromium) {
  test('column fit (browser)', { skip: 'playwright not installed' }, () => {});
} else {
  let server, base, browser, weave, db, wide;
  const LONG = 'Design the onboarding wizard end to end';

  test.before(async () => {
    weave = new Weave();
    weave.createSpace({ name: 'Scratch' });
    db = weave.createTable({ space: 'Scratch', name: 'Task' });
    weave.addField(db.id, { name: 'Owner', type: 'text' });
    weave.createEntity(db.id, { name: LONG, values: { Owner: 'Kyle' } });
    weave.createEntity(db.id, { name: 'Short', values: { Owner: 'Sam' } });
    // A grid wider than its card: auto table layout squeezes a bare `width`
    // away, which is where a resize or a fit visibly did nothing.
    wide = weave.createTable({ space: 'Scratch', name: 'Wide' });
    for (const n of ['B', 'C', 'D', 'E', 'F', 'G', 'H']) weave.addField(wide.id, { name: n, type: 'text' });
    const values = Object.fromEntries(['B', 'C', 'D', 'E', 'F', 'G', 'H']
      .map((n) => [n, `${n} — a value long enough to want its own column width`]));
    weave.createEntity(wide.id, { name: LONG, values });
    ({ server } = await startServer(weave, { port: 0 }));
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
  });

  test.after(async () => {
    await browser?.close();
    server?.close();
  });

  // Widths are per-field schema, so one test's fit is the next test's start
  // width. Every test opens on an unsized grid.
  function resetWidths() {
    const t = weave.getTable(db.id);
    for (const f of Object.values(t.fields)) weave.updateField(db.id, f.id, { config: { width: null } });
  }

  async function openGrid() {
    resetWidths();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${base}/#/table/${db.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('table.wv-grid th.col-head');
    return page;
  }

  // The header whose label matches, and its grip.
  const gripFor = (label) => `table.wv-grid th.col-head:has(.col-label:text-is("${label}")) .col-resize`;
  const headFor = (label) => `table.wv-grid th.col-head:has(.col-label:text-is("${label}"))`;

  test('double-click fits the column to the longest value, not to its own width', async () => {
    const page = await openGrid();
    try {
      const before = await page.locator(headFor('Name')).evaluate((th) => th.getBoundingClientRect().width);
      // What the value actually needs, measured the way the browser paints it.
      const needed = await page.locator(headFor('Name')).evaluate((th) => {
        const input = th.closest('table').querySelector('tbody tr td input.inline-edit');
        const cs = getComputedStyle(input);
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        return ctx.measureText(input.value).width;
      });
      await page.dblclick(gripFor('Name'));
      // A fit either grows or shrinks the column — what matters is that it
      // moves off the width the browser happened to hand out.
      await page.waitForFunction(
        (w) => [...document.querySelectorAll('th.col-head')]
          .some((th) => th.querySelector('.col-label')?.textContent === 'Name'
            && Math.abs(th.getBoundingClientRect().width - w) > 5),
        before, { timeout: 4000 });
      const after = await page.locator(headFor('Name')).evaluate((th) => th.getBoundingClientRect().width);
      assert.ok(after >= needed, `fit ${after}px must cover the ${Math.round(needed)}px value`);
      assert.ok(after < needed + 80, `fit ${after}px must not overshoot the ${Math.round(needed)}px value`);
      // Nothing is cut off any more: the value's own box no longer scrolls.
      const clipped = await page.locator(headFor('Name')).evaluate(() => {
        const input = document.querySelector('table.wv-grid tbody tr td input.inline-edit');
        return input.scrollWidth > input.clientWidth + 1;
      });
      assert.equal(clipped, false, 'the longest value must render unclipped after a fit');
    } finally { await page.close(); }
  });

  test('fitting twice lands on the same width — no per-click creep', async () => {
    const page = await openGrid();
    try {
      await page.dblclick(gripFor('Owner'));
      await page.waitForTimeout(250);
      const first = await page.locator(headFor('Owner')).evaluate((th) => Math.round(th.getBoundingClientRect().width));
      await page.dblclick(gripFor('Owner'));
      await page.waitForTimeout(250);
      const second = await page.locator(headFor('Owner')).evaluate((th) => Math.round(th.getBoundingClientRect().width));
      assert.ok(Math.abs(second - first) <= 2, `fit is idempotent, got ${first} then ${second}`);
    } finally { await page.close(); }
  });

  test('a fit holds in a grid wider than its card', async () => {
    const t = weave.getTable(wide.id);
    for (const f of Object.values(t.fields)) weave.updateField(wide.id, f.id, { config: { width: null } });
    const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
    try {
      await page.goto(`${base}/#/table/${wide.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('table.wv-grid th.col-head');
      const overflows = await page.evaluate(() => {
        const table = document.querySelector('table.wv-grid');
        return table.getBoundingClientRect().width > table.closest('.table-wrap').clientWidth;
      });
      assert.equal(overflows, true, 'the fixture must actually overflow, or it guards nothing');
      await page.dblclick(gripFor('C'));
      await page.waitForTimeout(400);
      const got = await page.locator(headFor('C')).evaluate((th) => ({
        rendered: Math.round(th.getBoundingClientRect().width),
        asked: Math.round(parseFloat(th.style.width) || 0),
      }));
      assert.ok(got.asked > 0, 'the fit was committed to the header');
      assert.ok(Math.abs(got.rendered - got.asked) <= 2,
        `the column must render the width it was given, asked ${got.asked}px, got ${got.rendered}px`);
    } finally { await page.close(); }
  });

  test('the fit is a schema write, so it survives a reload', async () => {
    const page = await openGrid();
    try {
      await page.dblclick(gripFor('Name'));
      await page.waitForTimeout(300);
      const width = weave.getTable(db.id).fields[weave.getTable(db.id).nameFieldId].config.width;
      assert.ok(width >= 200, `the measured fit reached the schema, got ${width}`);
    } finally { await page.close(); }
  });

  test('a full-width row (the "+ New" cell) never inflates a fit', async () => {
    const page = await openGrid();
    try {
      // The add-entity row spans the grid; measuring it would return the whole
      // table width for whichever column sits at its index.
      const span = await page.evaluate(() =>
        document.querySelector('table.wv-grid tr.add-entity-row td').colSpan);
      assert.ok(span > 1, 'the add row is a colspan cell');
      await page.dblclick(gripFor('Owner'));
      await page.waitForTimeout(250);
      const after = await page.locator(headFor('Owner')).evaluate((th) => th.getBoundingClientRect().width);
      assert.ok(after < 300, `a fit reads the column, not the table, got ${Math.round(after)}px`);
    } finally { await page.close(); }
  });
}
