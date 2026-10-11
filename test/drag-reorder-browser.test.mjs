import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { seedReorder, surfaces, exerciseSurface, pointer, centre, aimAt, quiet } from './lib/reorder-surfaces.mjs';

let ids;
const s = await launch('drag to reorder, desktop (Feature #282)', (weave) => { ids = seedReorder(weave); });
if (s) {
  const { base, browser, weave } = s;
  const all = surfaces({ weave, base, ids });
  const page = async (options = {}) => browser.newPage({ viewport: { width: 1280, height: 900 }, ...options });

  for (const surface of all) {
    test(`${surface.name}: lift, placeholder, drop and Escape with a mouse (Feature #282)`, async () => {
      surface.reset();
      const p = await page();
      try { await exerciseSurface(p, surface); } finally { await p.close(); }
    });
  }

  test('the lift raises the copy, dims the source in the slot and slides the neighbours (Feature #282)', async () => {
    const fields = all.find((x) => x.name === 'Fields popover');
    fields.reset();
    const p = await page();
    try {
      await fields.open(p);
      const hand = pointer(p);
      await hand.press(await centre(fields.handle(p, 'Amount')));
      await hand.nudge();
      await quiet(p);
      const look = await p.evaluate(() => {
        const lift = document.querySelector('.wv-reorder-lift');
        const slot = document.querySelector('.wv-reorder-slot');
        const cs = getComputedStyle(lift);
        return {
          scale: cs.scale, shadow: cs.boxShadow, cursor: getComputedStyle(document.body).cursor,
          slotFaded: Number(getComputedStyle(slot.firstElementChild).opacity),
          slotLine: getComputedStyle(slot).outlineStyle,
          slideMs: getComputedStyle(document.documentElement).getPropertyValue('--wv-slide-ms').trim(),
        };
      });
      assert.ok(Number(look.scale) >= 1.02 && Number(look.scale) <= 1.03, `the copy rises to 1.02-1.03, got ${look.scale}`);
      assert.notEqual(look.shadow, 'none', 'with a deeper shadow');
      assert.equal(look.cursor, 'grabbing', 'and a grabbing cursor');
      assert.ok(look.slotFaded < 1, 'the source waits in the slot, dimmed');
      assert.equal(look.slotLine, 'dashed', 'inside a dashed placeholder');
      const ms = parseFloat(look.slideMs);
      assert.ok(ms >= 150 && ms <= 200, `neighbours slide in 150 to 200 ms, got ${look.slideMs}`);
      await hand.to(await aimAt(fields.target(p, 'Name'), 'before', 'y'), 2);
      const sliding = await p.evaluate(() => document.getAnimations().filter((a) => a.transitionProperty === 'translate').length);
      assert.ok(sliding > 0, 'the neighbours slide with a transition rather than jump');
      await hand.release();
      const settle = await p.evaluate(() => document.getAnimations().some((a) => a.effect?.target?.classList?.contains('wv-reorder-lift')));
      assert.equal(settle, true, 'the drop settles the copy into the slot with an animation');
    } finally { await p.close(); }
  });

  test('prefers-reduced-motion keeps the placeholder and drops the scale and slide (Feature #282)', async () => {
    const fields = all.find((x) => x.name === 'Fields popover');
    fields.reset();
    const p = await page({ reducedMotion: 'reduce' });
    try {
      await fields.open(p);
      const hand = pointer(p);
      await hand.press(await centre(fields.handle(p, 'Amount')));
      await hand.nudge();
      await hand.to(await aimAt(fields.target(p, 'Name'), 'before', 'y'), 2);
      const look = await p.evaluate(() => ({
        scale: getComputedStyle(document.querySelector('.wv-reorder-lift')).scale,
        running: document.getAnimations().filter((a) => a.playState === 'running').length,
        slot: document.querySelectorAll('.wv-reorder-slot').length,
      }));
      assert.equal(look.slot, 1, 'the placeholder still opens');
      assert.ok(look.scale === 'none' || look.scale === '1', `the copy does not scale, got ${look.scale}`);
      assert.equal(look.running, 0, 'nothing slides or animates');
      assert.deepEqual(await fields.keys(p), ['[Amount]', 'Name', 'Owner', 'Stage']);
      await hand.release();
      assert.equal(await p.locator('.wv-reorder-lift, .wv-reorder-slot').count(), 0, 'the drop lands at once');
    } finally { await p.close(); }
  });

  test('a drop outside the list puts the item back (Feature #282)', async () => {
    const fields = all.find((x) => x.name === 'Fields popover');
    fields.reset();
    const p = await page();
    try {
      await fields.open(p);
      const hand = pointer(p);
      await hand.press(await centre(fields.handle(p, 'Amount')));
      await hand.nudge();
      await hand.to(await aimAt(fields.target(p, 'Name'), 'before', 'y'));
      await hand.to({ x: 1200, y: 860 });
      await hand.release();
      await p.waitForFunction(() => !document.querySelector('.wv-reorder-lift, .wv-reorder-slot'));
      await p.waitForLoadState('networkidle');
      assert.deepEqual(await fields.keys(p), ['Name', 'Owner', 'Stage', 'Amount'], 'the order on screen is restored');
      assert.deepEqual(fields.saved(), ['Name', 'Owner', 'Stage', 'Amount'], 'and nothing was saved');
    } finally { await p.close(); }
  });

  test('a drop back in its own slot writes nothing, even for the last item (Feature #282)', async () => {
    const fields = all.find((x) => x.name === 'Fields popover');
    fields.reset();
    const p = await page();
    try {
      await fields.open(p);
      const writes = [];
      p.on('request', (r) => { if (r.method() !== 'GET' && !r.url().includes('/query')) writes.push(r.url()); });
      const hand = pointer(p);
      const at = await centre(fields.handle(p, 'Amount'));
      await hand.press(at);
      await hand.nudge();
      await hand.to({ x: at.x, y: at.y + 3 }, 2);
      await hand.release();
      await p.waitForFunction(() => !document.querySelector('.wv-reorder-lift, .wv-reorder-slot'));
      await p.waitForLoadState('networkidle');
      assert.deepEqual(writes, [], 'no write for a drop where it started');
      assert.deepEqual(await fields.keys(p), ['Name', 'Owner', 'Stage', 'Amount']);
    } finally { await p.close(); }
  });

  test('auto-scroll runs in the edge band and stops when the pointer leaves it (Issues #3, #432, #450)', async () => {
    const p = await page({ viewport: { width: 1280, height: 640 } });
    try {
      await p.goto(`${base}/#/table/${ids.tall.id}`, { waitUntil: 'networkidle' });
      await p.click('.eye-btn');
      await p.waitForSelector('.table-fields-popover .table-field-row');
      await quiet(p);
      const list = p.locator('.table-field-list');
      const box = await list.boundingBox();
      assert.ok(await list.evaluate((n) => n.scrollHeight > n.clientHeight + 40), 'the list scrolls');
      const hand = pointer(p);
      await hand.press(await centre(p.locator('.table-field-row').nth(2).locator('.field-reorder-handle')));
      await hand.nudge();
      await hand.to({ x: box.x + 40, y: box.y + box.height - 8 }, 4);
      await p.waitForFunction(() => document.querySelector('.table-field-list').scrollTop > 60, null, { timeout: 5000 });
      await hand.to({ x: box.x + 40, y: box.y + box.height / 2 }, 2);
      const a = await list.evaluate((n) => n.scrollTop);
      await p.waitForTimeout(300);
      const b = await list.evaluate((n) => n.scrollTop);
      assert.equal(b, a, 'out of the band the list holds still');
      await hand.to({ x: box.x + 40, y: box.y + 6 }, 4);
      await p.waitForFunction((top) => document.querySelector('.table-field-list').scrollTop < top - 30, b, { timeout: 5000 });
      await p.keyboard.press('Escape');
      await hand.release();
    } finally { await p.close(); }
  });

  test('keyboard reorder still works on the Fields popover and the view tabs (Feature #282)', async () => {
    const fields = all.find((x) => x.name === 'Fields popover');
    fields.reset();
    const p = await page();
    try {
      await fields.open(p);
      await fields.handle(p, 'Owner').focus();
      await p.keyboard.press('ArrowDown');
      await p.waitForLoadState('networkidle');
      assert.deepEqual(await fields.keys(p), ['Name', 'Stage', 'Owner', 'Amount'], 'ArrowDown moves the field');
    } finally { await p.close(); }
  });
}
