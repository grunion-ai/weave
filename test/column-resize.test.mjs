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

/* Issue #586: a toggle column never cuts its switch or its word. Its value
   floor is the track, the gap, the wider of its two words and the cell's
   padding; the floor a column keeps is the larger of that and its label's. */
test('a toggle floor holds the track, the gap, the wider word and the cell padding', () => {
  assert.deepEqual(CR.TOGGLE_METRICS, { track: 28, gap: 7, pad: 8 });
  assert.equal(CR.toggleWidth({ on: 16.4, off: 20.2 }), 64, 'the default words: 28 + 7 + the wider word, 20.2, + 8, rounded up');
  assert.equal(CR.toggleWidth({ on: 52.6, off: 44 }), 96, 'a long on word decides it as surely as a long off word');
  assert.equal(CR.toggleWidth({ on: 20, off: 20, pad: 24 }), 79, 'the row\'s last cell carries Tabler\'s 20px right pad, measured and passed in');
  assert.equal(CR.toggleWidth({ on: 0, off: 0 }), 43, 'two empty words still keep the whole track');
  assert.equal(CR.toggleWidth(), 43, 'nothing measured yet, the track and the padding still floor it');
});

test('a value floor past the default wins for that column only; a stored width under it is raised', () => {
  const floor = CR.toggleWidth({ on: 120, off: 60 });
  assert.ok(floor > CR.DEFAULT_WIDTHS.toggle, `a long word needs more than the 124 default (${floor})`);
  const out = CR.layout([
    { name: 'State', type: 'toggle', floor },
    { name: 'On', type: 'toggle', floor: CR.toggleWidth({ on: 16, off: 20 }) },
    { name: 'Old', type: 'toggle', floor: CR.toggleWidth({ on: 16, off: 20 }), stored: 50 },
    { name: 'Note', type: 'text' },
  ]);
  assert.deepEqual(out, { State: floor, On: 124, Old: 63, Note: 180 });
  assert.equal(CR.nudge({ width: 66, delta: -8, floor: 63 }), 63, 'a keyboard nudge stops at it');
  assert.equal(CR.fit({ content: 40, floor: 63 }), 63, 'an autofit stops at it');
  assert.equal(CR.width({ base: 124, startX: 500, x: 300, floor: 63 }), 63, 'a drag stops at it');
});

/* Issue #614: no control of fixed shape is cut by a resize. A select or a
   state floors at its widest option's chip; a multi-select at its widest
   chip plus the +N count that says more are hidden, never the sum of every
   chip. app.js measures the chips off the rendered cell; this composes them
   with the cell's padding. Free text is not floored. */
test('a chip floor holds the widest chip and the cell padding', () => {
  assert.equal(CR.chipWidth({ chip: 112.3 }), 121, 'the widest chip, 112.3, + the ordinary cell\'s 8, rounded up');
  assert.equal(CR.chipWidth({ chip: 112, pad: 24 }), 136, 'the row\'s last cell carries Tabler\'s 20px right pad, measured and passed in');
  assert.equal(CR.chipWidth({ chip: 90, more: 21.5, gap: 4 }), 124, 'a multi-select keeps one chip, the gap and the +N count whole');
  assert.equal(CR.chipWidth({ chip: 90, gap: 4 }), 98, 'no +N count (a single option) adds no gap');
  assert.equal(CR.chipWidth(), 0, 'nothing measured, nothing floored');
});

test('a rating floors at every icon, up to the fit ceiling', () => {
  assert.equal(CR.ratingFloor({ type: 'rating', max: 5 }), 82, 'five 14px icons (Feature #235\'s redrawn cell), four 1px gaps, the cell\'s 8');
  assert.equal(CR.ratingFloor({ type: 'rating', max: 7 }, 24), 128, 'the last cell\'s padding is measured and passed in');
  assert.equal(CR.ratingFloor({ type: 'rating', max: 100 }), CR.maxWidth({ type: 'rating' }), 'a hundred icons draw the compact form, not 1507px of icons');
  assert.equal(CR.ratingFloor({ type: 'text' }), 0, 'only a rating has icons');
});

test('a chip or rating floor binds a stored width, a drag, a nudge and a fit for that column only', () => {
  const floor = CR.chipWidth({ chip: 150.2 });
  const out = CR.layout([
    { name: 'State', type: 'workflow', floor, stored: 60 },
    { name: 'Tags', type: 'multiselect', floor: CR.chipWidth({ chip: 40, more: 20, gap: 4 }) },
    { name: 'Fit', type: 'rating', max: 5, floor: CR.ratingFloor({ type: 'rating', max: 5 }), stored: 50 },
    { name: 'Note', type: 'text', stored: 40 },
  ]);
  assert.deepEqual(out, { State: 159, Tags: 180, Fit: 82, Note: 40 }, 'free text keeps a narrow stored width; it truncates');
  assert.equal(CR.nudge({ width: 165, delta: -8, floor }), 159);
  assert.equal(CR.fit({ content: 70, floor }), 159);
  assert.equal(CR.width({ base: 200, startX: 500, x: 300, floor }), 159);
});
