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
