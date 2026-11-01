import test from 'node:test';
import assert from 'node:assert/strict';
import { engineOf, launch, phoneProfile, styleOf, PHONE } from './lib/browser.mjs';

const IPHONE = phoneProfile()?.page ?? null;

const s = await launch('reorder grips on a touch screen', (weave) => {
  weave.createSpace({ name: 'Plans' });
  const trip = weave.createTable({ space: 'Plans', name: 'Trip' });
  weave.addField(trip.id, { name: 'Where', type: 'text' });
  weave.addField(trip.id, { name: 'Brief', type: 'document' });
  const japan = weave.createEntity(trip.id, { name: 'Japan', values: { Where: 'Tokyo' } });
  return { entity: `#/table/${trip.id}?e=${japan.id}` };
});

const GRIPS = [
  ['a field row', '.entity-fields .fieldrow[data-field="Where"] .opt-grip'],
  ['the Fields block', '.entity-body > [data-block] > .block-head .opt-grip'],
  ['a document block', '.entity-body > .doc-section[data-doc-field="Brief"] .opt-grip'],
];

if (s) {
  const { base, browser, entity } = s;
  const engines = [['chromium 390x844 touch', browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]];
  const webkit = await engineOf('webkit');
  if (webkit && IPHONE) engines.push([`webkit ${PHONE}`, webkit, IPHONE]);

  const open = async (b, profile, theme, hash, ready) => {
    const page = await b.newPage(profile);
    await page.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
    await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle' });
    await page.waitForSelector(ready);
    return page;
  };

  for (const [engine, b, profile] of engines) {
    for (const theme of ['light', 'dark']) {
      test(`a touch screen draws no decorative entity grip (${engine}, ${theme}, Issue #806)`, async () => {
        const page = await open(b, profile, theme, entity, '.entity-fields .fieldrow');
        try {
          assert.equal(await page.evaluate(() => matchMedia('(hover: none)').matches), true, 'the profile is a touch screen');
          assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
          for (const [what, selector] of GRIPS) {
            const grips = page.locator(selector);
            const count = await grips.count();
            assert.ok(count > 0, `${what} still builds its grip into the page, got ${count}`);
            for (let i = 0; i < count; i += 1) {
              const box = await grips.nth(i).boundingBox();
              assert.equal(box, null, `${what} grip #${i} still takes a layout box on a touch screen: ${JSON.stringify(box)}`);
            }
          }
        } finally { await page.close(); }
      });

    }
  }

  test('a desktop still holds the entity grips back until a hover (Issue #744)', async () => {
    const page = await open(browser, { viewport: { width: 1280, height: 900 } }, 'light', entity, '.entity-fields .fieldrow');
    try {
      for (const [what, selector] of GRIPS) {
        assert.equal(await styleOf(page.locator(selector).first(), 'opacity', '0'), '0', `${what} is hidden at rest on a desktop`);
      }
      await page.hover('.entity-fields .fieldrow[data-field="Where"]');
      assert.equal(await styleOf(page.locator(GRIPS[0][1]).first(), 'opacity', '1'), '1', 'and a hover lights it');
    } finally { await page.close(); }
  });

}
