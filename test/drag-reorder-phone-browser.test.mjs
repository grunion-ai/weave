import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage, PHONE } from './lib/browser.mjs';
import { seedReorder, surfaces, exerciseSurface, pointer, centre } from './lib/reorder-surfaces.mjs';

let ids;
const s = await launch(`drag to reorder, ${PHONE} (Feature #282)`, (weave) => { ids = seedReorder(weave); });
if (s) {
  const { base, weave } = s;
  const all = surfaces({ weave, base, ids });
  const page = async (options = {}) => {
    const p = await phonePage(await phoneBrowser(), options);
    await p.addInitScript(() => {
      window.__buzz = [];
      Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (ms) => { window.__buzz.push(ms); return true; } });
    });
    return p;
  };

  for (const surface of all) {
    test(`${surface.name}: long press lifts, placeholder, drop and Escape on ${PHONE} (Feature #282)`, async () => {
      surface.reset();
      const p = await page(surface.phone ?? {});
      try {
        await exerciseSurface(p, surface, { touch: true });
        assert.ok((await p.evaluate(() => window.__buzz)).includes(10), 'the long press ticks the haptic where the platform has one');
      } finally { await p.close(); }
    });
  }

  test(`a touch that moves before the long press is a scroll, not a drag (${PHONE}, Feature #282)`, async () => {
    const fields = all.find((x) => x.name === 'Fields popover');
    fields.reset();
    const p = await page();
    try {
      await fields.open(p);
      const hand = pointer(p, { touch: true });
      const at = await centre(fields.handle(p, 'Amount'));
      await hand.press(at);
      await hand.to({ x: at.x, y: at.y - 40 }, 3);
      await p.waitForTimeout(400);
      assert.equal(await p.locator('.wv-reorder-lift, .wv-reorder-slot').count(), 0, 'no lift once the finger travels first');
      await hand.release();
      assert.deepEqual(await fields.keys(p), ['Name', 'Owner', 'Stage', 'Amount']);
    } finally { await p.close(); }
  });
}
