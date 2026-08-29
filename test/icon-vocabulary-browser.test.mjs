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
    weave.addField(tasks, { name: 'Priority', type: 'select', config: { options: [
      { name: 'Urgent', icon: 'iconly:danger' },
      { name: 'Later', icon: '○' },
    ] } });
    weave.addField(tasks, { name: 'Stage', type: 'workflow', config: { states: [
      { name: 'Building', icon: 'iconly:activity', category: 'in-progress', default: true },
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
      return { total: choices.length, marks: choices.filter((c) => c.mark).length, flat: choices.filter((c) => c.iconly).length };
    });
    assert.equal(picked.marks, 18, 'thirteen originals plus the five Kyle accepted');
    // 101 vendored, 23 near-duplicates hidden, 8 of our own added.
    assert.equal(picked.flat, 101 - 23 + 8, `the offer is wrong, got ${picked.flat}`);
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
      out.widths = svgs.map(function (s) { return Math.round(s.getBoundingClientRect().width); });
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

  test('no icon draws small — the vendored set included', async () => {
    const page = await entityPage();
    const small = await page.evaluate(() => {
      // Kyle, 2026-08-26: "bug looks too small". Iconly's own icons do not all
      // fill the canvas; measured across 101 the median long axis is 20 of 24
      // and five sat far under it. weaveMarkIcons.scaled corrects those.
      var out = [];
      var host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0';
      document.body.appendChild(host);
      Object.keys(window.ICONLY_FLAT).forEach(function (n) {
        host.innerHTML = '<svg viewBox="0 0 24 24" width="64" height="64" fill="currentColor">'
          + window.weaveMarkIcons.scaled(n, window.ICONLY_FLAT[n]) + '</svg>';
        var b = host.firstChild.getBBox();
        var span = Math.max(b.width, b.height);
        if (span < 17) out.push(n + ' spans ' + span.toFixed(1) + ' of 24');
        if (b.x < -0.5 || b.y < -0.5 || b.x + b.width > 24.5 || b.y + b.height > 24.5) {
          out.push(n + ' overflows after scaling');
        }
      });
      host.remove();
      return out;
    });
    assert.deepEqual(small, [], 'icons drawing small beside their neighbours');
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

  test('the money icons we drew resolve through the same prefix', async () => {
    const page = await entityPage();
    const drawn = await page.evaluate(() => {
      var out = {};
      ['dollar', 'euro', 'invoice', 'bank'].forEach(function (n) {
        var el = iconEl('iconly:' + n);
        out[n] = !!(el && el.querySelector('svg'));
      });
      out.offered = iconCatalogue().filter(function (c) { return c.id === 'iconly:dollar'; }).length;
      return out;
    });
    assert.deepEqual(drawn, { dollar: true, euro: true, invoice: true, bank: true, offered: 1 });
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
    // Every cell draws an icon and says nothing.
    const text = (await cells.allTextContents()).join('').trim();
    assert.equal(text, '', `a cell is carrying a label: ${text.slice(0, 60)}`);
    assert.equal(await cells.first().locator('svg').count(), 1);
    // The name is not gone, it moved to the tooltip.
    assert.ok(await cells.first().getAttribute('title'), 'a cell must name itself on hover');
    // The current value is the ring on a cell, not a chip eating the search
    // box — an unset icon used to stage a "No icon" chip there.
    assert.equal(await page.locator('.picker-chip').count(), 0, 'the grid stages no chips');
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
    await page.locator('.picker-cell').first().click();
    await page.waitForTimeout(400);
    const db = weave.getTable(typeof tasks === 'string' ? tasks : tasks.id);
    assert.equal(db.icon, 'iconly:wallet');
    await page.close();
  });

  test('every icon on the page is drawn to the one size scale', async () => {
    const page = await entityPage();
    const sizes = await page.evaluate(() => {
      const scale = ['--wv-icon-sm', '--wv-icon-md', '--wv-icon-lg']
        .map((v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim())
        .filter(Boolean);
      const drawn = [...document.querySelectorAll('.wv-icon svg, .ico svg')]
        .map((s) => `${Math.round(s.getBoundingClientRect().width)}px`);
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
