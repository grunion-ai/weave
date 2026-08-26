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
      const choices = fieldDialogCore.iconChoices(Object.keys(window.ICONLY_FLAT ?? {}));
      return { total: choices.length, marks: choices.filter((c) => c.mark).length, flat: choices.filter((c) => c.iconly).length };
    });
    assert.equal(picked.marks, 13, 'the thirteen marks survive the merge');
    assert.ok(picked.flat > 90, `the flat set is offered too, got ${picked.flat}`);
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
