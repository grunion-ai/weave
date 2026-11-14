import test from 'node:test';
import assert from 'node:assert/strict';
import { PHONES, engineOf, launch, settled } from './lib/browser.mjs';
import { SEEDS } from './lib/states.mjs';
import { MIN } from './lib/touch.mjs';

const s = await launch('touch size keyed to the pointer', SEEDS.touch);

const SURFACES = [
  {
    name: 'Status picker rows and search box',
    rows: '.picker-pop :is(.picker-row, .picker-box)',
    async open(page) {
      await page.click('#main .entity-fields .fieldrow[data-field="Status"] .chip-trigger');
      await page.waitForSelector('.picker-pop .picker-row');
      await settled(page.locator('.picker-pop'));
    },
  },
  {
    name: 'record menu rows',
    rows: '.wv-menu .wv-menu-row',
    async open(page) {
      await page.click('#main .dots-btn[title="Record actions"]');
      await page.waitForSelector('.wv-menu .wv-menu-row');
      await settled(page.locator('.wv-menu'));
    },
  },
  {
    name: 'command palette results',
    rows: '#cmdk-results .result',
    async open(page) {
      await page.evaluate(() => openPalette());
      await page.fill('#cmdk-input', 'Issue');
      await page.waitForSelector('#cmdk-results .result');
    },
  },
];

const HEIGHTS = (sel) => [...document.querySelectorAll(sel)].filter((n) => n.getClientRects().length).map((n) => Math.round(n.getBoundingClientRect().height));

if (s) {
  const { base, browser, row } = s;
  const webkit = await engineOf('webkit');
  const tablet = { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true };
  const COARSE = [
    ['Chrome on an 820px tablet', browser, tablet],
    ['Chrome on iPhone Duo open', browser, PHONES.find((p) => p.name === 'iPhone Duo open').page],
    ['Chrome on a phone held sideways', browser, { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true }],
    ['Safari on an 820px tablet', webkit, tablet],
  ];
  const measure = async (b, profile, surface) => {
    const page = await b.newPage(profile);
    try {
      await page.goto(`${base}/#/entity/${row}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('#main .entity-fields .fieldrow[data-field="Status"] .chip-trigger');
      const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches && !matchMedia('(max-width: 600px)').matches);
      await surface.open(page);
      return { coarse, heights: await page.evaluate(HEIGHTS, surface.rows) };
    } finally { await page.close(); }
  };

  for (const surface of SURFACES) {
    for (const [label, b, profile] of COARSE) {
      test(`on a coarse pointer wider than the phone layout the ${surface.name} keep the ${MIN}px touch size (${label}, Issue #1712)`, async () => {
        const { coarse, heights } = await measure(b, profile, surface);
        assert.ok(coarse, `${label} reports a coarse pointer above the 600px phone breakpoint, the cell this test is about`);
        assert.ok(heights.length >= 1, `the ${surface.name} draw at least one row`);
        assert.deepEqual(heights.filter((h) => h < MIN), [], `${surface.name} are ${heights.join(', ')}px tall; a finger needs ${MIN}px on every touch screen, not only under 600px`);
      });
    }
    test(`on a fine pointer the ${surface.name} keep their desktop size (Issue #1712)`, async () => {
      const { heights } = await measure(browser, { viewport: { width: 1280, height: 800 } }, surface);
      assert.ok(heights.length >= 1, `the ${surface.name} draw at least one row`);
      assert.ok(heights.every((h) => h < MIN), `a mouse keeps the dense rows: ${heights.join(', ')}px`);
    });
  }
}
