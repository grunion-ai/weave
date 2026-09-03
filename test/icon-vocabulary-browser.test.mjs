/* One icon vocabulary, driven through a real browser (Issue #87).

   A space or table picked its icon from 101 flat SVGs through a searchable
   picker. A select option or workflow state picked from fourteen typographic
   marks, in a different file, through a different control, at a different
   size — and the paint site printed the stored string as text, so an
   `iconly:` name chosen for an option would have shown up as the literal
   words. Kyle asked for the vocabularies to be expanded, unified and
   normalised for size; these are the claims a source assertion cannot make.

   Playwright is NOT a dependency of weave; it is imported dynamically and the
   suite skips when absent, so `node --test` stays green on a bare checkout. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Weave } from '../src/engine.js';
import { startServer } from '../src/server.js';

const chromium = await import('playwright')
  .then((pw) => pw.chromium)
  .catch(() => null);

if (!chromium) {
  test('icon vocabulary (browser)', { skip: 'playwright not installed' }, () => {});
} else {
  let server, base, browser, weave, tasks, row;

  test.before(async () => {
    weave = new Weave();
    weave.createSpace({ name: 'Product' });
    tasks = weave.createTable({ space: 'Product', name: 'Task' });
    // A nav row with a moving icon of its own: the load-wave test below used
    // to lean on the Relation map row's compass, which left the nav 2026-09-02.
    weave.createTable({ space: 'Product', name: 'Pulse', icon: 'lucide:activity' });
    weave.addField(tasks, { name: 'Priority', type: 'select', config: { options: [
      { name: 'Urgent', icon: 'iconly:danger' },
      { name: 'Later', icon: '○' },
    ] } });
    weave.addField(tasks, { name: 'Stage', type: 'workflow', config: { states: [
      { name: 'Building', icon: 'lucide:activity', category: 'in-progress', default: true },
      { name: 'Shipped', icon: '✓', category: 'done' },
    ] } });
    row = weave.createEntity(tasks, { name: 'Icon case', values: { Priority: 'Urgent' } }).id;
    ({ server } = await startServer(weave, { port: 0 }));
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch();
  });

  test.after(async () => {
    await browser?.close();
    server?.close();
  });

  const entityPage = async () => {
    const page = await browser.newPage();
    // Size gates measure resting boxes; the motion has its own test below.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${base}/#/entity/${row}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.entity-fields .fieldrow');
    return page;
  };

  test('an option wearing a flat icon draws the icon, not its name', async () => {
    const page = await entityPage();
    const chip = page.locator('.entity-fields .fieldrow', { hasText: 'Priority' }).first().locator('.k-select').first();
    assert.doesNotMatch(await chip.textContent(), /iconly:/, 'the stored value leaked into the chip as text');
    assert.equal(await chip.locator('svg').count(), 1, 'the flat icon must draw as an svg');
    await page.close();
  });

  test('a state wearing a flat icon draws it too', async () => {
    const page = await entityPage();
    const chip = page.locator('.entity-fields .fieldrow', { hasText: 'Stage' }).first().locator('.k-state, .k-select').first();
    assert.doesNotMatch(await chip.textContent(), /iconly:/);
    assert.equal(await chip.locator('svg').count(), 1);
    await page.close();
  });

  test('a mark still draws as itself — old rows keep their glyph', async () => {
    const page = await entityPage();
    const picked = await page.evaluate(() => {
      // The picker's own list is what an author reads; both dialects come
      // from one catalogue now.
      const choices = iconCatalogue();
      return { total: choices.length, marks: choices.filter((c) => c.mark).length, flat: choices.filter((c) => c.lucide).length, set: fieldDialogCore.ICON_INVENTORY.length };
    });
    assert.equal(picked.marks, 18, 'thirteen originals plus the five Kyle accepted');
    assert.equal(picked.flat, picked.set, `the whole inventory is offered, got ${picked.flat} of ${picked.set}`);
    await page.close();
  });

  test('a mark draws as a vector, at the size a flat icon draws', async () => {
    const page = await entityPage();
    const row = page.locator('.entity-fields .fieldrow', { hasText: 'Priority' }).first();
    // 'Later' wears '○'. Open the picker so both dialects are on screen at once.
    const box = await page.evaluate(() => {
      var out = {};
      var svgs = [].slice.call(document.querySelectorAll('.wv-icon svg, .ico svg'));
      out.count = svgs.length;
      // Layout width, not the painted box: an icon mid-motion is scaled, not resized.
      out.widths = svgs.map(function (s) { return Math.round(parseFloat(getComputedStyle(s).width)); });
      return out;
    });
    assert.ok(box.count >= 2);
    assert.equal(new Set(box.widths).size, 1, `icons drew at ${box.widths.join(', ')}px — one scale means one width`);
    await page.close();
  });

  test('every mark fills its canvas — none of them draws small', async () => {
    const page = await entityPage();
    const bad = await page.evaluate(() => {
      // getBBox measures path geometry, so a stroked mark is painted half a
      // stroke wider on each side than its box says.
      var out = [];
      var marks = window.weaveMarkIcons.MARKS;
      var host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0';
      document.body.appendChild(host);
      Object.keys(marks).forEach(function (k) {
        var sw = /stroke-width="([\d.]+)"/.exec(marks[k]);
        var pad = sw ? Number(sw[1]) / 2 : 0;
        host.innerHTML = '<svg viewBox="0 0 24 24" width="64" height="64" fill="currentColor">' + marks[k] + '</svg>';
        var b = host.firstChild.getBBox();
        var x0 = b.x - pad, y0 = b.y - pad, x1 = b.x + b.width + pad, y1 = b.y + b.height + pad;
        if (x0 < -0.5 || y0 < -0.5 || x1 > 24.5 || y1 > 24.5) {
          out.push(k + ' overflows: ' + [x0, y0, x1, y1].map(Math.round).join(','));
        }
        // Kyle's report was optical: a quarter-filled circle and a refresh
        // glyph that came out visibly smaller than the marks beside them.
        // Every mark has to span most of the canvas in its long axis.
        var span = Math.max(x1 - x0, y1 - y0);
        if (span < 15) out.push(k + ' spans only ' + Math.round(span) + ' of 24');
      });
      host.remove();
      return out;
    });
    assert.deepEqual(bad, [], 'marks that overflow the canvas, or draw small inside it');
    await page.close();
  });

  test('the vendored set sits inside its canvas at one stroke — no scale table needed', async () => {
    const page = await entityPage();
    const bad = await page.evaluate(() => {
      var out = [], spans = [];
      var host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0';
      document.body.appendChild(host);
      Object.keys(window.LUCIDE_MOVING).forEach(function (n) {
        host.innerHTML = window.LUCIDE_MOVING[n];
        var b = host.firstChild.getBBox();
        var x0 = b.x - 1, y0 = b.y - 1, x1 = b.x + b.width + 1, y1 = b.y + b.height + 1;
        if (x0 < -0.5 || y0 < -0.5 || x1 > 24.5 || y1 > 24.5) out.push(n + ' overflows: ' + [x0, y0, x1, y1].map(Math.round).join(','));
        spans.push(Math.max(x1 - x0, y1 - y0));
      });
      host.remove();
      spans.sort(function (a, b) { return a - b; });
      return { out: out, median: spans[Math.floor(spans.length / 2)], small: spans.filter(function (s) { return s < 15; }).length, n: spans.length };
    });
    assert.deepEqual(bad.out, [], 'icons overflowing the canvas');
    assert.ok(bad.median >= 19, `the set should fill its grid; median long axis ${bad.median} of 24`);
    // Lucide draws a few glyphs small on purpose (ellipsis, minus, equal);
    // the point is that they are the exception, not one icon in five.
    assert.ok(bad.small / bad.n < 0.05, `${bad.small} of ${bad.n} icons span under 15 of 24`);
    await page.close();
  });

  test('a hidden name still draws when a row already stored it', async () => {
    const id = weave.createEntity(tasks, { name: 'Legacy icon' }).id;
    weave.updateField(tasks, 'Priority', { config: { options: [
      { name: 'Urgent', icon: 'iconly:arrow-upsquare' }, { name: 'Later', icon: '○' },
    ] } });
    weave.updateEntity(id, { Priority: 'Urgent' });
    const page = await browser.newPage();
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.entity-fields .fieldrow');
    const chip = page.locator('.entity-fields .fieldrow', { hasText: 'Priority' }).first().locator('.k-select').first();
    assert.equal(await chip.locator('svg').count(), 1, 'hiding a name from the picker must not blank an existing row');
    const offered = await page.evaluate(() => iconCatalogue().some((c) => c.id === 'iconly:arrow-upsquare'));
    assert.equal(offered, false, 'and it must be gone from the offer');
    await page.close();
  });

  test('a legacy iconly: value draws its Lucide twin, and the picker offers the twin once', async () => {
    const page = await entityPage();
    const out = await page.evaluate(() => {
      var o = { drawn: 0, ghosts: 0 };
      ['dollar', 'notification', 'bug', 'arrow-up2', 'ticksquare'].forEach(function (n) {
        var el = iconEl('iconly:' + n);
        if (el.querySelector('svg')) o.drawn++;
        if (el.classList.contains('icon-ghost')) o.ghosts++;
      });
      o.text = iconEl('iconly:notification').textContent.trim();
      o.twin = iconEl('iconly:notification').className;
      var ids = iconCatalogue().map(function (c) { return c.id; });
      o.offered = ids.filter(function (id) { return id === 'lucide:dollar-sign'; }).length;
      o.legacyOffered = ids.filter(function (id) { return /^iconly:/.test(id); }).length;
      return o;
    });
    assert.equal(out.drawn, 5, 'every legacy value still draws');
    assert.equal(out.ghosts, 0);
    assert.equal(out.text, '', 'the prefix never reaches the screen');
    assert.match(out.twin, /mi-bell/, 'notification draws as the bell');
    assert.equal(out.offered, 1, 'the twin is offered once, under its own name');
    assert.equal(out.legacyOffered, 0, 'the old names are aliases, not choices');
    await page.close();
  });

  /* Kyle, 2026-08-29: "Icons should be shown in a grid not a list, no names
     are needed next to each, this takes up too much space." */
  async function openIconPicker(page) {
    await page.locator('.entity-fields .fieldrow', { hasText: 'Priority' }).first().locator('.k-select').first().click();
    await page.waitForSelector('.chip-pop');
  }

  test('the icon picker is a grid of icons, with no name beside any of them', async () => {
    const page = await entityPage();
    // The field dialog is where a state or option icon is chosen; the table
    // header is the other gate. Both open the same control.
    await page.goto(`${base}/#/table/${tasks.id ?? tasks}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.icon-btn');
    await page.locator('.icon-btn').first().click();
    await page.waitForSelector('.chip-pop');

    assert.ok(await page.locator('.picker-cells').count() > 0, 'the icons must draw as a grid');
    assert.equal(await page.locator('.picker-row').count(), 0, 'no list rows survive in grid mode');
    assert.equal(await page.locator('.picker-num').count(), 0, 'no numbered quick-select');

    const cells = page.locator('.picker-cell');
    assert.ok(await cells.count() > 90, 'the whole catalogue is offered');
    // Every cell draws a shape and names nothing. The leading clear cell wears
    // a ghost ring, which is a glyph, not a label — so the assertion is that
    // no WORD reaches a cell.
    const text = (await cells.allTextContents()).join('');
    assert.doesNotMatch(text, /[a-z0-9]/i, `a cell is carrying a label: ${text.slice(0, 60)}`);
    // The first cell is the clear control; the icons start after it.
    assert.equal(await cells.nth(1).locator('svg').count(), 1);
    // The name is not gone, it moved to the tooltip.
    assert.ok(await cells.nth(1).getAttribute('title'), 'a cell must name itself on hover');
    // The current value is the ring on a cell, not a chip eating the search
    // box — an unset icon used to stage a "No icon" chip there.
    assert.equal(await page.locator('.picker-chip').count(), 0, 'the grid stages no chips');
    // Clearing is the first cell, not a footer (Kyle, 2026-08-29).
    assert.equal(await page.locator('.picker-clear').count(), 0, 'no footer clear survives');
    assert.equal(await cells.first().getAttribute('title'), 'No icon', 'clearing leads the grid');
    assert.ok(await cells.first().locator('.icon-ghost').count(), 'and wears the ghost ring');
    assert.equal(await page.locator('.picker-search').getAttribute('placeholder'), 'Search by name or category…');
    await page.close();
  });

  test('category headings label the grid, and search takes a category', async () => {
    const page = await entityPage();
    await page.goto(`${base}/#/table/${tasks.id ?? tasks}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.icon-btn');
    await page.locator('.icon-btn').first().click();
    await page.waitForSelector('.picker-cells');
    const cats = await page.locator('.picker-cat').allTextContents();
    assert.ok(cats.includes('money'), `categories are the labels, got ${cats.join(', ')}`);

    await page.locator('.picker-search').fill('money');
    await page.waitForTimeout(150);
    assert.deepEqual(await page.locator('.picker-cat').allTextContents(), ['money'],
      'a heading leaves with its icons');
    assert.ok(await page.locator('.picker-cell').count() >= 10, 'the whole money group survives the search');
    await page.close();
  });

  test('clicking a cell commits that icon', async () => {
    const page = await entityPage();
    await page.goto(`${base}/#/table/${tasks.id ?? tasks}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.icon-btn');
    await page.locator('.icon-btn').first().click();
    await page.waitForSelector('.picker-cells');
    await page.locator('.picker-search').fill('wallet');
    await page.waitForTimeout(150);
    await page.locator('.picker-cell[title="wallet"]').click();
    await page.waitForTimeout(400);
    const db = weave.getTable(typeof tasks === 'string' ? tasks : tasks.id);
    assert.equal(db.icon, 'lucide:wallet');
    await page.close();
  });

  test('an icon name that no longer resolves shows a ring, not its own prefix', async () => {
    // Kyle, 2026-08-29, from a screenshot: an option was rendering the literal
    // text `iconly:slides` into its icon slot, clipped to "iconl". A reference
    // that does not resolve is not an emoji and must not paint itself.
    const page = await entityPage();
    const drawn = await page.evaluate(() => {
      const dead = iconEl('iconly:slides');
      const emoji = iconEl('🎉');
      return {
        deadText: dead.textContent,
        deadTitle: dead.getAttribute('title'),
        deadGhost: dead.classList.contains('icon-ghost'),
        emojiText: emoji.textContent,
      };
    });
    assert.doesNotMatch(drawn.deadText, /iconly:/, 'the prefix must never reach the screen');
    assert.equal(drawn.deadGhost, true);
    assert.match(drawn.deadTitle, /slides/, 'the tooltip still names what was set');
    assert.equal(drawn.emojiText, '🎉', 'a bare string still paints itself');
    await page.close();
  });

  test('an icon rests lighter than its label and darkens when the row is current', async () => {
    // Kyle, 2026-09-02: the greyed icons read better than full-weight ones.
    // The token is the page's own ink at a fraction, so the grey keeps the
    // kit's blue bias in both themes rather than going flat neutral.
    const page = await entityPage();
    const seen = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const nav = document.querySelector('.nav-db .nav-icon') || document.querySelector('.nav-icon');
      const label = document.querySelector('.nav-db') || document.body;
      // The resting colour carries an alpha, so what a reader sees is the ink
      // composited over the page. Comparing the raw channels would compare the
      // ink to itself.
      const ground = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g).map(Number);
      const lum = (c) => {
        const p = c.match(/[\d.]+/g).map(Number);
        const a = p.length > 3 ? p[3] : 1;
        const [r, g, b] = [0, 1, 2].map((i) => a * p[i] + (1 - a) * ground[i]);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      return {
        token: root.getPropertyValue('--wv-icon-rest').trim(),
        icon: nav ? getComputedStyle(nav).color : null,
        text: getComputedStyle(label).color,
        iconLum: nav ? lum(getComputedStyle(nav).color) : null,
        textLum: lum(getComputedStyle(label).color),
      };
    });
    assert.ok(seen.token, '--wv-icon-rest must be declared');
    assert.ok(seen.icon, 'the nav must draw an icon to measure');
    // Lighter means closer to the page, so a higher luminance on a light ground.
    assert.ok(seen.iconLum > seen.textLum,
      `the icon (${seen.icon}) should rest lighter than its label (${seen.text})`);
    await page.close();
  });

  test('an icon plays once on load and once per hover, and rests — nothing loops (Kyle, 2026-09-02)', async () => {
    const page = await browser.newPage();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(`${base}/#/entity/${row}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#nav .wv-icon.mi:not([data-ms="0"])');
    // The load wave: inside the load window some icon wears its motion parts.
    await page.waitForFunction(() => [...document.querySelectorAll('#nav .mi [data-mi]')].some((p) => p.classList.contains(p.dataset.mi.split(' ')[0])), null, { timeout: 4000 });
    // …and every one of them rests again: nothing loops.
    await page.waitForFunction(() => ![...document.querySelectorAll('#nav .mi [data-mi]')].some((p) => p.classList.contains(p.dataset.mi.split(' ')[0])), null, { timeout: 8000 });
    const host = page.locator('#nav .wv-icon.mi:not([data-ms="0"])').first();
    const ms = Number(await host.getAttribute('data-ms'));
    await host.hover();
    await page.waitForTimeout(80);
    const armed = await host.evaluate((el) => [...el.querySelectorAll('[data-mi]')].every((p) => p.classList.contains(p.dataset.mi.split(' ')[0])));
    assert.ok(armed, 'a hover plays the icon');
    await page.waitForTimeout(ms + 300);
    const rested = await host.evaluate((el) => [...el.querySelectorAll('[data-mi]')].some((p) => p.classList.contains(p.dataset.mi.split(' ')[0])));
    assert.equal(rested, false, `after its ${ms} ms run the icon rests — it does not loop`);
    await page.close();
  });

  test('every icon on the page is drawn to the one size scale', async () => {
    const page = await entityPage();
    const sizes = await page.evaluate(() => {
      const scale = ['--wv-icon-sm', '--wv-icon-md', '--wv-icon-lg']
        .map((v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim())
        .filter(Boolean);
      const drawn = [...document.querySelectorAll('.wv-icon svg, .ico svg')]
        .map((s) => `${Math.round(parseFloat(getComputedStyle(s).width))}px`);
      return { scale, drawn };
    });
    assert.equal(sizes.scale.length, 3, 'the scale must be declared as custom properties');
    assert.ok(sizes.drawn.length > 0, 'the page must actually draw some icons');
    for (const w of sizes.drawn) {
      assert.ok(sizes.scale.includes(w), `an icon drew at ${w}, outside the scale ${sizes.scale.join(' / ')}`);
    }
    await page.close();
  });
}
