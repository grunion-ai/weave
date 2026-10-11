import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, phoneBrowser, phonePage, PHONE } from './lib/browser.mjs';
import { seedReorder, surfaces, pointer } from './lib/reorder-surfaces.mjs';

const MIN = 44;
const LISTS = ['workflow state list', 'select option list'];

let ids;
const s = await launch(`option and state grips on ${PHONE} (Issue #803)`, (weave) => { ids = seedReorder(weave); });
if (s) {
  const { base, weave } = s;
  const all = surfaces({ weave, base, ids });

  for (const name of LISTS) {
    const surface = all.find((x) => x.name === name);
    for (const theme of ['light', 'dark']) {
      test(`${name}: the reorder grip is a ${MIN}x${MIN} target with a centred glyph on ${PHONE} (${theme}, Issue #803)`, async () => {
        const p = await phonePage(await phoneBrowser());
        try {
          await p.addInitScript((t) => localStorage.setItem('weave-theme', t), theme);
          await surface.open(p);
          assert.equal(await p.evaluate(() => document.documentElement.dataset.bsTheme), theme);
          assert.equal(await p.evaluate(() => matchMedia('(pointer: coarse)').matches), true, 'the profile is a coarse pointer');
          const keys = (await surface.keys(p)).map((k) => k.replace(/^\[|\]$/g, ''));
          for (const key of keys) {
            const grip = await surface.handle(p, key);
            await grip.evaluate((n) => n.scrollIntoView({ block: 'center' }));
            const box = await grip.boundingBox();
            assert.ok(box.width >= MIN && box.height >= MIN, `${key}: grip is ${box.width}x${box.height}, wants at least ${MIN}x${MIN}`);
            const glyph = await grip.locator('.wv-icon').boundingBox();
            assert.ok(glyph.width <= 20 && glyph.height <= 20, `${key}: the glyph stays small, not ${glyph.width}x${glyph.height}`);
            const dx = Math.abs(glyph.x + glyph.width / 2 - (box.x + box.width / 2));
            const dy = Math.abs(glyph.y + glyph.height / 2 - (box.y + box.height / 2));
            assert.ok(dx <= 1.5 && dy <= 1.5, `${key}: the glyph sits centred in its target, off by ${dx},${dy}`);
            const room = await grip.evaluate((n) => {
              const next = n.nextElementSibling.getBoundingClientRect();
              return { next: next.left, list: n.closest('.opt-list').getBoundingClientRect().left };
            });
            assert.ok(box.x >= 0, `${key}: the grip stays on screen`);
            assert.ok(box.x + box.width <= room.next + 0.5, `${key}: the grip target stops at the icon button (${box.x}+${box.width} vs ${room.next}, list ${room.list})`);
            assert.ok(room.next - room.list <= 27, `${key}: the grip borrows the tray gutter, so the row shifts at most 4px right`);
          }
        } finally { await p.close(); }
      });
    }

    test(`${name}: a long press on the outer edge of the grip still lifts the row on ${PHONE} (Issue #803)`, async () => {
      const p = await phonePage(await phoneBrowser());
      try {
        await surface.open(p);
        const keys = (await surface.keys(p)).map((k) => k.replace(/^\[|\]$/g, ''));
        const grip = await surface.handle(p, keys[0]);
        await grip.evaluate((n) => n.scrollIntoView({ block: 'center' }));
        const box = await grip.boundingBox();
        const edge = { x: box.x + 3, y: box.y + box.height - 3 };
        const owner = await p.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.opt-grip'), [edge.x, edge.y]);
        assert.equal(owner, true, 'the corner of the target belongs to the grip');
        const hand = pointer(p, { touch: true });
        await hand.press(edge);
        await hand.hold();
        assert.equal(await p.locator('.wv-reorder-lift').count(), 1, 'the long press lifts a copy of the row');
        await hand.release();
        await p.waitForFunction(() => !document.querySelector('.wv-reorder-lift, .wv-reorder-slot'), null, { timeout: 5000 });
        assert.deepEqual((await surface.keys(p)).map((k) => k.replace(/^\[|\]$/g, '')), keys, 'a drop in place keeps the order');
      } finally { await p.close(); }
    });
  }
}
