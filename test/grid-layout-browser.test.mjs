/* Field resize, reorder and freeze (Feature #233) — the half only a real
   browser can judge. Kyle approved the behaviour from a mockup (2026-09-25)
   and set four rules; each is asserted here against the rendered grid:

     1. a header label never truncates — measured off the header at the
        floor, for several field types, after a drag and a keyboard nudge;
     2. resizing, reordering, hiding, showing, adding or removing a field,
        and freezing or unfreezing one, never changes another field's width
        — every other column is read before and after each action;
     3. every type has a default width, raised only by its own label;
     4. the click that ends a drag, a resize or a freeze drop never opens
        the field menu.

   Drops are real pointer drags, and each asserts which column landed
   where, not that an event fired (Kyle, 2026-09-02). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

const FIELDS = [
  ['Status', 'select', { options: ['Open', 'Done'] }],
  ['Owner', 'text'],
  ['Due', 'date'],
  ['Points', 'number'],
  ['Price', 'number', { currency: 'USD' }],
  ['Done', 'checkbox'],
  ['Link', 'url'],
  ['Approved by finance', 'checkbox'],
];

let n = 0;
const s = await launch('grid resize, reorder and freeze', (weave) => {
  weave.createSpace({ name: 'Layout' });
});
if (s) {
  const { base, browser, weave } = s;
  const ownTable = () => {
    const db = weave.createTable({ space: 'Layout', name: `Grid ${++n}` });
    for (const [name, type, config] of FIELDS) weave.addField(db, { name, type, ...(config ? { config } : {}) });
    for (let i = 0; i < 12; i++) {
      weave.createEntity(db, { name: `Row ${i}`, values: { Owner: 'Sam', Points: i, Price: i * 10, Link: 'https://example.com' } });
    }
    return db;
  };
  const view = (db) => weave.tableView(db.id).views[0];
  const openGrid = async (db, { width = 1400, height = 900, theme = null } = {}) => {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`${base}/#/table/${db.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    if (theme) await page.evaluate((t) => document.documentElement.setAttribute('data-bs-theme', t), theme);
    await page.waitForTimeout(50);
    return page;
  };
  const head = (page, name) => page.locator(`.wv-grid thead th.col-head[data-col="${name}"]`);
  /* Every field column's rendered box, header and first body cell. */
  const layout = (page) => page.evaluate(() => {
    const table = document.querySelector('.wv-grid');
    const heads = [...table.tHead.rows[0].querySelectorAll('th.col-head')];
    const row = table.querySelector('tbody tr.entity-row');
    const out = {};
    for (const th of heads) {
      const i = [...th.parentElement.children].indexOf(th);
      const r = th.getBoundingClientRect();
      out[th.dataset.col] = { w: r.width, left: r.left, cell: row.children[i].getBoundingClientRect().width };
    }
    return out;
  });
  const order = (page) => page.$$eval('.wv-grid thead th.col-head', (hs) => hs.map((h) => h.dataset.col));
  /* Rule 2: every column but the ones named keeps its width, header and cell. */
  const sameWidths = (before, after, except = [], label = '') => {
    for (const [name, b] of Object.entries(before)) {
      if (except.includes(name) || !after[name]) continue;
      assert.ok(Math.abs(after[name].w - b.w) <= 0.5, `${label}: ${name} kept its width (${b.w} → ${after[name].w})`);
      assert.ok(Math.abs(after[name].cell - b.cell) <= 0.5, `${label}: ${name}'s cells kept their width`);
    }
  };
  const trayOpen = (page) => page.locator('#tray-back').count();
  /* A real pointer drag: bring the header into the wrap's view, press on
     it, travel to x (viewport; a function is read after the scroll), and
     optionally read the grid mid-drag before releasing. */
  const drag = async (page, name, x, during = null) => {
    await head(page, name).evaluate((th) => th.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    await page.waitForTimeout(50);
    if (typeof x === 'function') x = await x();
    const box = await head(page, name).boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + Math.min(24, box.width / 3), y);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 8 });
    const seen = during ? await during() : null;
    await page.mouse.up();
    // The view write is behind the in-place move.
    await page.waitForTimeout(200);
    return seen;
  };
  const insertLine = (page) => page.evaluate(() => {
    const lines = [...document.querySelectorAll('.wv-col-insert')].filter((l) => !l.hidden);
    const tag = lines[0]?.querySelector('.wv-col-insert-tag');
    return { count: lines.length, x: lines[0]?.getBoundingClientRect().left ?? null, tag: tag && !tag.hidden ? tag.textContent : null,
      tinted: document.querySelectorAll('.wv-grid .drop-target').length };
  });

  test('every type opens at its default width; a long label raises only its own column', async () => {
    const db = ownTable();
    const page = await openGrid(db);
    try {
      const l = await layout(page);
      const want = { Name: 260, Owner: 180, Status: 124, Points: 88, Price: 104, Link: 180 };
      for (const [name, w] of Object.entries(want)) assert.equal(Math.round(l[name].w), w, `${name} opens at ${w}px`);
      // A date opens at 112, or at what its format's widest date needs, so a
      // date is never cut (Issue #159): the format raises only its own column.
      assert.ok(l.Due.w >= 112 && l.Due.w < 160, `Due opens at 112 or just past it for its format (${l.Due.w})`);
      // A checkbox's default is 56, and its label is its floor.
      const floorOf = (name) => head(page, name).evaluate((th) => {
        const cs = getComputedStyle(th);
        return Math.ceil(th.querySelector('.col-label').getBoundingClientRect().width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight));
      });
      assert.equal(Math.round(l.Done.w), Math.max(56, await floorOf('Done')), 'Done: the default, or its label if longer');
      assert.equal(Math.round(l['Approved by finance'].w), await floorOf('Approved by finance'), 'a long label raises that column to its label');
      assert.ok(l['Approved by finance'].w > 120, 'and it is well past the 56px default');
    } finally { await page.close(); }
  });

  /* Issues #261 and #414: the Name column opens wide enough to read a
     thirty-character name whole. Kyle raised Name's default from the
     mockup's 220 to 260 on 2026-09-26; the dropped commit 41398c3 measured
     240px leaving such a name one pixel of room in Chromium's fallback face.
     The default is Feature #233's, so a stored width still wins and the "+"
     column still trails the last field (Feature #240). */
  const THIRTY = 'Quickstart for a new workspace';
  for (const theme of ['light', 'dark']) {
    test(`${theme}: a thirty-character name reads whole at the Name default; a stored width still wins`, async () => {
      const db = weave.createTable({ space: 'Layout', name: `Names ${++n}` });
      weave.createEntity(db, { name: THIRTY });
      for (let i = 0; i < 3; i++) weave.createEntity(db, { name: `Row ${i}` });
      const readName = (page) => page.evaluate((v) => {
        const wrap = document.querySelector('.table-wrap');
        const th = document.querySelector('.wv-grid thead th.col-head[data-col="Name"]');
        const td = [...document.querySelectorAll('.wv-grid tbody tr.entity-row td[data-field="Name"]')]
          .find((c) => (c.querySelector('input')?.value ?? c.textContent).trim() === v);
        const box = td.querySelector('input:not([type="checkbox"])') ?? td;
        const plus = document.querySelector('.wv-grid thead th.add-field-head').getBoundingClientRect();
        return {
          width: th.getBoundingClientRect().width,
          cell: td.getBoundingClientRect().width,
          clipped: box.scrollWidth > box.clientWidth + 1,
          plus: plus.width,
          gridRight: document.querySelector('.wv-grid').getBoundingClientRect().right,
          wrapRight: wrap.getBoundingClientRect().left + wrap.clientWidth,
        };
      }, THIRTY);
      let page = await openGrid(db, { width: 1440, theme });
      try {
        const got = await readName(page);
        assert.equal(Math.round(got.width), 260, `Name opens at 260px, got ${got.width}`);
        assert.ok(Math.abs(got.cell - got.width) <= 1, `the cells follow the header: ${got.cell} vs ${got.width}`);
        assert.equal(got.clipped, false, `"${THIRTY}" reads whole in a ${Math.round(got.width)}px column`);
        // Feature #240: the "+" trails the last field and the card's slack
        // is left bare, so the grid ends short of its card.
        assert.ok(got.plus < 60, `the "+" column is as wide as its button (${got.plus}px)`);
        assert.ok(got.wrapRight - got.gridRight > 100, `the slack past the "+" is bare card (${got.gridRight} vs ${got.wrapRight})`);
      } finally { await page.close(); }
      weave.tableView(`${db.id}/${view(db).id}`, { widths: { Name: 180 } });
      page = await openGrid(db, { width: 1440, theme });
      try {
        const got = await readName(page);
        assert.equal(Math.round(got.width), 180, `the view's stored 180px wins over the default, got ${got.width}`);
        assert.ok(Math.abs(got.cell - 180) <= 1, `and its cells hold it, got ${got.cell}`);
      } finally { await page.close(); }
    });
  }

  test('a header label never truncates at the floor — drag, nudge, several types', async () => {
    const db = ownTable();
    const page = await openGrid(db);
    try {
      for (const name of ['Done', 'Due', 'Points', 'Status', 'Approved by finance']) {
        const grip = await head(page, name).locator('.col-resize').boundingBox();
        const y = grip.y + grip.height / 2;
        await page.mouse.move(grip.x + grip.width / 2, y);
        await page.mouse.down();
        await page.mouse.move(grip.x - 400, y, { steps: 6 });
        await page.mouse.up();
        await page.waitForTimeout(150);
        // Alt+← past the floor changes nothing either.
        await head(page, name).focus();
        for (let i = 0; i < 3; i++) await page.keyboard.press('Alt+ArrowLeft');
        await page.waitForTimeout(50);
        const got = await head(page, name).evaluate((th) => {
          const label = th.querySelector('.col-label');
          const menu = th.querySelector('.field-menu').getBoundingClientRect();
          const cs = getComputedStyle(label);
          return {
            labelFits: label.scrollWidth <= label.clientWidth,
            headFits: th.scrollWidth <= th.clientWidth,
            clearOfMenu: label.getBoundingClientRect().right <= menu.left + 0.5,
            ellipsis: cs.textOverflow,
          };
        });
        assert.ok(got.labelFits, `${name}: the label box is not clipped at the floor`);
        assert.ok(got.headFits, `${name}: the header does not overflow at the floor`);
        assert.ok(got.clearOfMenu, `${name}: the label ends before the ⋮`);
        assert.notEqual(got.ellipsis, 'ellipsis', `${name}: a header label never ellipsises`);
      }
      await page.waitForTimeout(500);
      const stored = view(db).widths ?? {};
      assert.ok(Object.keys(stored).length >= 4, `the floored widths were saved to the view: ${JSON.stringify(stored)}`);
    } finally { await page.close(); }
  });

  test('a resize moves only the dragged field: the rest keep their widths and slide by the delta', async () => {
    const db = ownTable();
    const page = await openGrid(db);
    try {
      const before = await layout(page);
      const grip = await head(page, 'Status').locator('.col-resize').boundingBox();
      const y = grip.y + grip.height / 2;
      await page.mouse.move(grip.x + grip.width / 2, y);
      await page.mouse.down();
      await page.mouse.move(grip.x + grip.width / 2 + 40, y, { steps: 5 });
      const readout = await page.locator('.wv-col-readout').textContent();
      assert.match(readout, /^Status 164px \+40$/, `a live readout names the field, the width and the change: ${readout}`);
      await page.mouse.up();
      assert.equal(await trayOpen(page), 0, 'rule 4: the resize click opened nothing');
      await page.waitForTimeout(300);
      const after = await layout(page);
      assert.equal(Math.round(after.Status.w), 164);
      sameWidths(before, after, ['Status'], 'resize');
      for (const name of ['Owner', 'Due', 'Points']) {
        assert.ok(Math.abs(after[name].left - before[name].left - 40) <= 0.5, `${name} slid right by the delta`);
      }
      assert.ok(Math.abs(after.Name.left - before.Name.left) <= 0.5, 'a column left of it stayed put');
      assert.equal(view(db).widths.Status, 164, 'the width is the view\'s');
      assert.equal(await page.locator('.wv-col-readout').count(), 0, 'the readout goes with the gesture');
    } finally { await page.close(); }
  });

  test('keyboard: Alt+→ sizes by 8px; Alt+Shift+← moves one place, and across the seam it freezes in place', async () => {
    const db = ownTable();
    const page = await openGrid(db);
    try {
      const before = await layout(page);
      await head(page, 'Owner').focus();
      await page.keyboard.press('Alt+ArrowRight');
      await page.waitForTimeout(500);
      const sized = await layout(page);
      assert.equal(Math.round(sized.Owner.w), Math.round(before.Owner.w) + 8);
      sameWidths(before, sized, ['Owner'], 'nudge');
      assert.equal(view(db).widths.Owner, Math.round(before.Owner.w) + 8);
      // Owner is fourth: Name, Description, Status, Owner.
      await head(page, 'Owner').focus();
      await page.keyboard.press('Alt+Shift+ArrowLeft');
      await page.waitForTimeout(300);
      assert.deepEqual((await order(page)).slice(0, 4), ['Name', 'Description', 'Owner', 'Status']);
      assert.equal(await page.evaluate(() => document.activeElement?.dataset?.col), 'Owner', 'focus stays on the moved header');
      // Name is first; stepping it left crosses the seam: it freezes, stays first.
      await head(page, 'Name').focus();
      await page.keyboard.press('Alt+Shift+ArrowLeft');
      await page.waitForTimeout(300);
      assert.equal((await order(page))[0], 'Name');
      assert.equal(view(db).frozen, 1, 'Name froze in place');
      await page.keyboard.press('Alt+Shift+ArrowLeft');
      await page.waitForTimeout(200);
      assert.equal((await order(page))[0], 'Name', 'nothing goes before #');
      await page.keyboard.press('Alt+Shift+ArrowRight');
      await page.waitForTimeout(300);
      assert.ok(!view(db).frozen, 'and stepping right unfreezes it in place');
      sameWidths(sized, await layout(page), [], 'keyboard moves');
    } finally { await page.close(); }
  });

  test('a reorder drag: ghost, one insertion line, no swap tint, the column lands there, every width holds', async () => {
    const db = ownTable();
    const page = await openGrid(db);
    try {
      const before = await layout(page);
      let statusLeft = 0;
      const seen = await drag(page, 'Points', async () => { statusLeft = (await layout(page)).Status.left; return statusLeft + 12; }, async () => ({
        line: await insertLine(page),
        ghost: await page.locator('.wv-col-ghost').textContent(),
        dimmed: await head(page, 'Points').evaluate((th) => getComputedStyle(th).opacity),
      }));
      assert.equal(seen.line.count, 1, 'one insertion line');
      assert.ok(Math.abs(seen.line.x + 1 - statusLeft) <= 2, `the line sits at the gap before Status (${seen.line.x} vs ${statusLeft})`);
      assert.equal(seen.line.tinted, 0, 'no header wears a drop tint');
      assert.equal(seen.line.tag, null, 'a move inside the scrolling side carries no tag');
      assert.equal(seen.ghost, 'Points', 'the ghost is the grabbed header');
      assert.ok(Number(seen.dimmed) < 1, 'the grabbed column dims');
      assert.equal(await trayOpen(page), 0, 'rule 4: the drop click opened nothing');
      await head(page, 'Points').evaluate((th) => th.click()); // Safari's stray click of a captured drag
      await page.waitForTimeout(150);
      assert.equal(await trayOpen(page), 0, 'even when the click lands on the header');
      const want = ['Name', 'Description', 'Points', 'Status', 'Owner', 'Due', 'Price', 'Done', 'Link', 'Approved by finance'];
      assert.deepEqual(await order(page), want, 'Points landed before Status');
      const cells = await page.$$eval('.wv-grid tbody tr.entity-row', (rows) => rows.map((r) => [...r.children].filter((c) => c.dataset.field).map((c) => c.dataset.field)));
      for (const r of cells) assert.deepEqual(r, want, 'every body row moved with the header');
      assert.deepEqual(view(db).fields, want, 'saved into the view');
      sameWidths(before, await layout(page), [], 'reorder');
      assert.equal(await page.locator('.wv-col-insert, .wv-col-ghost').count(), 0, 'the line and the ghost go with the drag');
      // A drop where it already was draws no line and changes nothing.
      const noop = await drag(page, 'Owner', async () => { const o = (await layout(page)).Owner; return o.left + o.w / 2 + 3; }, () => insertLine(page));
      assert.equal(noop.count, 0, 'a no-op position hides the line');
      assert.deepEqual(await order(page), want);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      assert.deepEqual(await order(page), want, 'after a reload');
      sameWidths(before, await layout(page), [], 'reorder, reloaded');
    } finally { await page.close(); }
  });

  /* Found while building this (filed as its own Issue row): the grid drew
     its rows and its header from the column list it was opened with, so a
     column moved in place snapped back on the next redraw (a sort from the
     ⋮ menu) and rows built after the move carried the old cell order. */
  test('after a drag, a sort redraw keeps the new order in the header and every row', async () => {
    const db = ownTable();
    const page = await openGrid(db);
    try {
      await drag(page, 'Due', async () => (await layout(page)).Name.left + 8);
      const want = ['Due', 'Name', 'Description', 'Status', 'Owner', 'Points', 'Price', 'Done', 'Link', 'Approved by finance'];
      assert.deepEqual(await order(page), want);
      await head(page, 'Points').locator('.field-menu').click();
      await page.locator('.chip-pop .wv-menu-row', { hasText: 'Largest to smallest' }).click(); // a number's descending row (Issue #254)
      await page.waitForTimeout(400);
      assert.deepEqual(await order(page), want, 'the redraw kept the moved column');
      const rows = await page.$$eval('.wv-grid tbody tr.entity-row', (rs) => rs.map((r) => [...r.children].filter((c) => c.dataset.field).map((c) => c.dataset.field)));
      for (const r of rows) assert.deepEqual(r, want, 'and so did every row');
    } finally { await page.close(); }
  });

  test('drop across the seam freezes; drop back across unfreezes; widths hold both ways', async () => {
    const db = ownTable();
    const page = await openGrid(db, { width: 1100 });
    try {
      const before = await layout(page);
      const pidX = async () => { const b = await page.locator('.wv-grid thead th.pid-head').boundingBox(); return b.x + b.width / 2; };
      const seen = await drag(page, 'Owner', pidX, () => insertLine(page));
      assert.equal(seen.tag, 'Freeze here', 'the line says the drop freezes');
      assert.equal(await trayOpen(page), 0, 'rule 4: the freeze drop opened nothing');
      assert.equal((await order(page))[0], 'Owner', 'Owner landed first, after #');
      assert.equal(view(db).frozen, 1, 'and is frozen in the view');
      const frozen = await layout(page);
      sameWidths(before, frozen, [], 'freeze drop');
      // Scrolled sideways, the frozen field stays beside # and the next scrolls away.
      const pinned = await page.evaluate(() => {
        const wrap = document.querySelector('.table-wrap');
        wrap.scrollLeft = 300;
        const pidR = document.querySelector('.wv-grid thead th.pid-head').getBoundingClientRect();
        const owner = document.querySelector('.wv-grid thead th[data-col="Owner"]').getBoundingClientRect();
        const cell = document.querySelector('.wv-grid tbody tr.entity-row td[data-field="Owner"]').getBoundingClientRect();
        const next = document.querySelector('.wv-grid thead th[data-col="Name"]').getBoundingClientRect();
        return { scrolled: wrap.scrollLeft, pidRight: pidR.right, owner: owner.left, cell: cell.left, next: next.left };
      });
      assert.ok(pinned.scrolled > 100, `the grid scrolls sideways (${pinned.scrolled})`);
      assert.ok(Math.abs(pinned.owner - pinned.pidRight) <= 1, 'the frozen header is pinned beside #');
      assert.ok(Math.abs(pinned.cell - pinned.pidRight) <= 1, 'and so are its cells');
      assert.ok(pinned.next < pinned.pidRight, 'the first scrolling field slid under the zone');
      const seam = await page.evaluate(() => getComputedStyle(document.querySelector('.wv-grid thead th[data-col="Owner"]')).borderRightColor);
      assert.doesNotMatch(seam, /rgba\(0, 0, 0, 0\)/, 'the seam hairline moved to the last frozen field while scrolled');
      await page.evaluate(() => { document.querySelector('.table-wrap').scrollLeft = 0; });
      await page.waitForTimeout(80);
      // Drop it back across, to the right half of Status.
      const back = await drag(page, 'Owner', async () => {
        // Status in the middle of the wrap, clear of the auto-scroll edges.
        await head(page, 'Status').evaluate((th) => th.scrollIntoView({ block: 'nearest', inline: 'center' }));
        await page.waitForTimeout(50);
        const st = (await layout(page)).Status;
        return st.left + st.w - 10;
      }, () => insertLine(page));
      assert.equal(back.tag, 'Unfreeze', 'the line says the drop unfreezes');
      assert.equal(await trayOpen(page), 0, 'rule 4: the unfreeze drop opened nothing');
      assert.ok(!view(db).frozen, 'unfrozen');
      assert.deepEqual((await order(page)).slice(0, 4), ['Name', 'Description', 'Status', 'Owner']);
      sameWidths(before, await layout(page), [], 'unfreeze drop');
    } finally { await page.close(); }
  });

  test('the frozen zone stops at 60% of the visible grid; past it the drop lands on the scrolling side', async () => {
    const db = ownTable();
    weave.tableView(`${db.id}/${view(db).id}`, { widths: { Name: 300, Owner: 300 }, frozen: 1 });
    // A ~900px grid: the cap is ~540px. # and Name (300) fit; Owner (300) would not.
    const page = await openGrid(db, { width: 1300 });
    try {
      const pidX = async () => { const b = await page.locator('.wv-grid thead th.pid-head').boundingBox(); return b.x + b.width / 2; };
      const seen = await drag(page, 'Owner', pidX, () => insertLine(page));
      assert.equal(seen.tag, null, 'no freeze tag past the cap');
      assert.equal(view(db).frozen, 1, 'the zone did not grow');
      assert.deepEqual((await order(page)).slice(0, 2), ['Name', 'Owner'], 'Owner landed first on the scrolling side');
      // A stored count past the cap draws only what fits.
      weave.tableView(`${db.id}/${view(db).id}`, { frozen: 3 });
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      const zone = await page.evaluate(() => {
        const wrap = document.querySelector('.table-wrap');
        const heads = [...document.querySelectorAll('.wv-grid thead th')];
        const sticky = heads.filter((h) => h.classList.contains('col-head') && getComputedStyle(h).left !== 'auto');
        const last = sticky.at(-1)?.getBoundingClientRect().right ?? 0;
        return { frozen: sticky.map((h) => h.dataset.col), right: last - wrap.getBoundingClientRect().left, visible: wrap.clientWidth };
      });
      assert.ok(zone.right <= zone.visible * 0.6 + 1, `the zone ends by 60% (${zone.right} of ${zone.visible})`);
      assert.deepEqual(zone.frozen, ['Name'], 'Name fits; Owner would pass the cap and scrolls');
    } finally { await page.close(); }
  });

  test('hide, show, add and remove a field: no other field changes width, and a hidden field keeps its own', async () => {
    const db = ownTable();
    weave.tableView(`${db.id}/${view(db).id}`, { widths: { Due: 150 } });
    const page = await openGrid(db);
    const eyeFlip = async (name) => {
      await page.click('.eye-btn');
      await page.locator('.chip-pop .eye-row', { has: page.locator(`.eye-label:text-is("${name}")`) }).click();
      await page.waitForTimeout(400);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    };
    try {
      const before = await layout(page);
      await eyeFlip('Due');
      const hidden = await layout(page);
      assert.equal(hidden.Due, undefined, 'Due is hidden');
      sameWidths(before, hidden, ['Due'], 'hide');
      await eyeFlip('Due');
      const shown = await layout(page);
      assert.equal(Math.round(shown.Due.w), 150, 'Due came back at its own width');
      assert.deepEqual(await order(page), Object.keys(before), 'and in its own place');
      sameWidths(before, shown, [], 'show');
      weave.addField(db, { name: 'Notes', type: 'text' });
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      const added = await layout(page);
      assert.equal(Math.round(added.Notes.w), 180, 'a new text field opens at 180');
      sameWidths(before, added, ['Notes'], 'add field');
      weave.deleteField(db, 'Owner');
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      sameWidths(before, await layout(page), ['Owner', 'Notes'], 'remove field');
    } finally { await page.close(); }
  });

  /* Issue #417 (Kyle, 2026-09-26): a header drag or a resize left a text
     selection across the header labels. Headers are controls: nothing in the
     header row selects, and a gesture clears any live selection. */
  test('a header drag, a resize and a fit select no header text; cell values stay selectable', async () => {
    const db = ownTable();
    weave.updateTable(db, { systemFields: ['Created At'] });
    const page = await openGrid(db);
    const selected = () => page.evaluate(() => getSelection().toString());
    try {
      // A live selection from before the gesture goes too.
      await page.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.querySelector('.view-header') ?? document.body); getSelection().addRange(r); });
      await drag(page, 'Points', async () => (await layout(page)).Status.left + 12);
      assert.equal(await selected(), '', 'nothing is selected after a header drag');
      for (const name of ['Owner', 'Created At']) {
        await head(page, name).evaluate((th) => th.scrollIntoView({ block: 'nearest', inline: 'center' }));
        await page.waitForTimeout(50);
        const grip = await head(page, name).locator('.col-resize').boundingBox();
        const y = grip.y + grip.height / 2;
        await page.mouse.move(grip.x + grip.width / 2, y);
        await page.mouse.down();
        await page.mouse.move(grip.x + 160, y + 40, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(150);
        assert.equal(await selected(), '', `nothing is selected after resizing ${name}`);
        const moved = await head(page, name).locator('.col-resize').boundingBox();
        await page.mouse.dblclick(moved.x + moved.width / 2, moved.y + moved.height / 2);
        await page.waitForTimeout(300);
        assert.equal(await selected(), '', `nothing is selected after a fit on ${name}`);
      }
      // Drag across the header row from a label, the way a reader sweeps text.
      const a = await head(page, 'Status').boundingBox();
      const b = await head(page, 'Due').boundingBox();
      await page.mouse.move(a.x + 6, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width - 30, b.y + b.height / 2, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      assert.equal(await selected(), '', 'a sweep across the header row selects nothing');
      const css = await page.evaluate(() => {
        const us = (n) => { const cs = getComputedStyle(n); return cs.userSelect || cs.webkitUserSelect; };
        const q = (sel) => document.querySelector(sel);
        return {
          row: us(q('.wv-grid thead tr')), col: us(q('.wv-grid thead th.col-head')), label: us(q('.wv-grid thead th.col-head .col-label')),
          sys: us(q('.wv-grid thead th.sys-head')), grip: us(q('.wv-grid .col-resize')), cell: us(q('.wv-grid tbody td.sys-cell')),
        };
      });
      for (const k of ['row', 'col', 'label', 'sys', 'grip']) assert.equal(css[k], 'none', `${k}: headers are controls`);
      assert.notEqual(css.cell, 'none', 'a cell value stays selectable');
    } finally { await page.close(); }
  });

  /* Issue #418 (Kyle, 2026-09-26: "system fields should be reorderable as
     well"). A shown system column is a column like any field: it drags,
     freezes across the seam, steps with Alt+Shift+arrows, and saves into
     the view's one ordered list. Only # stays locked first. */
  test('system columns reorder, freeze and step like fields; every other width holds', async () => {
    const db = ownTable();
    weave.updateTable(db, { systemFields: ['Created At', 'Modified By'] });
    const page = await openGrid(db, { width: 1800 });
    const want0 = ['Name', 'Description', 'Status', 'Owner', 'Due', 'Points', 'Price', 'Done', 'Link', 'Approved by finance', 'Created At', 'Modified By'];
    const sysCells = () => page.$$eval('.wv-grid tbody tr.entity-row', (rs) => rs.map((r) => [...r.children].filter((c) => c.dataset.field || c.dataset.sys).map((c) => c.dataset.field ?? c.dataset.sys)));
    try {
      assert.deepEqual(await order(page), want0, 'system columns close the default view');
      const before = await layout(page);
      // Between two regular fields: the right half of Status.
      const seen = await drag(page, 'Created At', async () => { const st = (await layout(page)).Status; return st.left + st.w - 10; }, () => insertLine(page));
      assert.equal(seen.count, 1, 'one insertion line');
      assert.equal(await trayOpen(page), 0, 'the drop opened nothing');
      const want1 = ['Name', 'Description', 'Status', 'Created At', 'Owner', 'Due', 'Points', 'Price', 'Done', 'Link', 'Approved by finance', 'Modified By'];
      assert.deepEqual(await order(page), want1, 'Created At landed between Status and Owner');
      for (const r of await sysCells()) assert.deepEqual(r, want1, 'every row moved with the header');
      assert.deepEqual(view(db).fields, want1, 'saved into the view\'s one list');
      sameWidths(before, await layout(page), [], 'system column reorder');
      // And back, to the end.
      await drag(page, 'Created At', async () => { const m = (await layout(page))['Modified By']; return m.left + m.w - 6; });
      const want2 = ['Name', 'Description', 'Status', 'Owner', 'Due', 'Points', 'Price', 'Done', 'Link', 'Approved by finance', 'Modified By', 'Created At'];
      assert.deepEqual(await order(page), want2, 'and back past the last field');
      sameWidths(before, await layout(page), [], 'system column back');
      // Freeze a system column across the seam.
      const pidX = async () => { const b = await page.locator('.wv-grid thead th.pid-head').boundingBox(); return b.x + b.width / 2; };
      const f = await drag(page, 'Modified By', pidX, () => insertLine(page));
      assert.equal(f.tag, 'Freeze here');
      assert.equal((await order(page))[0], 'Modified By', 'it froze first, after #');
      assert.equal(view(db).frozen, 1);
      sameWidths(before, await layout(page), [], 'system column freeze');
      // Alt+Shift+→ steps it out of the zone in place.
      await head(page, 'Modified By').focus();
      await page.keyboard.press('Alt+Shift+ArrowRight');
      await page.waitForTimeout(400);
      assert.ok(!view(db).frozen, 'the keyboard unfroze it in place');
      await page.keyboard.press('Alt+Shift+ArrowRight');
      await page.waitForTimeout(400);
      assert.deepEqual((await order(page)).slice(0, 2), ['Name', 'Modified By'], 'and stepped it one place');
      sameWidths(before, await layout(page), [], 'system column keyboard');
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('.wv-grid tbody tr.entity-row');
      assert.deepEqual((await order(page)).slice(0, 2), ['Name', 'Modified By'], 'after a reload');
      sameWidths(before, await layout(page), [], 'system columns, reloaded');
    } finally { await page.close(); }
  });

  for (const theme of ['light', 'dark']) {
    test(`${theme}: frozen cells paint opaque and the header row holds both ways`, async () => {
      const db = ownTable();
      weave.tableView(`${db.id}/${view(db).id}`, { frozen: 1 });
      const page = await openGrid(db, { width: 1000, height: 800, theme });
      try {
        const g = await page.evaluate(() => {
          const wrap = document.querySelector('.table-wrap');
          wrap.scrollLeft = 250;
          const scroller = wrap.classList.contains('wv-grid-scroll') ? wrap : document.scrollingElement;
          const th = document.querySelector('.wv-grid thead th[data-col="Name"]');
          const top0 = th.getBoundingClientRect().top;
          scroller.scrollTop = 200;
          // A row well inside the visible body, clear of the grid's sticky
          // header and the page's view header above it.
          // (The <thead> box scrolls away; its sticky cells are what stay.)
          const top = Math.max(...[...document.querySelectorAll('.wv-grid thead th')].map((h) => h.getBoundingClientRect().bottom),
            document.querySelector('#main > .view-header')?.getBoundingClientRect().bottom ?? 0);
          const cell = [...document.querySelectorAll('.wv-grid tbody tr.entity-row td[data-field="Name"]')]
            .find((c) => c.getBoundingClientRect().top > top + 4 && c.getBoundingClientRect().bottom < innerHeight - 60);
          const r = cell.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return {
            bg: getComputedStyle(cell).backgroundColor,
            onTop: cell.contains(hit),
            headTopHeld: Math.abs(th.getBoundingClientRect().top - top0) <= 1 || th.getBoundingClientRect().top >= 0,
            headLeft: th.getBoundingClientRect().left,
            pidRight: document.querySelector('.wv-grid thead th.pid-head').getBoundingClientRect().right,
          };
        });
        assert.doesNotMatch(g.bg, /rgba\(0, 0, 0, 0\)|transparent/, `an opaque ground, not ${g.bg}`);
        assert.ok(g.onTop, 'the frozen cell is what the reader sees at its own middle');
        assert.ok(g.headTopHeld, 'the header row stays on screen while the body scrolls');
        assert.ok(Math.abs(g.headLeft - g.pidRight) <= 1, 'the frozen header is pinned beside # while scrolled sideways');
      } finally { await page.close(); }
    });
  }
}
