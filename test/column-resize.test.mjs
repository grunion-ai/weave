/* The pure half of a column resize (public/column-resize.js).
   Issue #100: a header may never be narrower than its own label.
   Issue #160: the width painted mid-drag IS the width stored on release. */
import test from 'node:test';
import assert from 'node:assert/strict';

await import('../public/column-resize.js');
const CR = globalThis.WeaveColumnResize;

test('the floor is the label plus its padding, never below the engine minimum', () => {
  assert.equal(CR.floor({ label: 80, padLeft: 8, padRight: 24, min: 60 }), 112);
  assert.equal(CR.floor({ label: 80.4, padLeft: 8, padRight: 24, min: 60 }), 113, 'a fractional label rounds up — a floor that clips is no floor');
  assert.equal(CR.floor({ label: 10, padLeft: 8, padRight: 24, min: 60 }), 60, 'a short label still stops at the engine minimum');
  assert.equal(CR.floor(), 0, 'nothing measured, nothing floored');
});

test('the drag width follows the pointer from where the drag began', () => {
  assert.equal(CR.width({ base: 200, startX: 500, x: 560 }), 260);
  assert.equal(CR.width({ base: 200, startX: 500, x: 440 }), 140);
  assert.equal(CR.width({ base: 200.6, startX: 500, x: 500.7 }), 201, 'one rounding, so the painted and stored widths agree');
});

test('the drag width stops at the floor', () => {
  assert.equal(CR.width({ base: 200, startX: 500, x: 100, floor: 112 }), 112);
  assert.equal(CR.width({ base: 200, startX: 500, x: 100, floor: 60 }), 60);
});
