/* The column header's ⋮ menu, redesigned 2026-08-27 (Kyle: "redesign this
   dialog to match weave design language. I like the hold to delete and
   animation").

   The screenshot he sent is the specification in reverse. Five rows in one
   panel and no two of them agreed: '✎' drawn at one optical size beside a '+'
   at another and arrows at a third, four different label left-edges, and a red
   'Delete field' wearing Tabler's `.dropdown-item` padding among weave's
   `.chip-pop-row`s. Every one of those is a claim about painted geometry that
   app.js cannot be read for — the source says `class: 'dropdown-item'` and
   looks fine. Only a browser can measure what that comes out as.

   Five things asserted here, each of which a source-level test would miss:
     1. every label in the panel starts at ONE x, because every icon box is
        one width — the defect the screenshot leads with.
     2. every icon is a drawn SVG on the one 16px scale (Issue #87), not a
        character taking the font's advance width.
     3. ↑↓ reaches the delete row. It used not to: showPopover walks
        `.chip-pop-row` and the delete row was a `.dropdown-item`, so the one
        row that most deserves deliberate aim was the one the keyboard could
        not reach at all.
     4. the hold still guards the delete — released early, the field stands.
        Kyle keeps the gesture; this is the test that says it still gates.
     5. all of it holds in dark as well as light (house rule).

   Playwright is NOT a dependency of weave (zero runtime deps). It is imported
   dynamically and the suite skips when it is absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const chromium = await import('playwright')
  .then((pw) => pw.chromium)
  .catch(() => null);

if (!chromium) {
  test('field menu (browser)', { skip: 'playwright not installed' }, () => {});
} else {
  let server, base, browser, weave, tasks;
  test.before(async () => {
    weave = new Weave();
    weave.createSpace({ name: 'Product' });
    tasks = weave.createTable({ space: 'Product', name: 'Task' });
    weave.addField(tasks, { name: 'Priority', type: 'select', config: { options: ['P0', 'P1', 'P2'] } });
    weave.addField(tasks, { name: 'Estimate', type: 'number' });
    for (const [name, p] of [['Echo', 'P2'], ['Delta', 'P0'], ['Charlie', 'P1']]) {
      weave.createEntity(tasks, { name, values: { Priority: p } });
    }
    ({ server } = await startServer(weave, { port: 0 }));
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
  });

  test.after(async () => {
    await browser?.close();
    server?.close();
  });

  async function grid() {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    // A geometry gate measures boxes, not motion: since 2026-09-02 an icon plays
    // once on load, and a scaled frame is not the size it rests at.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${base}/#/table/${tasks.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    return page;
  }

  /* Open the menu on a named column. The ⋮ is opacity 0 until the header is
     hovered, so the click has to land on the header first. */
  async function openMenu(page, column = 'Priority') {
    const th = page.locator('.wv-grid thead th.col-head', { hasText: column }).first();
    await th.hover();
    await th.locator('.field-menu').click();
    await page.waitForSelector('.chip-pop .wv-menu-row');
    // The panel animates in (wv-pop-in, .12s): measure after it settles, or
    // every box comes back scaled by .985 and every assertion below is about
    // a frame nobody sees. Caught by the icon-scale test on the first run.
    await page.locator('.chip-pop').evaluate((p) => Promise.all(p.getAnimations().map((a) => a.finished)));
    return page.locator('.chip-pop');
  }

  const setTheme = (page, want) => page.evaluate((w) => {
    const btn = document.querySelector('#theme-toggle');
    for (let i = 0; i < 4 && document.documentElement.dataset.bsTheme !== w; i++) btn.click();
  }, want);

  /* Every row's geometry, measured rather than read: the label's left edge,
     the row's own box, and the icon each row draws. */
  const rowMetrics = (page) => page.evaluate(() => {
    const round = (n) => Math.round(n * 10) / 10;
    return [...document.querySelectorAll('.chip-pop .wv-menu-row')].map((row) => {
      const label = row.querySelector('.wv-menu-label, .hold-label');
      const icon = row.querySelector('.wv-menu-icon');
      const svg = icon?.querySelector('svg');
      const cs = getComputedStyle(row);
      const ib = icon?.getBoundingClientRect();
      const sb = svg?.getBoundingClientRect();
      return {
        text: label?.textContent?.trim() ?? row.textContent.trim(),
        labelLeft: round(label.getBoundingClientRect().left),
        height: round(row.getBoundingClientRect().height),
        padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
        fontSize: cs.fontSize,
        iconBox: ib ? [round(ib.width), round(ib.height)] : null,
        svgBox: sb ? [round(sb.width), round(sb.height)] : null,
        drawn: !!svg,
      };
    });
  });

  test('one panel, one left edge — every label starts at the same x', async () => {
    // THE defect in the screenshot: '✎ Edit field…' and '+ Insert field…' and
    // a bare 'Delete field' each began somewhere different, because the first
    // two carried a glyph of their own width inside the label and the third
    // carried none and wore another design system's padding.
    const page = await grid();
    try {
      await openMenu(page);
      const rows = await rowMetrics(page);
      assert.ok(rows.length >= 5, `expected the full menu, got ${rows.length} rows`);
      const lefts = new Set(rows.map((r) => r.labelLeft));
      assert.equal(lefts.size, 1,
        `labels must share one left edge, found ${[...lefts].join(', ')} — ${rows.map((r) => r.text).join(' | ')}`);
      const boxes = new Set(rows.map((r) => r.padding + '/' + r.fontSize));
      assert.equal(boxes.size, 1, `one row metric for every row, found: ${[...boxes].join(' AND ')}`);
      const heights = rows.map((r) => r.height);
      assert.ok(Math.max(...heights) - Math.min(...heights) < 0.6,
        `rows must be the same height, got ${heights.join(', ')}`);
    } finally { await page.close(); }
  });

  test('every mark in the menu is drawn, at the one icon scale', async () => {
    // Issue #87: a unicode mark carries its own advance width and its own
    // optical size, so no two of them ever share a box. --wv-icon-md is 16.
    const page = await grid();
    try {
      await openMenu(page);
      const rows = await rowMetrics(page);
      for (const r of rows) {
        assert.ok(r.drawn, `"${r.text}" must draw an svg, not type a character`);
        assert.deepEqual(r.iconBox, [16, 16], `"${r.text}" icon box is off the scale`);
        assert.deepEqual(r.svgBox, [16, 16], `"${r.text}" svg is off the scale`);
      }
    } finally { await page.close(); }
  });

  test('the panel says which column it belongs to', async () => {
    // The ⋮ paints millimetres from the NEXT column's label (live check
    // 2026-08-16), and the hovered tint was the only thing tying the two.
    const page = await grid();
    try {
      const pop = await openMenu(page, 'Priority');
      assert.equal((await pop.locator('.wv-menu-title').textContent()).trim(), 'Priority');
      assert.equal((await pop.locator('.wv-menu-kind').textContent()).trim(), 'select');
      // The header must sit above the first row, not float anywhere in it.
      const headBottom = (await pop.locator('.wv-menu-head').boundingBox()).y;
      const firstRow = (await pop.locator('.wv-menu-row').first().boundingBox()).y;
      assert.ok(headBottom < firstRow, 'the title opens the panel');
    } finally { await page.close(); }
  });

  test('the arrow walk reaches the delete row', async () => {
    // It did not before: showPopover walks `.chip-pop-row` and the delete row
    // was a Tabler `.dropdown-item`. Keyboard-only users could open the menu
    // and never arrive at it.
    const page = await grid();
    try {
      await openMenu(page);
      const seen = [];
      for (let i = 0; i < 8; i++) {
        seen.push(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ''));
        await page.keyboard.press('ArrowDown');
      }
      assert.ok(seen.some((t) => /Delete field/.test(t)),
        `↑↓ never landed on the delete row — visited: ${seen.join(' → ')}`);
    } finally { await page.close(); }
  });

  test('a live sort is the popover check, and the menu opens on it', async () => {
    const page = await grid();
    try {
      let pop = await openMenu(page);
      await pop.locator('.wv-menu-row', { hasText: 'Sort ascending' }).click();
      await page.waitForTimeout(250);
      pop = await openMenu(page);
      const asc = pop.locator('.wv-menu-row', { hasText: 'Sort ascending' });
      assert.equal(await asc.locator('.chip-pop-check').count(), 1, 'the live sort wears the check');
      assert.equal(await pop.locator('.wv-menu-row', { hasText: 'Sort descending' })
        .locator('.chip-pop-check').count(), 0, 'and only it does');
      // No '✓ ' shunting the label right: the check is a trailing slot.
      assert.equal((await asc.locator('.wv-menu-label').textContent()).trim(), 'Sort ascending');
      // Free consequence of using the house cue: focus opens on the live sort.
      assert.match(await page.evaluate(() => document.activeElement?.textContent ?? ''), /Sort ascending/);
      assert.equal(await pop.locator('.wv-menu-row', { hasText: 'Clear sort' }).count(), 1);
    } finally { await page.close(); }
  });

  // fields is a map keyed by id, so ask it by name.
  const hasField = (name) =>
    Object.values(weave.getTable(tasks.id).fields).some((f) => f.name === name);

  /* The gesture, exactly as a hand makes it: press, wait, release. */
  const hold = async (page, locator, ms) => {
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(ms);
    await page.mouse.up();
  };

  test('the hold still gates the delete, and says so before it is pressed', async () => {
    const page = await grid();
    try {
      const pop = await openMenu(page, 'Estimate');
      const del = pop.locator('.wv-menu-row.wv-menu-danger');
      assert.equal((await del.locator('.hold-hint').textContent()).trim().toLowerCase(), 'hold',
        'the row advertises its gesture at rest');

      // Released early: the field stands, and the panel is still open.
      await hold(page, del, 200);
      await page.waitForTimeout(350);
      assert.ok(hasField('Estimate'), 'a cancelled hold must delete nothing');

      // The sweep is the progress, so it must actually be sweeping mid-press.
      const box = await del.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(400);
      const mid = await page.evaluate(() => {
        const f = document.querySelector('.hold-btn.holding .hold-fill');
        return f ? new DOMMatrixReadOnly(getComputedStyle(f).transform).a : null;
      });
      assert.ok(mid > 0.15 && mid < 0.95, `the fill must be part-swept mid-hold, was ${mid}`);
      assert.equal(await page.evaluate(() =>
        Number(getComputedStyle(document.querySelector('.hold-btn.holding .hold-hint')).opacity)), 0,
        'and the hint gets out of the way once the press starts');
      await page.waitForTimeout(700);
      await page.mouse.up();

      await page.waitForTimeout(400);
      assert.ok(!hasField('Estimate'), 'a completed hold deletes the field');
    } finally { await page.close(); }
  });

  test('the panel holds its shape in both themes', async () => {
    const page = await grid();
    try {
      for (const theme of ['light', 'dark']) {
        await setTheme(page, theme);
        await openMenu(page, 'Priority');
        const rows = await rowMetrics(page);
        assert.equal(new Set(rows.map((r) => r.labelLeft)).size, 1, `${theme}: one left edge`);
        const paint = await page.evaluate(() => {
          const lum = (c) => {
            const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map((n) => {
              const v = Number(n) / 255;
              return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
          };
          const pop = document.querySelector('.chip-pop');
          const danger = pop.querySelector('.wv-menu-danger');
          const normal = pop.querySelector('.wv-menu-row:not(.wv-menu-danger)');
          const bg = (n) => {
            for (let e = n; e; e = e.parentElement) {
              const c = getComputedStyle(e).backgroundColor;
              if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c;
            }
            return 'rgb(255, 255, 255)';
          };
          return {
            panelLum: lum(bg(pop)),
            dangerLum: lum(getComputedStyle(danger).color),
            normalLum: lum(getComputedStyle(normal).color),
            fill: getComputedStyle(pop.querySelector('.hold-fill')).backgroundImage,
          };
        });
        // The panel follows the theme rather than staying a light card on a
        // dark page — the thing a token-less hard-coded colour gets wrong.
        assert.ok(theme === 'light' ? paint.panelLum > 0.5 : paint.panelLum < 0.5,
          `${theme}: the panel paints the wrong way (luminance ${paint.panelLum.toFixed(3)})`);
        // Danger must stay legible AND stay distinct from a plain row.
        assert.ok(Math.abs(paint.dangerLum - paint.normalLum) > 0.02,
          `${theme}: the destructive row does not read as destructive`);
        assert.match(paint.fill, /gradient/, `${theme}: the sweep keeps its leading edge`);
        await page.keyboard.press('Escape');
      }
    } finally { await page.close(); }
  });
}
