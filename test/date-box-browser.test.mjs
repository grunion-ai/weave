/* A date box is as wide as the date it shows (Issue #159).
   Kyle, 2026-09-03, on the uno Task table: "lock ordinal dates cut off".
   The date input was a fixed 120px (compact) / 200px box, and a costume like
   ordinal — "Wednesday 3rd September 2026" — is longer than either, so the
   value was clipped inside its own control. The box now measures its text.
   Playwright is NOT a dependency of weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let table, row, log, logged;
const s = await launch('date box width', (weave) => {
  weave.createSpace({ name: 'Product' });
  table = weave.createTable({ space: 'Product', name: 'Task' });
  weave.addField(table, { name: 'Lock', type: 'date', config: { format: 'ordinal' } });
  weave.addField(table, { name: 'Due', type: 'date', config: { format: 'iso' } });
  row = weave.createEntity(table, { name: 'Sized', values: { Lock: '2026-09-30', Due: '2026-09-30' } });
  // Issue #217: a Created date that carries its time, beside enough other
  // columns that the grid has to share the width out.
  log = weave.createTable({ space: 'Product', name: 'Log' });
  weave.addField(log, { name: 'Created', type: 'date', config: { time: true } });
  for (const n of ['Owner', 'Area', 'Notes']) weave.addField(log, { name: n, type: 'text' });
  logged = weave.createEntity(log, { name: 'Stamped', values: {
    Created: '2026-09-07T13:45', Owner: 'Kyle',
    Notes: 'Replayed from the header trace: the grip commits a width, then the cell is read again',
  } });
});

if (s) {
  const { base, browser, weave } = s;
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
    const cut = await page.$$eval('input.date-text', (is) => is.map((i) => ({ v: i.value, cut: i.scrollWidth - i.clientWidth })));
    const lock = cut.find((c) => /30th/.test(c.v));
    assert.ok(lock, 'the ordinal date is on the page');
    assert.ok(lock.cut <= 1, `nothing is cut off (${lock.cut}px hidden)`);
    await page.close();
  });
}

/* Issue #217, Kyle 2026-09-07 on v0.4.8 at 1992×1129 in Safari: "created date
   time cut off even when there is space". His trace writes the Created field
   from its header (a drag of the grip commits a width that way) and then
   clicks a Created cell still marked clipped. On that build the date box was the
   fixed 120px of Issue #159, so a wider column could not show more of it;
   #159 sizes the box to its text, which fixed the cut itself, and Feature
   #233 floors a date column at its format's longest date, so no drag puts
   the Created column under its date any more. What was left is the marker:
   a column resize paints the width in place and never asked the cells
   again, so a cell clipped before a widening kept its ⤢ and its hover
   expansion over a value that now shows whole, and a narrowing left a
   genuinely cut value unmarked until the next redraw. The date column cannot
   be narrowed under its value, so the marker cases use a text column, which
   the same commit re-marks. Every width here is read off the page, never a
   fixed px, so a machine without Inter (a Linux box falls back to DejaVu
   Sans, which is wider) still tests the property. */
