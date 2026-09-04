/* Four faults Kyle found in one pass over the Ledger grid (Issue #93, and the
   font half of Issue #67). Every one of them is a measurement the source can
   lie about, so this suite drives a real browser:

     1. the hover expansion of a clipped cell must show the value WHERE the
        value already is — same left edge, same baseline, same type. It landed
        8px right and 22px high, so reading a cell moved what you were reading.
     2. an EMPTY document chip must not make the row taller than a full one.
        Tabler ships a global `.empty` (flex column, height 100%, 1rem padding)
        and the chip wore the same class name, so one empty Brief field took a
        43px comfortable row to 85 — in both densities.
     3. the ↗ on a relation chip is the affordance that says "clicking goes
        somewhere". It was a ::after on the chip, outside the <a>, so the one
        pixel that promised navigation was the one pixel that did nothing.
     4. a relation chip in a grid carries no ×. Unlinking is an edit, and the
        grid is a record — the picker owns the removal.

   Playwright is NOT a dependency of weave (house rule: zero runtime deps).
   It is imported dynamically and the suite skips when it is absent. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let tasks, people, task;

const s = await launch('grid chrome', (weave) => {
  weave.createSpace({ name: 'Product' });
  people = weave.createTable({ space: 'Product', name: 'Person' });
  tasks = weave.createTable({ space: 'Product', name: 'Task' });
  weave.addField(tasks, { name: 'Notes', type: 'text' });
  // Enough columns that the grid runs out of room and starts clipping —
  // the expansion only exists for a cell that does not fit.
  const FILLERS = Array.from({ length: 18 }, (_, i) => `Col ${i + 1}`);
  for (const n of FILLERS) weave.addField(tasks, { name: n, type: 'text' });
  weave.addField(tasks, { name: 'Brief', type: 'document' });
  weave.addRelation(tasks, { name: 'Owners', targetDb: people, cardinality: 'many-to-many', inverseName: 'Tasks' });
  // A to-one relation as well: on the entity page a collection becomes its
  // own grid, so the chip that keeps its × is the single link.
  weave.addRelation(tasks, { name: 'Lead', targetDb: people, cardinality: 'many-to-one', inverseName: 'Leads' });

  const mia = weave.createEntity(people, { name: 'Mia Okafor' });
  // A name and a note both long enough that the column clips them: the
  // expansion only exists for cells that do not fit.
  task = weave.createEntity(tasks, {
    name: 'A task whose name is far too long to sit inside one grid column',
    values: {
      Notes: 'A note that also runs past the end of its column and has to be clipped',
      ...Object.fromEntries(FILLERS.map((n) => [n, `${n} carries a value long enough to clip`])),
    },
  });
  weave.link(task.id, 'Owners', [mia.id]);
  // A column narrower than the control inside it is what makes a text cell
  // clip at all — the same 60px Kyle had dragged the Site column to.
  weave.updateField(tasks, 'Name', { config: { width: 60 } });
  weave.link(task.id, 'Lead', [mia.id]);
  // A description with marks and more lines than a row can hold, so the
  // preview has something to format and the hover has something to reveal
  // (Kyle, 2026-08-27). The second row leaves its description empty, which
  // is what the equal-height assertion below is really measuring.
  weave.setDoc(task.id, '# Title\n\n**bold** body\n\n- third line');
  // A second row, with its Brief written, to compare row heights against.
  const full = weave.createEntity(tasks, { name: 'Short' });
  weave.setDoc(full.id, '# Written\n\nthis one is not empty', 'Brief');

});
if (s) {
  const { base, browser, weave } = s;
  async function grid(density) {
    const page = await browser.newPage({ viewport: { width: 820, height: 900 } });
    if (density) {
      // Density is per table and per person, so it is set the way a person
      // sets it — in localStorage, before the grid draws.
      await page.addInitScript(([key, d]) => localStorage.setItem(key, d),
        [`weave-grid-density:${tasks.id}`, density]);
    }
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr');
    await page.waitForFunction(() => document.querySelectorAll('.wv-grid tbody td.clipped').length > 0
      || document.querySelectorAll('.wv-grid tbody tr').length > 0);
    return page;
  }

  /* ── 1 · the expansion opens over the value, not beside it ───────────── */

  test('a clipped cell expands where its value already sits', async () => {
    const page = await grid();
    try {
      const off = await page.evaluate(() => {
        const td = [...document.querySelectorAll('.wv-grid tbody td.clipped')][0];
        td.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        const pop = document.querySelector('.cell-pop');
        if (!pop) return null;
        const box = (n) => (n.firstElementChild ?? n).getBoundingClientRect();
        const a = box(td); const b = box(pop);
        return { dx: Math.round(b.left - a.left), dy: Math.round(b.top - a.top) };
      });
      assert.ok(off, 'hovering a clipped cell opens the expansion');
      assert.ok(Math.abs(off.dx) <= 1, `the value keeps its left edge (moved ${off.dx}px)`);
      assert.ok(Math.abs(off.dy) <= 1, `the value keeps its baseline (moved ${off.dy}px)`);
    } finally { await page.close(); }
  });

  /* Issue #67: the copy lands outside the cell, so every cell-scoped rule
     stops matching it. The leading column is 15px/600 in the row; it was the
     grid default in the popover, and the value changed size as you read it. */
  test('a clipped name keeps its type in the expansion', async () => {
    const page = await grid();
    try {
      const type = await page.evaluate(() => {
        const td = document.querySelector('.wv-grid tbody td.name-cell.clipped');
        td.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        const pop = document.querySelector('.cell-pop');
        if (!pop) return null;
        const read = (n) => {
          const cs = getComputedStyle(n.querySelector('.inline-edit') ?? n);
          return { size: cs.fontSize, weight: cs.fontWeight, family: cs.fontFamily };
        };
        return { cell: read(td), pop: read(pop) };
      });
      assert.ok(type, 'the name cell is clipped and expands');
      assert.deepEqual(type.pop, type.cell, 'same font, same size, same weight');
    } finally { await page.close(); }
  });

  /* The marker is measured, never assumed — so it has to be measured AGAIN
     when the box changes. Narrowing the window puts cells over their columns
     that were not over them before, and every one of those has to pick up its
     ⤢ or the expansion cannot be opened at all. Guards the expansion the two
     cases above are about: they only ever run on a cell that is marked. */
  test('a cell that starts overflowing gets its marker without a redraw', async () => {
    const page = await grid();
    try {
      await page.setViewportSize({ width: 420, height: 900 });
      await page.waitForFunction(() => {
        const tds = [...document.querySelectorAll('.wv-grid tbody td')];
        const over = tds.filter((t) => t.scrollWidth > t.clientWidth + 1);
        return over.length > 0 && over.every((t) => t.classList.contains('clipped'));
      }, null, { timeout: 3000 });
    } finally { await page.close(); }
  });

  /* ── 2 · an empty document chip costs the row no height ──────────────── */

  for (const density of ['comfortable', 'compact']) {
    test(`an empty document chip does not grow a ${density} row`, async () => {
      const page = await grid(density);
      try {
        const h = await page.$$eval('.wv-grid tbody tr', (rows) => rows
          .filter((r) => r.querySelector('td .doc-chip'))
          .map((r) => Math.round(r.getBoundingClientRect().height)));
        assert.ok(h.length >= 2, 'two rows to compare');
        assert.equal(new Set(h).size, 1, `every row is the same height (${h.join(', ')})`);
        const cap = density === 'compact' ? 34 : 48;
        assert.ok(h[0] <= cap, `a ${density} row stays at ${cap}px or under (${h[0]})`);
      } finally { await page.close(); }
    });
  }

  /* ── 2b · the description reads as prose, in a row's worth of space ──────
     Kyle, 2026-08-27: a description "should always show a preview of the
     properly formatted first few lines, not an md document chip". A row holds
     one of those lines — the caps above are why — and hover holds the rest. */

  test('the description preview shows its marks, not its syntax', async () => {
    const page = await grid();
    try {
      const seen = await page.evaluate(() => {
        const box = document.querySelector('.wv-grid tbody .doc-preview');
        if (!box) return null;
        return { text: box.textContent, strong: !!box.querySelector('strong') };
      });
      assert.ok(seen, 'the description has a cell of its own');
      assert.ok(!seen.text.includes('#'), `a heading arrives as its words (${seen.text})`);
      assert.ok(!seen.text.includes('**'), 'and bold as bold');
      assert.ok(seen.strong, 'the mark is really a <strong>');
    } finally { await page.close(); }
  });

  test('hovering a description shows the lines the row had no room for', async () => {
    const page = await grid();
    try {
      const lines = await page.evaluate(() => {
        const td = document.querySelector('.wv-grid tbody td:has(> .doc-preview)');
        if (!td) return null;
        const visible = (n) => [...n.querySelectorAll('.doc-preview-line')]
          .filter((l) => getComputedStyle(l).display !== 'none').length;
        const inCell = visible(td);
        td.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        const pop = document.querySelector('.cell-pop');
        return pop ? { inCell, inPop: visible(pop) } : { inCell, inPop: 0 };
      });
      assert.ok(lines, 'the description cell is there to hover');
      assert.equal(lines.inCell, 1, 'the row shows one line, whatever the document holds');
      assert.ok(lines.inPop > lines.inCell, `the expansion shows more (${lines.inPop} vs ${lines.inCell})`);
    } finally { await page.close(); }
  });

  test('a description reads at full strength, not dimmed like a computed cell', async () => {
    // `cell-computed` paints --tblr-secondary and a default cursor: "nothing
    // to do here". A description is the row's own prose and one click opens
    // it, so it must read like the Name beside it, not like a rollup.
    const page = await grid();
    try {
      const look = await page.evaluate(() => {
        const td = document.querySelector('.wv-grid tbody td:has(> .doc-preview)');
        const name = document.querySelector('.wv-grid tbody td.name-cell');
        return {
          computed: td.classList.contains('cell-computed'),
          color: getComputedStyle(td.querySelector('.doc-preview')).color,
          nameColor: getComputedStyle(name.querySelector('.text-dressed') ?? name).color,
          cursor: getComputedStyle(td.querySelector('.doc-preview')).cursor,
        };
      });
      assert.equal(look.computed, false, 'the description cell is not tagged computed');
      assert.equal(look.color, look.nameColor, 'it is as legible as the name beside it');
      assert.equal(look.cursor, 'pointer', 'and it advertises that clicking does something');
    } finally { await page.close(); }
  });

  test('an empty description is a dashed invitation, not a dim', async () => {
    const page = await grid();
    try {
      const look = await page.evaluate(() => {
        const box = [...document.querySelectorAll('.wv-grid tbody .doc-preview.is-empty')][0];
        if (!box) return null;
        const cs = getComputedStyle(box.querySelector('.doc-preview-line'));
        return { style: cs.borderTopStyle, opacity: getComputedStyle(box).opacity, framework: box.classList.contains('empty') };
      });
      assert.ok(look, 'an unwritten description still draws something');
      assert.equal(look.style, 'dashed', 'dashed says "write here"');
      assert.equal(look.opacity, '1', 'opacity would say "you may not"');
      assert.equal(look.framework, false, 'never Tabler’s global `.empty`');
    } finally { await page.close(); }
  });

  /* The cause: Tabler's global `.empty` is a full-height flex column with a
     1rem pad. A chip must not answer to it. */
  test('the empty-document chip does not wear a framework class name', async () => {
    const page = await grid();
    try {
      const bad = await page.$$eval('.doc-chip, .k-attach', (ns) => ns
        .filter((n) => n.classList.contains('empty')).length);
      assert.equal(bad, 0, 'the empty state is scoped to weave, not the `empty` global');
    } finally { await page.close(); }
  });

  /* ── 3 · the ↗ on a relation chip opens the record ───────────────────── */

  test('clicking the ↗ of a relation chip opens that entity', async () => {
    const page = await grid();
    try {
      const chip = page.locator('.wv-grid tbody .k-rel').first();
      // The grid scrolls sideways; a relation column can sit past the fold.
      await chip.scrollIntoViewIfNeeded();
      const box = await chip.boundingBox();
      // The arrow is the last few pixels of the chip — the exact spot that
      // promises navigation, and the exact spot that used to do nothing.
      await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2);
      await page.waitForFunction(() => location.hash.startsWith('#/entity/'), null, { timeout: 3000 });
      assert.match(page.url(), /#\/entity\//, 'the arrow navigates');
    } finally { await page.close(); }
  });

  /* ── 4 · no × on a relation chip in a grid ───────────────────────────── */

  test('a relation chip in the grid carries no ×', async () => {
    const page = await grid();
    try {
      assert.equal(await page.locator('.wv-grid tbody .k-rel .x').count(), 0,
        'unlinking is an edit; the grid is a record');
      assert.ok(await page.locator('.wv-grid tbody .ms-box > .btn').count() > 0,
        'and + link is still how the cell is edited');
    } finally { await page.close(); }
  });

  test('the entity page keeps the × on its relation chips', async () => {
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/#/entity/${task.id}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.entity-fields .fieldrow');
      assert.ok(await page.locator('.entity-fields .k-rel .x').count() > 0,
        'the record’s own page is where a link is taken off');
      // A collection is a grid of its own down the page, and that grid keeps
      // its unlink button — the button IS the edit surface there.
      await page.waitForSelector('.unlink-btn');
      assert.ok(await page.locator('.unlink-btn').count() > 0, 'and a related grid unlinks by its own button');
    } finally { await page.close(); }
  });
}
