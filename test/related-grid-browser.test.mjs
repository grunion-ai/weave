/* The embedded relation table on an entity page (Issue #200), in a real
   browser. Kyle's screenshot on 2026-09-05: a Release's Fixes grid showed
   CHIP and CARD — the two system view fields every table hides by default
   (Feature #175) — and painted every cell as `[object Object]`.

   Two rulings this file proves in a DOM:

   1. The embedded grid IS the target table's view. Same columns, same order,
      same visibility: a field the target table hides stays hidden here, and
      unhiding it there (the eye, or the Tables registry row) surfaces it here
      on the next render — as a rendered chip, never a stringified object.
   2. A table cell never reads `[object Object]`. Every table surface — the
      table view, the embedded grid, the entity page, the Activity table — is
      swept for the string; and the generic cell fallback, handed a value it
      has no renderer for, draws an `unrendered <type>` marker instead of a
      text box holding String(obj). Same class as Issue #91 (daterange).

   Playwright is not a dependency (house rule); the harness skips the suite
   when it is absent. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let release, issueDb, releaseDb, fixed;

const s = await launch('embedded relation grid', (weave) => {
  weave.createSpace({ name: 'Dev' });
  issueDb = weave.createTable({ space: 'Dev', name: 'Issue' });
  releaseDb = weave.createTable({ space: 'Dev', name: 'Release' });
  weave.addField(issueDb, {
    name: 'Status', type: 'workflow',
    config: { states: [{ name: 'Open', category: 'not-started', default: true }, { name: 'Fixed', category: 'done' }] },
  });
  weave.addField(issueDb, { name: 'Severity', type: 'select', config: { options: ['Low', 'High'] } });
  weave.addField(issueDb, { name: 'Notes', type: 'text' });
  weave.addRelation(releaseDb, { name: 'Fixes', targetDb: 'Issue', cardinality: 'one-to-many', inverseName: 'Fixed in' });
  fixed = weave.createEntity('Issue', { name: 'Chips leak their object' });
  weave.setState(fixed.id, 'Status', 'Fixed');
  weave.updateEntity(fixed.id, { Severity: 'High', Notes: 'seen on :4400' });
  const other = weave.createEntity('Issue', { name: 'Second one' });
  release = weave.createEntity('Release', { name: 'v0.4.6' });
  weave.link(release.id, 'Fixes', [fixed.id, other.id]);
  // The target table hides Notes on top of the default Chip/Card.
  weave.updateTable(issueDb.id, { hiddenFields: ['Chip', 'Card', 'Notes'] });
});

if (s) {
  const { base, browser, weave } = s;
  const open = async (hash, { colorScheme = 'light' } = {}) => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme });
    await page.goto(`${base}/#/${hash}`, { waitUntil: 'load' });
    return page;
  };
  const grid = (page) => page.waitForSelector('.related-section .wv-grid thead', { state: 'attached' });
  const heads = (page) => page.$$eval('.related-section thead th', (ths) => ths.map((t) => t.textContent.trim()).filter(Boolean));
  const leaks = (page) => page.evaluate(() => (document.body.innerText.match(/\[object Object\]/g) ?? []).length
    + [...document.querySelectorAll('input, textarea')].filter((i) => /\[object Object\]/.test(i.value)).length);

  test('the embedded grid hides what the target table hides — Chip, Card and Notes stay out; Name, Status, Severity show', async () => {
    const page = await open(`entity/${release.id}`);
    await grid(page);
    assert.deepEqual(await heads(page), ['#', 'Name', 'Status', 'Severity'],
      'the target table\'s visible columns, in its order; hidden fields and the inverse relation stay out');
    assert.equal(await leaks(page), 0, 'no cell reads [object Object]');
    await page.close();
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`unhiding Chip on the Issue table surfaces it in the embedded grid as a rendered chip (${colorScheme})`, async () => {
      weave.updateTable(issueDb.id, { hiddenFields: ['Card', 'Notes'] });
      try {
        const page = await open(`entity/${release.id}`, { colorScheme });
        await grid(page);
        assert.equal(await page.$eval('html', (h) => h.dataset.bsTheme), colorScheme, 'the page resolved the theme under test');
        assert.deepEqual(await heads(page), ['#', 'Name', 'Status', 'Severity', 'Chip'], 'the toggle carries into the embedded grid');
        const chip = await page.$eval('.related-section tbody tr:first-child td:nth-child(5)', (td) => {
          const k = td.querySelector('.k.k-rel');
          return {
            text: td.textContent.trim(),
            hasChip: !!k,
            href: k?.querySelector('a')?.getAttribute('href') ?? null,
            visible: k ? getComputedStyle(k).borderTopColor !== 'rgba(0, 0, 0, 0)' : false,
            state: k?.querySelector('.wv-seg-state')?.textContent ?? null,
          };
        });
        assert.equal(chip.hasChip, true, 'the view value renders as the chip it describes');
        assert.equal(chip.href, `#/entity/${fixed.id}`, 'and the chip links to its row');
        assert.match(chip.text, /Chips leak their object/);
        assert.equal(chip.visible, true, `the chip outline paints in ${colorScheme}`);
        assert.equal(chip.state, 'Fixed', 'the chip carries the state segment the config asks for');
        assert.equal(await leaks(page), 0);
        await page.close();
      } finally {
        weave.updateTable(issueDb.id, { hiddenFields: ['Chip', 'Card', 'Notes'] });
      }
    });
  }

  test('no table surface paints [object Object]: every table view, one entity per table, the Activity table', async () => {
    const page = await open(`table/${issueDb.id}`);
    await page.waitForSelector('.wv-grid tbody tr');
    const dbs = [issueDb.id, releaseDb.id];
    for (const id of dbs) {
      await page.goto(`${base}/#/table/${id}`, { waitUntil: 'load' });
      await page.waitForSelector('.wv-grid tbody tr');
      assert.equal(await leaks(page), 0, `table view ${id} is clean`);
    }
    for (const id of [fixed.id, release.id]) {
      await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'load' });
      await page.waitForSelector('.entity-grid');
      await page.waitForTimeout(200);
      assert.equal(await leaks(page), 0, `entity page ${id} is clean`);
    }
    await page.goto(`${base}/#/activity`, { waitUntil: 'load' });
    await page.waitForTimeout(300);
    assert.equal(await leaks(page), 0, 'the Activity table is clean');
    await page.close();
  });

  test('the generic cell fallback refuses to stringify an object: an unrendered marker names the type instead', async () => {
    const page = await open(`entity/${release.id}`);
    await page.waitForSelector('.entity-grid');
    const out = await page.evaluate(() => {
      // A field type with no renderer, carrying an object — the exact shape
      // Issue #91 and Issue #200 leaked through.
      const f = { name: 'Mystery', type: 'mystery' };
      const item = { id: 'x', fields: { Mystery: { a: 1 } }, raw: { Mystery: { a: 1 } } };
      const node = globalThis.editorFor(f, item, null, () => {}, { compact: true });
      const box = document.createElement('div'); box.append(node); document.body.append(box);
      const r = { tag: node.tagName, text: node.textContent, value: node.value ?? null, cls: node.className,
        visible: getComputedStyle(node).display !== 'none' };
      box.remove();
      return r;
    });
    assert.notEqual(out.tag, 'INPUT', 'no text box holding String(obj)');
    assert.equal(out.value, null);
    assert.doesNotMatch(out.text, /\[object Object\]/);
    assert.match(out.text, /unrendered mystery/, 'the marker names the type so the gap is visible');
    assert.match(out.cls, /wv-unrendered/);
    assert.equal(out.visible, true);
    await page.close();
  });
}
