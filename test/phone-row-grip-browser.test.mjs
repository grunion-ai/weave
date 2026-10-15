import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage, eventually } from './lib/browser.mjs';

let people;

const s = await launch('phone row grip', (weave) => {
  weave.createSpace({ name: 'Showcase' });
  people = weave.createTable({ space: 'Showcase', name: 'Person' });
});
if (s) {
  const { base, browser, weave } = s;
  let n = 0;
  const build = () => {
    const db = weave.createTable({ space: 'Showcase', name: `Part ${++n}` });
    weave.addField(db, { name: 'Vendor', type: 'text' });
    weave.addField(db, { name: 'Batch', type: 'text' });
    weave.addField(db, { name: 'Brief', type: 'document' });
    weave.addField(db, { name: 'Files', type: 'attachments' });
    weave.addRelation(db, { name: 'Peers', targetDb: people, cardinality: 'many-to-many', inverseName: `Owns ${n}` });
    return weave.createEntity(db, { name: 'Sensor board', values: { Vendor: 'Nordic', Batch: 'B-12' } }).id;
  };

  const ready = async (page, id) => {
    await page.goto(`${base}/#/entity/${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.entity-values .fieldrow');
    await page.waitForSelector('[data-block="Peers"]');
    return page;
  };
  const phone = async (id, theme) => {
    const page = await phonePage(await phoneBrowser());
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    return ready(page, id);
  };
  const desktop = async (id) => ready(await browser.newPage({ viewport: { width: 1280, height: 900 } }), id);

  const DECORATION = [
    '.entity-fields .fieldrow .opt-grip',
    '.block-head .opt-grip',
    '.entity-body > .doc-section .doc-section-head .opt-grip',
  ];

  for (const theme of ['light', 'dark']) {
    test(`a phone row page draws no decorative grip (${theme}, Issue #806)`, async () => {
      const page = await phone(build(), theme);
      for (const sel of DECORATION) {
        const grips = page.locator(sel);
        const count = await grips.count();
        assert.ok(count > 0, `${sel} is still built into the page, got ${count}`);
        for (let i = 0; i < count; i += 1) {
          const box = await grips.nth(i).boundingBox();
          assert.equal(box, null, `${sel} #${i} still takes a layout box on a phone: ${JSON.stringify(box)}`);
        }
      }
      await page.close();
    });
  }

  test("a phone field row starts its label at the row's content edge (Issue #806, Issue #741)", async () => {
    const page = await phone(build(), 'light');
    const row = page.locator('.entity-values .fieldrow').first();
    const rowBox = await row.boundingBox();
    const labelBox = await row.locator('.fieldrow-label').boundingBox();
    const pad = await row.evaluate((n) => parseFloat(getComputedStyle(n).paddingLeft) || 0);
    const indent = Math.round(labelBox.x - rowBox.x - pad);
    assert.ok(indent <= 2, `the label is indented ${indent}px past the row's own gutter by the empty grip column`);
    await page.close();
  });

  test('a phone field row is still the handle that lifts it (Issue #806)', async () => {
    const page = await phone(build(), 'light');
    const rows = () => page.$$eval('.entity-values > .fieldrow:not(.fieldrow-system)', (ns) => ns.map((x) => x.dataset.field));
    assert.deepEqual(await rows(), ['Vendor', 'Batch'], 'the two text fields start in their declared order');
    const handle = await page.$$eval('.entity-values > .fieldrow:not(.fieldrow-system)',
      (ns) => ns.every((x) => x.classList.contains('wv-reorder-handle')));
    assert.equal(handle, true, 'every draggable field row carries wv-reorder-handle');
    const from = await page.locator('.entity-values > .fieldrow[data-field="Batch"]').boundingBox();
    const onto = await page.locator('.entity-values > .fieldrow[data-field="Vendor"]').boundingBox();
    await page.mouse.move(from.x + 4, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(onto.x + 4, onto.y + 2, { steps: 10 });
    assert.equal(await page.locator('.wv-reorder-lift').count(), 1, 'pressing the row itself lifts it');
    await page.mouse.up();
    assert.deepEqual(await eventually(rows, ['Batch', 'Vendor']), ['Batch', 'Vendor'], 'the row lands in its new place');
    await page.close();
  });

  test('a phone keeps the grips that are a block its only handle (Issue #806)', async () => {
    const page = await phone(build(), 'light');
    for (const sel of ['.entity-body > .attach-block .opt-grip', '.related-head .opt-grip']) {
      const box = await page.locator(sel).first().boundingBox();
      assert.ok(box && box.width > 0 && box.height > 0, `${sel} is the only drag handle its block has, got ${JSON.stringify(box)}`);
    }
    await page.close();
  });

  test('a desktop pointer keeps the hover grip (Issue #806)', async () => {
    const page = await desktop(build());
    const row = page.locator('.entity-values .fieldrow').first();
    const grip = row.locator('.opt-grip');
    const box = await grip.boundingBox();
    assert.ok(box && box.width > 0, `the desktop grip keeps its box, got ${JSON.stringify(box)}`);
    await row.hover();
    assert.equal(await eventually(() => grip.evaluate((n) => getComputedStyle(n).opacity), '1'), '1',
      'hovering a field row still shows its grip');
    await page.close();
  });
}