if (s) {
  const { base, browser, weave } = s;
  const view = () => weave.tableView(log.id).views[0];
  const setWidths = (widths) => weave.tableView(`${log.id}/${view().id}`, { widths });
  // A column's cell in the logged row against its own column: the value's
  // control, the cell, and whether the grid says the cell is hiding something.
  const cell = (page, name) => page.evaluate(([id, name]) => {
    const th = document.querySelector(`table.wv-grid th.col-head[data-col="${name}"]`);
    const td = document.querySelector(`tr[data-eid="${id}"]`).children[[...th.parentElement.children].indexOf(th)];
    const input = td.querySelector('input');
    const box = input.getBoundingClientRect();
    const c = td.getBoundingClientRect();
    return {
      value: input.value,
      column: Math.round(c.width),
      box: Math.round(box.width),
      hidden: input.scrollWidth - input.clientWidth,
      inside: box.right <= c.right + 0.5,
      clipped: td.classList.contains('clipped'),
    };
  }, [logged.id, name]);

  async function open(theme, widths = null) {
    if (widths) setWidths(widths);
    const page = await browser.newPage({ viewport: { width: 1992, height: 1129 } });
    await page.goto(`${base}/#/table/${log.id}`, { waitUntil: 'networkidle' });
    await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForSelector(`tr[data-eid="${logged.id}"] input.date-text`);
    // The box measures itself in a rAF, the marker in the next one.
    await page.waitForTimeout(300);
    return page;
  }

  // Drag a column's grip by dx and wait for the release's commit: the view
  // has the width once the PATCH answers, and the page has committed it once
  // the answer is read, which two frames later it has. A drag that ends
  // where it started (a column held at its floor) commits nothing.
  async function drag(page, name, dx, { commits = true } = {}) {
    const locator = page.locator(`table.wv-grid th.col-head[data-col="${name}"] .col-resize`);
    await locator.scrollIntoViewIfNeeded();
    const grip = await locator.boundingBox();
    const y = grip.y + grip.height / 2;
    await page.mouse.move(grip.x + grip.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2 + dx, y, { steps: 6 });
    const stored = commits && page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/views\//.test(r.url()));
    await page.mouse.up();
    if (stored) await stored;
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }

  for (const theme of ['light', 'dark']) {
    test(`a Created date with its time shows whole in a column with room (${theme})`, async () => {
      const page = await open(theme);
      try {
        const c = await cell(page, 'Created');
        assert.match(c.value, /2026.*\d:\d\d/, `the date carries its time (${c.value})`);
        assert.ok(c.column > c.box, `the column has room (${c.column}px column, ${c.box}px box)`);
        assert.ok(c.hidden <= 1, `nothing is cut off inside the box (${c.hidden}px hidden)`);
        assert.ok(c.inside, 'the box ends inside its cell');
        assert.equal(c.clipped, false, 'a date with room is not marked clipped');
      } finally { await page.close(); }
    });

    test(`a drag cannot put the Created column under its date, and it stays unmarked (${theme})`, async () => {
      const page = await open(theme);
      try {
        const before = await cell(page, 'Created');
        await drag(page, 'Created', -before.column, { commits: false });
        const after = await cell(page, 'Created');
        assert.ok(after.inside && after.hidden <= 1, `the date still shows whole (${after.box}px box in a ${after.column}px column, ${after.hidden}px hidden)`);
        assert.equal(after.clipped, false, 'and the cell does not claim to be cut off');
      } finally { await page.close(); }
    });

    test(`widening a clipped column past its value takes the clipped marker off (${theme})`, async () => {
      const page = await open(theme, { Notes: 120 });
      try {
        const before = await cell(page, 'Notes');
        assert.ok(before.hidden > 1, `the fixture starts cut off (${before.hidden}px hidden in a ${before.column}px column)`);
        assert.equal(before.clipped, true, 'and says so');
        await drag(page, 'Notes', before.hidden + 80);
        const after = await cell(page, 'Notes');
        assert.ok(after.hidden <= 1, `the value now shows whole (${after.hidden}px hidden in a ${after.column}px column)`);
        assert.equal(after.clipped, false, 'and the cell no longer claims to be cut off');
      } finally { await page.close(); }
    });

    test(`narrowing a column under its value puts the marker back (${theme})`, async () => {
      const page = await open(theme, { Notes: 900 });
      try {
        const before = await cell(page, 'Notes');
        assert.ok(before.hidden <= 1, `the fixture starts with room (${before.hidden}px hidden)`);
        assert.equal(before.clipped, false, 'and is not marked');
        await drag(page, 'Notes', -(before.column - 120));
        const after = await cell(page, 'Notes');
        assert.ok(after.hidden > 1, `the column really narrowed under the value (${after.hidden}px hidden in a ${after.column}px column)`);
        assert.equal(after.clipped, true, 'a value the column cuts off says so');
      } finally { await page.close(); }
    });
  }
}
