import test from 'node:test';
import assert from 'node:assert/strict';
import { engineOf, launch, phoneProfile, settled, styleOf, PHONE } from './lib/browser.mjs';

const IPHONE = phoneProfile()?.page ?? null;
const REST = 0.7;

const s = await launch('reorder grips on a touch screen', (weave) => {
  weave.createSpace({ name: 'Plans' });
  const trip = weave.createTable({ space: 'Plans', name: 'Trip' });
  weave.addField(trip.id, { name: 'Where', type: 'text' });
  weave.addField(trip.id, { name: 'Brief', type: 'document' });
  const japan = weave.createEntity(trip.id, { name: 'Japan', values: { Where: 'Tokyo' } });
  const todo = weave.createTable({ space: 'Plans', name: 'To-do' });
  for (const name of ['Passport', 'Rail pass']) weave.createEntity(todo.id, { name });
  weave.tableView(`${todo.id}/Standard`, { layout: 'list' });
  return { entity: `#/table/${trip.id}?e=${japan.id}`, list: `#/table/${todo.id}` };
});

const GRIPS = [
  ['a field row', '.entity-fields .fieldrow[data-field="Where"] .opt-grip'],
  ['the Fields block', '.entity-body > [data-block] > .block-head .opt-grip'],
  ['a document block', '.entity-body > .doc-section[data-doc-field="Brief"] .opt-grip'],
];
const LIST_GRIP = '.wv-list .list-row .list-grip';

if (s) {
  const { base, browser, entity, list } = s;
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

  const restingOpacity = async (page, selector) => {
    const grip = page.locator(selector).first();
    await settled(grip);
    return Number(await styleOf(grip, 'opacity', String(REST)));
  };

  for (const [engine, b, profile] of engines) {
    for (const theme of ['light', 'dark']) {
      test(`a touch screen draws every entity reorder grip at rest (${engine}, ${theme}, Issue #744)`, async () => {
        const page = await open(b, profile, theme, entity, '.entity-fields .fieldrow');
        try {
          assert.equal(await page.evaluate(() => matchMedia('(hover: none)').matches), true, 'the profile is a touch screen');
          assert.equal(await page.evaluate(() => document.documentElement.dataset.bsTheme), theme);
          for (const [what, selector] of GRIPS) {
            const opacity = await restingOpacity(page, selector);
            assert.ok(opacity > 0, `${what} shows its grip at rest, not at opacity ${opacity}`);
            assert.equal(opacity, REST, `${what} rests at the touch opacity`);
          }
        } finally { await page.close(); }
      });

      test(`a touch screen draws the list row grip at rest (${engine}, ${theme}, Issue #744)`, async () => {
        const page = await open(b, profile, theme, list, LIST_GRIP);
        try {
          const opacity = await restingOpacity(page, LIST_GRIP);
          assert.ok(opacity > 0, `a list row shows its grip at rest, not at opacity ${opacity}`);
          assert.equal(opacity, REST, 'the list row grip rests at the touch opacity');
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

  test('a desktop still holds the list row grip back until a hover (Issue #744)', async () => {
    const page = await open(browser, { viewport: { width: 1280, height: 900 } }, 'light', list, LIST_GRIP);
    try {
      assert.equal(await styleOf(page.locator(LIST_GRIP).first(), 'opacity', '0'), '0', 'hidden at rest on a desktop');
      await page.hover('.wv-list .list-row');
      assert.equal(await styleOf(page.locator(LIST_GRIP).first(), 'opacity', String(REST)), String(REST), 'and a hover lights it');
    } finally { await page.close(); }
  });
}
