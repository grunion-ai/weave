/* The app at phone width (Issue #262).

   The 2026-09-12 audit opened the Issue table at 390x844 and 375x812 and
   found the workspace rail and the sidebar still in the layout at their
   desktop widths (316px together), the content column squeezed to about
   80px with the breadcrumb stacking a word to a line, nothing in the table
   reachable, and 163 of 202 tap targets under 32px. The shell's drawer
   (below 900px the sidebar, below 600px the rail too, opened by the crumb
   bar's menu button over a scrim) is test/phone-shell-browser.test.mjs's;
   here the open drawer holds the page and the keyboard, and under 768px
   the content takes the whole width, a docked entity opens as a
   full-width sheet instead of a side panel, and buttons, chips and row
   controls carry a hit area of at least 40px. At a desktop width nothing
   moves, and the last cases here pin that down at 1440x900.

   Both phone sizes the audit measured, in both themes: the drawer paints
   its own ground, which the desktop sidebar borrows from the canvas.

   Playwright is NOT a dependency of weave; the suite skips when absent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let issues, feature, rows = [];
const s = await launch('phone drawer', (weave) => {
  weave.createSpace({ name: 'Development' });
  issues = weave.createTable({ space: 'Development', name: 'Issue' });
  feature = weave.createTable({ space: 'Development', name: 'Feature' });
  weave.addField(issues, { name: 'Severity', type: 'select', config: { options: ['Low', 'High'] } });
  for (let i = 0; i < 6; i += 1) {
    rows.push(weave.createEntity('Issue', { name: `Looks broken: finding number ${i} from the audit`, values: { Severity: i % 2 ? 'High' : 'Low' } }));
  }
  // A record whose document is a diagram: its drawing opens as a whiteboard.
  weave.setDoc(rows[2].id, 'graph TD\n  A[Start] --> B[Finish]\n');
  // A reference chip in running text: the Feature table's description.
  weave.updateTable(feature.id, { description: `Words first.\n\nSee [[Issue#${rows[0].publicId}|the audit]] for it.\n\nWords last.` });
});

if (s) {
  const { base, browser } = s;
  const PHONES = [[390, 844], [375, 812]];

  const open = async ([width, height], theme, { pin = 0 } = {}) => {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: true });
    await page.addInitScript(([t, px]) => {
      localStorage.setItem('weave-theme', t);
      if (px) localStorage.setItem('wv-dock-width', String(px));
    }, [theme, pin]);
    await page.goto(`${base}/#/table/${issues.id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.wv-grid tbody tr.entity-row');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
    return page;
  };
  const rect = (page, sel) => page.evaluate((q) => {
    const n = document.querySelector(q);
    if (!n || !n.getClientRects().length) return null;
    const b = n.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  }, sel);
  const isOpen = (page) => page.evaluate(() => {
    const seen = (q) => { const n = document.querySelector(q); return !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden'; };
    // The scrim is #app's ::after, drawn while the drawer is open.
    const scrim = getComputedStyle(document.querySelector('#app'), '::after').content;
    return { rail: seen('#ws-rail'), sidebar: seen('#sidebar'), scrim: !['none', 'normal'].includes(scrim),
      expanded: document.querySelector('#main .nav-menu')?.getAttribute('aria-expanded') ?? null,
      mainInert: document.querySelector('#main').inert };
  });
  const focusIn = (page) => page.evaluate(() => {
    const a = document.activeElement;
    if (a?.matches('#main .nav-menu')) return 'menu';
    return a?.closest('#ws-rail, #sidebar') ? 'drawer' : (a?.id || a?.tagName || 'none');
  });
  // The hit box is what a finger meets, so it is measured the way a
  // finger meets it: the centre and the corners of a 40px square centred
  // on the control must land on the control (or the label that holds it).
  // The corners are probed a pixel in, because two 40px boxes may touch and
  // a collapsed cell border or a sub-pixel offset hands the shared edge to
  // the neighbour.
  const hitMisses = (page, sels) => page.evaluate((list) => list.map((q) => {
    const n = document.querySelector(q);
    if (!n || !n.getClientRects().length) return `${q}: not drawn`;
    // A cell's chip may sit past the grid's right edge; a reader scrolls
    // it over before tapping it, and so does the probe.
    n.scrollIntoView({ block: 'center', inline: 'center' });
    const b = n.getBoundingClientRect();
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const misses = [[0, 0], [-19, -19], [19, -19], [-19, 19], [19, 19]].map(([dx, dy]) => {
      const hit = document.elementFromPoint(cx + dx, cy + dy);
      if (hit && (n.contains(hit) || hit.closest('label')?.control === n)) return null;
      return `${dx},${dy} on ${hit ? hit.tagName + (hit.id ? '#' + hit.id : '') : 'nothing'}`;
    }).filter(Boolean);
    return misses.length ? `${q} (${Math.round(b.width)}x${Math.round(b.height)}) misses at ${misses.join('; ')}` : null;
  }).filter(Boolean), sels);
  // An rgb() colour, or an rgba() one at full alpha.
  const opaque = (c) => { const p = /rgba?\(([^)]+)\)/.exec(c)?.[1].split(','); return !!p && (p.length < 4 || Number(p[3]) === 1); };

  for (const vp of PHONES) {
    for (const theme of ['light', 'dark']) {
      const tag = `${vp[0]}x${vp[1]}, ${theme}`;

      test(`the content takes the whole width, the crumbs read on one line and the grid is in reach (${tag})`, async () => {
        const page = await open(vp, theme);
        try {
          assert.deepEqual(await isOpen(page), { rail: false, sidebar: false, scrim: false, expanded: 'false', mainInert: false },
            'the rail and the sidebar are out of the layout until the menu button asks for them');
          const menu = await rect(page, '#main .nav-menu');
          assert.ok(menu && menu.w >= 32 && menu.h >= 32, `a menu button in the crumb bar: ${JSON.stringify(menu)}`);
          const geo = await page.evaluate(() => {
            const main = document.querySelector('#main').getBoundingClientRect();
            const doc = document.documentElement;
            const crumbs = [...document.querySelectorAll('.view-header .crumb a')];
            const cell = document.querySelector('.wv-grid tbody tr.entity-row td.name-cell').getBoundingClientRect();
            const hit = document.elementFromPoint(cell.x + 8, cell.y + cell.height / 2);
            return { main: main.width, left: main.x, vw: doc.clientWidth, sideways: doc.scrollWidth - doc.clientWidth,
              crumbs: crumbs.length, wrapped: crumbs.filter((a) => a.getClientRects().length > 1).map((a) => a.textContent),
              nameLeft: cell.x, nameInGrid: !!hit?.closest('.wv-grid tbody tr.entity-row') };
          });
          assert.ok(geo.main >= geo.vw && geo.left <= 0, `#main spans the viewport: ${geo.main}px at x=${geo.left} of ${geo.vw}px`);
          assert.equal(geo.sideways, 0, 'no sideways page scroll');
          assert.ok(geo.crumbs >= 2, 'the crumb trail is drawn');
          assert.deepEqual(geo.wrapped, [], 'no crumb breaks across lines');
          assert.ok(geo.nameLeft >= 0 && geo.nameLeft < vp[0] / 2, `the Name column starts on screen: x=${geo.nameLeft}`);
          assert.ok(geo.nameInGrid, 'a tap on a Name cell lands in the grid, not on chrome over it');
        } finally { await page.close(); }
      });

      test(`the menu button opens the drawer over a scrim; scrim, Escape and navigation close it, and focus goes in and comes back (${tag})`, async () => {
        const page = await open(vp, theme);
        try {
          await page.click('#main .nav-menu');
          assert.deepEqual(await isOpen(page), { rail: true, sidebar: true, scrim: true, expanded: 'true', mainInert: true },
            'rail, sidebar and scrim are up and the page behind is inert');
          const drawer = await page.evaluate(() => {
            const side = document.querySelector('#sidebar');
            const b = side.getBoundingClientRect();
            return { bg: getComputedStyle(side).backgroundColor, right: b.right, h: b.height, vw: document.documentElement.clientWidth, vh: innerHeight };
          });
          assert.ok(opaque(drawer.bg), `the drawer paints its own ground in ${theme}: ${drawer.bg}`);
          assert.ok(drawer.right < drawer.vw - 40, `the scrim keeps a strip to tap: drawer ends at ${drawer.right} of ${drawer.vw}`);
          assert.ok(drawer.h >= drawer.vh - 1, 'the drawer runs the full height');
          assert.equal(await focusIn(page), 'drawer', 'focus moves into the drawer');
          for (let i = 0; i < 30; i += 1) {
            await page.keyboard.press('Tab');
            assert.equal(await focusIn(page), 'drawer', `Tab ${i + 1} stays inside the drawer`);
          }
          await page.keyboard.press('Shift+Tab');
          assert.equal(await focusIn(page), 'drawer', 'Shift+Tab stays inside the drawer');

          await page.keyboard.press('Escape');
          assert.deepEqual(await isOpen(page), { rail: false, sidebar: false, scrim: false, expanded: 'false', mainInert: false }, 'Escape closes it');
          assert.equal(await focusIn(page), 'menu', 'focus returns to the menu button');

          await page.click('#main .nav-menu');
          await page.mouse.click(vp[0] - 12, vp[1] / 2);
          assert.equal((await isOpen(page)).sidebar, false, 'a tap on the scrim closes it');
          assert.equal(await focusIn(page), 'menu', 'focus returns to the menu button after the scrim');

          await page.click('#main .nav-menu');
          await page.click('#sidebar .nav-db:has-text("Feature")');
          await page.waitForFunction(() => document.querySelector('.view-title')?.value === 'Feature');
          assert.equal((await isOpen(page)).sidebar, false, 'following a nav link closes it');
          assert.equal((await isOpen(page)).mainInert, false, 'and frees the page');
        } finally { await page.close(); }
      });

      test(`a docked entity opens as a full-width sheet, a stored pin included (${tag})`, async () => {
        const page = await open(vp, theme, { pin: 620 });
        try {
          await page.click(`tr[data-eid="${rows[0].id}"] .open-link`);
          await page.waitForSelector('#dock:not([hidden]) .name-edit');
          const geo = await page.evaluate(() => {
            const d = document.querySelector('#dock').getBoundingClientRect();
            const doc = document.documentElement;
            return { x: d.x, y: d.y, w: d.width, h: d.height, vw: doc.clientWidth, vh: innerHeight,
              gutter: document.querySelector('#dock-gutter').getClientRects().length,
              sideways: doc.scrollWidth - doc.clientWidth,
              top: document.elementFromPoint(doc.clientWidth / 2, innerHeight / 2)?.closest('#dock') !== null };
          });
          assert.ok(geo.x <= 0 && geo.w >= geo.vw, `the sheet spans the viewport: x=${geo.x}, ${geo.w}px of ${geo.vw}px`);
          assert.ok(geo.y <= 0 && geo.h >= geo.vh - 1, `and its height: y=${geo.y}, ${geo.h}px of ${geo.vh}px`);
          assert.equal(geo.gutter, 0, 'no divider under a sheet');
          assert.equal(geo.sideways, 0, 'the 320px table floor does not push the page sideways under the sheet');
          assert.ok(geo.top, 'the sheet is on top of the table');
          await page.click('#dock .dock-head button[aria-label="Close"]');
          assert.equal(await rect(page, '#dock'), null, 'the sheet closes from its own ✕');
        } finally { await page.close(); }
      });

      test(`rail items, toolbar buttons, chips and the row checkbox hold a 40x40 hit box (${tag})`, async () => {
        const page = await open(vp, theme);
        try {
          const probe = (sels) => hitMisses(page, sels);
          const row = `tr[data-eid="${rows[1].id}"]`;
          assert.deepEqual(await probe([
            '#main .nav-menu', '.table-search-btn', '.eye-btn', '.seg-opt.on',
            `${row} .k-select`, `${row} .sel-box`, `${row} .open-link`,
          ]), [], 'the menu button, toolbar buttons, a chip and the row controls');
          await page.click('#main .nav-menu');
          assert.deepEqual(await probe([
            '#ws-rail .ws-icon.active', '#ws-new', '#rail-help', '#theme-toggle',
            '#sidebar .nav-db.active', '#sidebar .nav-caret',
          ]), [], 'rail items and nav rows in the drawer');
        } finally { await page.close(); }
      });

      test(`a reference chip in a document keeps its kind glyph and holds a 40x40 hit box (${tag})`, async () => {
        const page = await open(vp, theme);
        try {
          await page.goto(`${base}/#/table/${feature.id}`, { waitUntil: 'networkidle' });
          await page.waitForSelector('.view-desc-body .k-rel > a.mention');
          await page.$eval('.view-desc-body', (b) => b.classList.remove('clamped'));
          const glyph = await page.$eval('.view-desc-body .k-rel > a.mention', (a) => {
            const cs = getComputedStyle(a, '::before');
            return { content: cs.content, position: cs.position };
          });
          assert.deepEqual(glyph, { content: '"#"', position: 'static' }, 'the # glyph still leads the chip, in the flow');
          assert.deepEqual(await hitMisses(page, ['.view-desc-body .k-rel > a.mention']), [], 'the chip\'s link holds a 40px hit box');
          const line = await page.evaluate(() => {
            const ps = [...document.querySelectorAll('.view-desc-body p')];
            const h = (t) => ps.find((p) => p.textContent.startsWith(t)).getBoundingClientRect().height;
            return { plain: h('Words first'), chip: h('See ') };
          });
          assert.equal(line.chip, line.plain, `the hit box does not grow the chip's line: ${JSON.stringify(line)}`);
        } finally { await page.close(); }
      });
    }
  }

  /* The sheet is a layer of the page, not a dialog over it: every surface
     that opens over the page (the full-screen viewer, a modal, the tray,
     the palette, a context menu, a toast, a picker) paints over the sheet,
     and the page's own floating chrome (the selection puck) goes under it.
     A held page is inert, and hit testing passes through an inert box, so
     the probe lifts every hold for the instant it asks what is painted on
     top: a sheet that paints over the viewer while the hold makes it
     untouchable is the bug, and the plain hit test cannot see it. */
  const topAt = (page, sel) => page.evaluate((q) => {
    const n = document.querySelector(q);
    if (!n || !n.getClientRects().length) return `${q}: not drawn`;
    const held = [...document.querySelectorAll('[inert]')];
    held.forEach((h) => { h.inert = false; });
    try {
      const b = n.getBoundingClientRect();
      const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return n.contains(hit) ? true : `${q} is under ${hit ? hit.tagName + (hit.id ? '#' + hit.id : '') + '.' + [...hit.classList].join('.') : 'nothing'}`;
    } finally { held.forEach((h) => { h.inert = true; }); }
  }, sel);
  for (const theme of ['light', 'dark']) {
    test(`over a docked sheet, the whiteboard and every other overlay paint on top (390x844, ${theme})`, async () => {
      const page = await open([390, 844], theme);
      try {
        await page.click(`tr[data-eid="${rows[2].id}"] .open-link`);
        await page.waitForSelector('#dock:not([hidden]) .mmd-tools button');
        await page.click('#dock .mmd-tools button');
        await page.waitForSelector('#fsv-back');
        assert.equal(await topAt(page, '#fsv-back'), true, 'the whiteboard is on top of the sheet');
        assert.equal(await topAt(page, '#fsv-back .fsv-bar button[title^="Close"]'), true, 'and its close button takes the tap');
        await page.click('#fsv-back .fsv-bar button[title^="Close"]');
        assert.equal(await page.$('#fsv-back'), null, 'the whiteboard closes from its own button');

        const opened = [
          ['#modal-back', () => modal('A modal', [Object.assign(document.createElement('input'), { name: 'a' })], async () => {})],
          ['#tray', () => tray('A tray', [Object.assign(document.createElement('input'), { name: 'a' })], async () => {})],
          ['#cmdk-back .cmdk, #cmdk-back > *', () => openCommandK()],
          ['.wv-ctx', () => contextMenu({ clientX: 120, clientY: 300 }, [{ label: 'An item', run: () => {} }])],
          ['.wv-toast', () => toast('A toast')],
        ];
        for (const [sel, fn] of opened) {
          await page.evaluate(fn);
          await page.waitForSelector(sel);
          assert.equal(await topAt(page, sel), true, `${sel} paints over the sheet`);
          await page.keyboard.press('Escape');
          await page.evaluate(() => document.querySelectorAll('#modal-back, #tray-back, #tray, #cmdk-back, .wv-ctx').forEach((n) => n.remove()));
        }
      } finally { await page.close(); }
    });

    test(`the selection puck goes under an open sheet and comes back when it closes (390x844, ${theme})`, async () => {
      const page = await open([390, 844], theme);
      try {
        await page.click(`tr[data-eid="${rows[1].id}"] .sel-box`);
        await page.waitForSelector('.sel-puck-wrap .sel-puck, .sel-puck-wrap > *');
        const puck = '.sel-puck-wrap > *';
        assert.equal(await topAt(page, puck), true, 'with no sheet the puck is on top');
        await page.click(`tr[data-eid="${rows[0].id}"] .open-link`);
        await page.waitForSelector('#dock:not([hidden]) .name-edit');
        const over = await page.evaluate((q) => {
          const n = document.querySelector(q);
          if (!n || !n.getClientRects().length) return 'hidden';
          const b = n.getBoundingClientRect();
          const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
          return hit?.closest('#dock') ? 'under the sheet' : `on top: ${hit?.tagName}.${[...(hit?.classList ?? [])].join('.')}`;
        }, puck);
        assert.ok(['hidden', 'under the sheet'].includes(over), `the puck is not the top element over the sheet: ${over}`);
        await page.click('#dock .dock-head button[aria-label="Close"]');
        assert.equal(await topAt(page, puck), true, 'the sheet closed, the puck is back on top');
      } finally { await page.close(); }
    });
  }

  test('with the drawer open, Shift+Enter, ⌘Z and ? leave the held page alone', async () => {
    const page = await open([390, 844], 'light');
    const writes = [];
    page.on('request', (r) => { if (r.method() !== 'GET') writes.push(`${r.method()} ${new URL(r.url()).pathname}`); });
    try {
      await page.click('#main .nav-menu');
      assert.equal((await isOpen(page)).mainInert, true);
      // Focus rests in the drawer on something no key activates.
      await page.$eval('#sidebar', (n) => { n.tabIndex = -1; n.focus(); });
      const rowsBefore = await page.$$eval('.wv-grid tbody tr.entity-row', (t) => t.length);
      await page.keyboard.press('Shift+Enter');
      await page.keyboard.press('Control+z');
      await page.keyboard.press('?');
      await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
      assert.deepEqual(writes, [], 'no row created and nothing undone behind the drawer');
      assert.equal(await page.$$eval('.wv-grid tbody tr.entity-row', (t) => t.length), rowsBefore, 'the grid behind has the rows it had');
      assert.equal(await page.$('#modal-back'), null, 'the key sheet does not open over the drawer');
      assert.equal((await isOpen(page)).sidebar, true, 'and the drawer is still open');
    } finally { await page.close(); }
  });

  for (const theme of ['light', 'dark']) {
    test(`at 1440x900 the desktop layout is unchanged: rail and sidebar in the flow, a side dock, no menu button (${theme})`, async () => {
      const page = await open([1440, 900], theme);
      try {
        assert.equal(await rect(page, '#main .nav-menu'), null, 'no menu button on a desktop');
        assert.deepEqual(await rect(page, '#ws-rail'), { x: 0, y: 0, w: 52, h: 900 });
        const side = await rect(page, '#sidebar');
        assert.deepEqual([side.x, side.w], [52, 264], 'the sidebar sits beside the rail at 264px');
        const main = await rect(page, '#main');
        assert.equal(main.x, 316, 'the page starts after rail and sidebar');
        const sizes = await page.evaluate(() => ({
          icon: [document.querySelector('#ws-new').offsetWidth, document.querySelector('#ws-new').offsetHeight],
          sel: getComputedStyle(document.querySelector('.wv-grid .sel-hit')).width,
          hitBox: !['none', 'normal'].includes(getComputedStyle(document.querySelector('.eye-btn'), '::before').content),
        }));
        assert.deepEqual(sizes, { icon: [36, 36], sel: '30px', hitBox: false }, 'desktop controls keep their sizes and carry no hit box');
        await page.click(`tr[data-eid="${rows[0].id}"] .open-link`);
        await page.waitForSelector('#dock-gutter:not([hidden])');
        const dock = await rect(page, '#dock');
        const after = await rect(page, '#main');
        assert.ok(dock.x > after.x + after.w, `the dock is a side panel right of the page: dock x=${dock.x}, main ends ${after.x + after.w}`);
        assert.ok(after.w >= 320, 'and the table keeps its floor beside it');
      } finally { await page.close(); }
    });
  }

  test('a drawer left open when the window grows to a desktop width closes and frees the page', async () => {
    const page = await open([390, 844], 'light');
    try {
      await page.click('#main .nav-menu');
      assert.equal((await isOpen(page)).mainInert, true);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForFunction(() => !document.querySelector('#main').inert);
      assert.equal(await page.evaluate(() => document.querySelector('#app').classList.contains('nav-peek')), false);
      assert.equal((await rect(page, '#main')).x, 316, 'the desktop layout is back');
    } finally { await page.close(); }
  });
}
