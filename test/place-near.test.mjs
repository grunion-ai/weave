import test from 'node:test';
import assert from 'node:assert/strict';
import { read, fnBody, liftFunction } from './lib/source.mjs';

const APP_JS = read('public/app.js');
const DATE_JS = read('public/date-picker.js');
const place = (rect, { w = 200, h = 100, vw = 1000, vh = 800, gap } = {}) => {
  const placeNear = liftFunction('placeNear', { innerWidth: vw, innerHeight: vh }, APP_JS);
  const pop = { offsetWidth: w, offsetHeight: h, style: {} };
  placeNear(pop, { getBoundingClientRect: () => rect }, gap == null ? undefined : { gap });
  return { left: pop.style.left, top: pop.style.top };
};

test('placeNear drops a popover below its anchor, gap 4 by default (Feature #177)', () => {
  assert.deepEqual(place({ left: 100, top: 50, bottom: 70 }), { left: '100px', top: '74px' });
  assert.deepEqual(place({ left: 100, top: 50, bottom: 70 }, { gap: 6 }), { left: '100px', top: '76px' });
});

test('placeNear flips above when the popover would pass the bottom edge (Feature #177)', () => {
  assert.deepEqual(place({ left: 100, top: 700, bottom: 720 }), { left: '100px', top: '596px' });
});

test('placeNear keeps the popover 8 px inside the viewport on every side (Feature #177)', () => {
  assert.equal(place({ left: 900, top: 50, bottom: 70 }).left, '792px', 'right edge');
  assert.equal(place({ left: -40, top: 50, bottom: 70 }).left, '8px', 'left edge');
  assert.equal(place({ left: 100, top: 60, bottom: 780 }).top, '8px', 'a flip that would leave the top edge pins to 8');
});

test('showPopover, anchorPop and datePopover share placeNear; no copy of the flip math is left (Feature #177)', () => {
  assert.match(fnBody('showPopover', APP_JS), /placeNear\(pop, trigger\)/);
  assert.match(fnBody('anchorPop', APP_JS), /placeNear\(pop, anchor\)/);
  assert.match(fnBody('datePopover', DATE_JS), /placeNear\(pop, anchor, \{ gap: 6 \}\)/);
  for (const [file, src] of [['app.js', APP_JS], ['date-picker.js', DATE_JS]]) {
    assert.doesNotMatch(src, /\+ pop\.offsetHeight > innerHeight \?/, `${file} carries no hand-rolled flip`);
  }
});
