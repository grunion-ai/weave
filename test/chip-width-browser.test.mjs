/* No control of fixed shape is cut by a field resize (Issue #614). Kyle,
   2026-10-03: "make sure no part of the toggle or box can be cut off by
   field resize." Before, a select, a multi-select, a state and a rating
   floored at their header label only, so a State column dragged under a
   "Setup incomplete" chip cut it mid-word. Asserted here on the rendered
   grid:
     - a drag, three keyboard nudges and a double-click fit stop where the
       widest chip (a multi-select: one chip and its +N count) or every
       rating icon still shows whole, and no further;
     - the floor is the widest OPTION, not the widest value on screen, and
       an option added later raises it;
     - a stored width under the floor is raised to it, while free text keeps
       a narrow width and truncates;
     - a checkbox column at its label floor still holds its whole box;
     - no other column's width moves (Feature #233, rule 2).
   The toggle's floor (Issue #586) is held by test/toggle-width-browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, settled, eventually } from './lib/browser.mjs';

await import('../public/column-resize.js');
const CR = globalThis.WeaveColumnResize;

const LONG_STATE = 'Setup incomplete';
const LONG_KIND = 'Waiting on the upstream vendor';
const LONGER_KIND = 'Blocked until the auditor signs the report';
const LONG_TAG = 'Waiting on the vendor';
const SECOND_TAG = 'Second in line';
let n = 0;
const s = await launch('chip column floor', (weave) => {
  weave.createSpace({ name: 'Chips' });
});

if (s) {
  const { base, browser, weave } = s;
  const ownTable = () => {
    const db = weave.createTable({ space: 'Chips', name: `Chips ${++n}` });
    weave.addField(db, {
      name: 'State', type: 'workflow',
      config: { states: [{ name: 'Open', category: 'not-started', default: true }, { name: LONG_STATE, category: 'in-progress' }, { name: 'Done', category: 'done' }] },
    });
    weave.addField(db, { name: 'Kind', type: 'select', config: { options: ['A', 'B', LONG_KIND] } });
    weave.addField(db, { name: 'Tags', type: 'multiselect', config: { options: ['x', LONG_TAG, 'y', SECOND_TAG] } });
    weave.addField(db, { name: 'Fit', type: 'rating', config: { max: 7 } });
    weave.addField(db, { name: 'Ok', type: 'checkbox' });
    weave.addField(db, { name: 'Note', type: 'text' });
    const lit = weave.createEntity(db, { name: 'Lit', values: { Kind: 'A', Tags: [LONG_TAG, SECOND_TAG, 'x'], Fit: 7, Ok: true, Note: 'a note far too long for a narrow column to show whole' } });
    weave.createEntity(db, { name: 'Dark', values: { Kind: 'B', Tags: ['x', 'y', LONG_TAG], Note: 'b' } });
    weave.setState(lit.id, 'State', LONG_STATE);
    return { db, lit };
  };
  const openGrid = async (db) => {
    const page = await browser.newPage({ viewport: { width: 2200, height: 900 } });
    await page.goto(`${base}/#/table/${db.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row td[data-field="State"] .k');
    await page.evaluate(() => document.fonts.ready);
    await settled(page.locator('.wv-grid'));
    return page;
  };
  const head = (page, name) => page.locator(`.wv-grid thead th.col-head[data-col="${name}"]`);
  const widths = (page) => page.$$eval('.wv-grid thead th.col-head', (hs) => Object.fromEntries(hs.map((h) => [h.dataset.col, h.getBoundingClientRect().width])));
  const sameWidths = (before, after, except, label) => {
    for (const [name, w] of Object.entries(before)) {
      if (name === except) continue;
      assert.ok(Math.abs(after[name] - w) <= 0.5, `${label}: ${name} kept its width (${w} → ${after[name]})`);
    }
  };
  /* What one column paints: its width, its header label's floor, and for
     each row the controls it shows — whether any is ellipsized or hangs past
     the cell's content edge, and the slack between the last one and that
     edge (how much narrower the column could have gone). */
  const read = (page, name) => page.evaluate((col) => {
    const th = document.querySelector(`.wv-grid thead th.col-head[data-col="${col}"]`);
    const hs = getComputedStyle(th);
    const label = Math.ceil(th.querySelector('.col-label').getBoundingClientRect().width + parseFloat(hs.paddingLeft) + parseFloat(hs.paddingRight));
    const rows = [...document.querySelectorAll(`.wv-grid tbody tr.entity-row td[data-field="${col}"]`)].map((td) => {
      const cs = getComputedStyle(td);
      const room = td.getBoundingClientRect().right - (parseFloat(cs.paddingRight) || 0) - (parseFloat(cs.borderRightWidth) || 0);
      const shown = [...td.querySelectorAll('.wv-cb .k, .wv-cb .wv-rate-ico, .wv-cb input[type="checkbox"]')]
        .filter((n) => n.getClientRects().length && !n.closest('[hidden]'));
      const right = Math.max(...shown.map((n) => n.getBoundingClientRect().right));
      return {
        texts: shown.map((n) => n.textContent.trim()).filter(Boolean),
        count: shown.length,
        ellipsized: shown.some((n) => n.scrollWidth > n.clientWidth + 0.5)
          || [...td.querySelectorAll('.wv-cb .k-label')].some((l) => !l.closest('[hidden]') && l.scrollWidth > l.clientWidth),
        fitOne: !!td.querySelector('.ms-box.wv-fit-one'),
        overhang: right - room,
        slack: room - right,
      };
    });
    return { width: th.getBoundingClientRect().width, label, rows };
  }, name);
  const whole = (got, name, label) => {
    for (const r of got.rows) {
      assert.ok(r.count > 0, `${label}: ${name} paints a control`);
      assert.equal(r.ellipsized, false, `${label}: ${name}'s ${JSON.stringify(r.texts)} is not ellipsized at ${got.width}px`);
      assert.equal(r.fitOne, false, `${label}: ${name}'s first chip is not shrunk to fit`);
      assert.ok(r.overhang <= 0.5, `${label}: ${name}'s ${JSON.stringify(r.texts)} ends inside the cell (${r.overhang}px over)`);
    }
  };
  // The tightest row is the one the floor was cut for: under 2px of slack.
  const tight = (got, name, label) => {
    const slack = Math.min(...got.rows.map((r) => r.slack));
    assert.ok(slack < 2, `${label}: ${name} stops at its widest control, not past it (${slack}px slack at ${got.width}px)`);
  };
  const dragLeft = async (page, name) => {
    const grip = await head(page, name).locator('.col-resize').boundingBox();
    const y = grip.y + grip.height / 2;
    await page.mouse.move(grip.x + grip.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(grip.x - 500, y, { steps: 6 });
    await page.mouse.up();
    await settled(page.locator('.wv-grid'));
  };

  test('a drag, a keyboard nudge and a double-click fit stop at the widest chip, the +N count or the last icon', async () => {
    const { db } = ownTable();
    const stored = (name) => weave.tableView(db.id).views[0].widths?.[name];
    const page = await openGrid(db);
    try {
      for (const name of ['State', 'Tags', 'Fit']) {
        let before = await widths(page);
        await dragLeft(page, name);
        let got = await read(page, name);
        const floor = Math.round(got.width);
        assert.ok(floor > got.label, `${name}: its value, not its label (${got.label}px), decides the floor (${floor}px)`);
        whole(got, name, 'after a drag');
        tight(got, name, 'after a drag');
        sameWidths(before, await widths(page), name, `${name} drag`);

        before = await widths(page);
        await head(page, name).focus();
        // A burst of nudges writes once, 350 ms after the last press.
        const nudged = page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/views\//.test(r.url()));
        for (let i = 0; i < 3; i++) await page.keyboard.press('Alt+ArrowLeft');
        await nudged;
        await settled(page.locator('.wv-grid'));
        got = await read(page, name);
        assert.equal(Math.round(got.width), floor, `${name}: Alt+← past the floor changes nothing`);
        whole(got, name, 'after a nudge');
        assert.equal(await eventually(() => stored(name), floor), floor, `${name}: the view stores the floor, not a width under it`);
        sameWidths(before, await widths(page), name, `${name} nudge`);

        before = await widths(page);
        await head(page, name).locator('.col-resize').dblclick();
        await settled(page.locator('.wv-grid'));
        got = await read(page, name);
        assert.ok(Math.round(got.width) >= floor, `${name}: a double-click fit never lands under the floor (${got.width} < ${floor})`);
        whole(got, name, 'after a fit');
        sameWidths(before, await widths(page), name, `${name} fit`);
      }
    } finally { await page.close(); }
  });

  test('a select floors at its widest option, shown or not, and an option added later raises it', async () => {
    const { db, lit } = ownTable();
    let page = await openGrid(db);
    let floor;
    try {
      const opened = Math.round((await read(page, 'Kind')).width);
      await dragLeft(page, 'Kind');
      const got = await read(page, 'Kind');
      floor = Math.round(got.width);
      assert.ok(floor > got.label, `Kind: "${LONG_KIND}", on no row yet, decides the floor (${floor}px over the label's ${got.label}px)`);
      assert.ok(floor > CR.DEFAULT_WIDTHS.select, `the long option needs more than the 124 default (${floor})`);
      assert.equal(opened, floor, 'Kind opened at its floor, the default raised by its own options only, so a drag left changes nothing');
      whole(got, 'Kind', 'after a drag');
    } finally { await page.close(); }

    // The long option on a row now: it opens at the same floor, whole, with
    // nothing to spare.
    weave.updateEntity(lit.id, { Kind: LONG_KIND });
    page = await openGrid(db);
    try {
      const got = await read(page, 'Kind');
      assert.equal(Math.round(got.width), floor, 'Kind opens at the floor it had before any row showed the long option');
      whole(got, 'Kind', 'with the long option shown');
      tight(got, 'Kind', 'with the long option shown');
    } finally { await page.close(); }

    weave.updateField(db.id, 'Kind', { config: { options: ['A', 'B', LONG_KIND, LONGER_KIND] } });
    weave.updateEntity(lit.id, { Kind: LONGER_KIND });
    page = await openGrid(db);
    try {
      const got = await read(page, 'Kind');
      assert.ok(Math.round(got.width) > floor, `an option added after the floor was stored raises it (${got.width} > ${floor})`);
      whole(got, 'Kind', 'with an option added');
      tight(got, 'Kind', 'with an option added');
    } finally { await page.close(); }
  });

  test('a stored width under the floor is raised for each chip and rating column; free text keeps its narrow width and truncates', async () => {
    const { db } = ownTable();
    const view = weave.tableView(db.id).views[0];
    weave.tableView(`${db.id}/${view.id}`, { widths: { State: 40, Kind: 40, Tags: 40, Fit: 40, Note: 40 } });
    const page = await openGrid(db);
    try {
      for (const name of ['State', 'Kind', 'Tags', 'Fit']) {
        const got = await read(page, name);
        assert.ok(Math.round(got.width) > got.label, `${name}: a stored 40px opens at the value floor (${got.width}px), past the label's`);
        whole(got, name, 'from a stored 40px');
      }
      const note = await page.evaluate(() => {
        const th = document.querySelector('.wv-grid thead th.col-head[data-col="Note"]');
        const hs = getComputedStyle(th);
        const input = document.querySelector('.wv-grid tbody tr.entity-row td[data-field="Note"] input');
        return {
          width: Math.round(th.getBoundingClientRect().width),
          label: Math.ceil(th.querySelector('.col-label').getBoundingClientRect().width + parseFloat(hs.paddingLeft) + parseFloat(hs.paddingRight)),
          cut: input.scrollWidth > input.clientWidth,
        };
      });
      assert.equal(note.width, Math.max(40, note.label), 'Note keeps its stored width (or its label\'s), never a value floor');
      assert.ok(note.cut, 'the long note truncates rather than widening its column');
    } finally { await page.close(); }
  });

  test('a checkbox column dragged to its label floor still holds its whole box', async () => {
    const { db } = ownTable();
    const page = await openGrid(db);
    try {
      const before = await widths(page);
      await dragLeft(page, 'Ok');
      const got = await read(page, 'Ok');
      assert.equal(Math.round(got.width), got.label, 'the label decides a checkbox floor: the box is narrower than any label');
      whole(got, 'Ok', 'after a drag');
      assert.ok(Math.min(...got.rows.map((r) => r.slack)) > 4, 'the box has room to spare at the floor');
      sameWidths(before, await widths(page), 'Ok', 'Ok drag');
    } finally { await page.close(); }
  });
}
