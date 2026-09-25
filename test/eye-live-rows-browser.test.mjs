/* The eye's rows are taught, never swapped (Issue #240).

   A flip is asynchronous — PATCH, loadSchema, redraw, and only then the
   popover's tail. Idle, that tail is ~20ms; under load nothing bounds it, so
   it can land between the next gesture's mousedown and its mouseup. While the
   tail called `pop.replaceChildren`, the row the mousedown had focused was
   detached: the mouseup landed on its replacement, no `click` fired at all,
   the flip was lost with nothing on screen to say so, and focus fell to
   <body> — where the popover's own keydown listener could not hear Escape.
   showPopover's arrow-key walk broke the same way: it captures its row list
   once, at open, so a swap left every arrow pointing at a detached node.

   Kyle's 2026-09-02 ruling reads "same node, same position, same scroll —
   only its rows learn the new truth". These cases hold it literally: the
   nodes stay attached and learn the new switch state, and the rebuild is kept
   only for the case teaching cannot cover — a row set that actually changed.

   Playwright is NOT a dependency of weave (house rule: zero runtime deps);
   the suite skips when it is absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let deals, contacts, ann;
const s = await launch('eye rows are taught, not swapped', (weave) => {
  weave.createSpace({ name: 'Sales' });
  deals = weave.createTable({ space: 'Sales', name: 'Deal' });
  weave.addField(deals, { name: 'Amount', type: 'number' });
  weave.addField(deals, { name: 'Stage', type: 'text' });
  weave.createEntity(deals, { name: 'Acme', values: { Amount: 12 } });
  weave.createEntity(deals, { name: 'Globex', values: { Amount: 30 } });
  // The Σ row is off until a table opts in (Issue #249); this one wants it,
  // because the last case drives its picker.
  weave.updateTable(deals, { hideRollups: false });
  // A second table, for the cases where another surface or another page is
  // on screen when a flip's repaint lands (Issue #243).
  contacts = weave.createTable({ space: 'Sales', name: 'Contact' });
  weave.addField(contacts, { name: 'Phone', type: 'text' });
  ann = weave.createEntity(contacts, { name: 'Ann', values: { Phone: '555' } });
});

if (s) {
  const { base, browser, weave } = s;
  const hiddenNow = () => [...(weave.getTable(deals.id).hiddenFields ?? [])].sort();
  // Read one switch off the live popover. Hidden means the switch is off.
  const switchReads = ([name, want]) => [...document.querySelectorAll('.chip-pop .eye-row')]
    .find((r) => r.querySelector('.eye-label')?.textContent === name)
    ?.getAttribute('aria-checked') === want;
  const focusedLabel = () => document.activeElement?.querySelector?.('.eye-label')?.textContent ?? null;
  const until = async (ok, what) => {
    for (const t0 = Date.now(); !ok();) {
      if (Date.now() - t0 > 5000) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  const flip = (page, name) => page.locator('.chip-pop .eye-row', { hasText: name }).first().click();
  // Holds the first PATCH to `table` open until release(); later ones pass.
  const holdFirstPatch = async (page, table) => {
    let release, seen = 0;
    const held = new Promise((r) => { release = r; });
    await page.route(`**/api/tables/${table.id}`, async (route) => {
      if (route.request().method() === 'PATCH' && ++seen === 1) await held;
      await route.continue();
    });
    return { release, seen: () => seen };
  };
  const gridHeads = (page) => page.evaluate(() =>
    [...document.querySelectorAll('#main .wv-grid thead th')].map((th) => th.textContent));
  const open = async () => {
    // Every case starts from one hidden set: nothing hidden.
    weave.updateTable(deals, { hiddenFields: [] });
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'load' });
    await page.click('.eye-btn');
    await page.waitForSelector('.chip-pop .eye-row');
    return page;
  };

  test('a rebuild that lands mid-gesture does not swallow the click', async () => {
    const page = await open();
    // Stretch the flip's tail so it is certain to land while the next
    // gesture's button is still down — the race, made deterministic.
    await page.route('**/api/schema', async (route) => {
      await new Promise((r) => setTimeout(r, 700));
      await route.continue();
    });
    const stage = await page.locator('.chip-pop .eye-row', { hasText: 'Stage' }).first().boundingBox();
    await page.locator('.chip-pop .eye-row', { hasText: 'Amount' }).first().click();
    // Press on Stage while that tail is still in flight, and hold it down
    // across the whole round trip: PATCH, schema, redraw, rows.
    await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
    await page.mouse.down();
    await page.waitForFunction(switchReads, ['Amount', 'false']);
    await page.mouse.up();
    await page.waitForFunction(switchReads, ['Stage', 'false']);
    assert.deepEqual(hiddenNow(), ['Amount', 'Stage'], 'both flips reached the table');
    // Focus never left the popover, so its own keydown listener hears Escape.
    assert.ok(await page.evaluate(() => !!document.activeElement?.closest?.('.chip-pop')),
      'focus stayed inside the popover');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.chip-pop'));
    await page.close();
  });

  test('the rows stay the same nodes, and their handlers read the live table', async () => {
    const page = await open();
    // Stamp every row: a swap loses the stamps, teaching keeps them.
    const rowCount = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.chip-pop .eye-row')];
      rows.forEach((r, i) => { r.dataset.stamp = String(i); });
      return rows.length;
    });
    await page.locator('.chip-pop .eye-row', { hasText: 'Amount' }).first().click();
    await page.waitForFunction(switchReads, ['Amount', 'false']);
    assert.equal(
      await page.evaluate(() => document.querySelectorAll('.chip-pop .eye-row[data-stamp]').length),
      rowCount, 'every row is the node it was before the flip');
    // showPopover captures its arrow-key walk once, at open: swapped rows
    // leave those arrows pointing at detached nodes, so ArrowDown moves
    // nothing. The switch under the cursor is the pressed row.
    assert.equal(await page.evaluate(focusedLabel), 'Amount', 'the pressed row kept focus');
    await page.keyboard.press('ArrowDown');
    assert.notEqual(await page.evaluate(focusedLabel), 'Amount', 'ArrowDown still walks the rows');
    // A taught row keeps the handler it was built with, so that handler has
    // to read the table at click time — a set captured at build time is a
    // flip out of date and would drop Amount back out of the hidden set.
    await page.locator('.chip-pop .eye-row', { hasText: 'Stage' }).first().click();
    await page.waitForFunction(switchReads, ['Stage', 'false']);
    assert.deepEqual(hiddenNow(), ['Amount', 'Stage'], 'the second flip added to the hidden set');
    await page.close();
  });

  test('two flips that overlap both reach the table', async () => {
    // Reading the table at click time is half the fix; the other half is
    // WHEN (Issue #243). Every flip PATCHes the whole hidden set, so a
    // second flip that leaves while the first PATCH is still out reads the
    // same pre-flip set, and whichever write lands last wins. Holding the
    // first PATCH open makes the overlap certain rather than a load-only race.
    const page = await open();
    const patches = [];
    let release;
    const held = new Promise((r) => { release = r; });
    await page.route(`**/api/tables/${deals.id}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      patches.push(route.request().postDataJSON());
      if (patches.length === 1) await held;
      await route.continue();
    });
    // One grid draw is one row query.
    let draws = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith(`/api/tables/${deals.id}/query`)) draws++;
    });
    await page.locator('.chip-pop .eye-row', { hasText: 'Amount' }).first().click();
    await until(() => patches.length === 1, 'the first PATCH');
    await page.locator('.chip-pop .eye-row', { hasText: 'Stage' }).first().click();
    // Give a second PATCH every chance to leave beside the first.
    await page.waitForTimeout(400);
    assert.equal(patches.length, 1, 'the second flip is not on the wire while the first PATCH is out');
    release();
    await page.waitForFunction(switchReads, ['Amount', 'false']);
    await page.waitForFunction(switchReads, ['Stage', 'false']);
    assert.deepEqual(hiddenNow(), ['Amount', 'Stage'], 'neither flip overwrote the other');
    assert.deepEqual(patches.map((p) => p.hiddenFields), [['Amount'], ['Amount', 'Stage']],
      'the second flip read the table after the first one landed');
    // Painting is off the write queue, and a burst paints once at its end.
    assert.equal(draws, 1, 'the pair redrew the grid once');
    await page.close();
  });

  /* The repaint after a queued flip lands late, and by then the reader may
     have closed the eye and opened something else. It teaches the eye's rows
     to whatever popover is open only if that popover is an eye on the same
     table, and each eye brings its own rows: a column's ⋮ menu, or the other
     surface's eye, is not this one. */
  test("a late repaint leaves a column's ⋮ menu alone", async () => {
    const page = await open();
    const hold = await holdFirstPatch(page, deals);
    await flip(page, 'Amount');
    await until(() => hold.seen() === 1, 'the PATCH');
    // A second click on the eye closes it (Issue #320); the ⋮ opens its menu.
    await page.click('#main .eye-btn');
    await page.waitForFunction(() => !document.querySelector('.chip-pop'));
    await page.locator('#main .wv-grid thead th:has(.field-menu[aria-label="Configure field Stage"]) .field-menu').click({ force: true });
    await page.waitForSelector('.chip-pop');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.chip-pop .eye-row').length), 0, 'the ⋮ menu opened');
    hold.release();
    await page.waitForFunction(() => ![...document.querySelectorAll('#main .wv-grid thead th')].some((th) => th.textContent.includes('Amount')));
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.chip-pop .eye-row').length), 0,
      'the eye did not swap its switches into the ⋮ menu');
    await page.close();
  });

  test("a flip on one table still repaints when another table's eye flips behind it", async () => {
    // The write queue is shared, so the dock's flip waits behind the grid's;
    // "only the last flip paints" is judged per table, so the grid's flip
    // still redraws the grid.
    weave.updateTable(deals, { hiddenFields: [] });
    weave.updateTable(contacts, { hiddenFields: [] });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(`${base}/#/table/${deals.id}?e=${ann.id}`, { waitUntil: 'load' });
    await page.waitForSelector('#dock:not([hidden]) .name-edit');
    const hold = await holdFirstPatch(page, deals);
    await page.click('#main .eye-btn');
    await page.waitForSelector('.chip-pop .eye-row');
    await flip(page, 'Amount');
    await until(() => hold.seen() === 1, 'the PATCH');
    // The dock's eye opens its own popover in one click (Issue #320).
    await page.click('#dock .eye-btn');
    await page.waitForFunction(() => [...document.querySelectorAll('.chip-pop .eye-label')].some((l) => l.textContent === 'Phone'));
    await flip(page, 'Phone');
    hold.release();
    await until(() => (weave.getTable(contacts.id).hiddenFields ?? []).includes('Phone'), "the dock's write");
    const redrawn = await page.waitForFunction(() =>
      ![...document.querySelectorAll('#main .wv-grid thead th')].some((th) => th.textContent.includes('Amount')),
    null, { timeout: 5000 }).then(() => true, () => false);
    assert.ok(redrawn, 'the grid dropped the column its own flip hid');
    await page.close();
  });

  test('a late repaint does not draw its table over the page the reader moved to', async () => {
    weave.updateTable(contacts, { hiddenFields: [] });
    const page = await open();
    const hold = await holdFirstPatch(page, deals);
    await flip(page, 'Amount');
    await until(() => hold.seen() === 1, 'the PATCH');
    await page.evaluate((id) => { location.hash = `#/table/${id}`; }, contacts.id);
    await page.waitForFunction(() => [...document.querySelectorAll('#main .wv-grid thead th')].some((th) => th.textContent.includes('Phone')));
    hold.release();
    await until(() => hiddenNow().includes('Amount'), 'the write');
    await page.waitForTimeout(800);
    const heads = await gridHeads(page);
    assert.ok(heads.some((h) => h.includes('Phone')) && !heads.some((h) => h.includes('Stage')),
      `the page still shows Contact, not Deal (${heads.join(' | ')})`);
    await page.close();
  });

  test('a row set that actually changed still rebuilds, and focus follows the pressed row', async () => {
    const page = await open();
    // A field arriving from elsewhere is the one case teaching cannot cover.
    // The rebuild is right there — and Issue #223's focus restore is what
    // keeps Escape working across it.
    weave.addField(deals, { name: 'Owner', type: 'text' });
    await page.locator('.chip-pop .eye-row', { hasText: 'Amount' }).first().click();
    await page.waitForFunction(switchReads, ['Amount', 'false']);
    await page.waitForFunction(() => [...document.querySelectorAll('.chip-pop .eye-row')]
      .some((r) => r.querySelector('.eye-label')?.textContent === 'Owner'));
    assert.equal(await page.evaluate(focusedLabel), 'Amount',
      'focus followed the pressed row onto its replacement');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.chip-pop'));
    await page.close();
  });

  test('the Σ row picker holds its rows across a flip too', async () => {
    // Its tail is the same shape as the eye's — create or delete the rollup
    // field, then relearn the rows — so it wore the same hazard.
    weave.updateTable(deals, { hiddenFields: [] });
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.goto(`${base}/#/table/${deals.id}`, { waitUntil: 'load' });
    await page.waitForSelector('thead tr.wv-foot td.foot-cell[data-col="Amount"]');
    await page.click('thead tr.wv-foot td.foot-cell[data-col="Amount"]');
    await page.waitForSelector('.chip-pop .foot-row[data-agg="sum"]');
    const rowCount = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.chip-pop .foot-row')];
      rows.forEach((r, i) => { r.dataset.stamp = String(i); });
      return rows.length;
    });
    await page.click('.chip-pop .foot-row[data-agg="sum"]');
    await page.waitForFunction(() => document.querySelector('.chip-pop .foot-row[data-agg="sum"]')?.getAttribute('aria-checked') === 'true');
    assert.equal(
      await page.evaluate(() => document.querySelectorAll('.chip-pop .foot-row[data-stamp]').length),
      rowCount, 'every aggregate row is the node it was before the flip');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset?.agg), 'sum', 'the pressed row kept focus');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.chip-pop'));
    await page.close();
  });
}
