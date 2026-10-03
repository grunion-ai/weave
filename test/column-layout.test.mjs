/* Field resize, reorder and freeze (Feature #233), the pure half in
   public/column-resize.js. Kyle's four rules (2026-09-25):
     1. a header label never truncates — every width stops at the label floor;
     2. one field's change never moves another field's width;
     3. every type has a default width, raised only by its own label;
     4. a click that ends a gesture never opens the field menu (browser suite).
   The pointer and the paint live in app.js; the numbers and the drop plan
   come from here so they can be pressed without a browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
await import('../public/column-resize.js');
const CR = globalThis.WeaveColumnResize;

test('every field type has a default width; the mockup values hold exactly', () => {
  const d = (type, extra = {}) => CR.defaultWidth({ type, ...extra });
  // Name is the one departure from the mockup's 220: Kyle raised it to 260
  // on 2026-09-26 so a thirty-character name reads whole (Issues #261, #414).
  assert.equal(d('text', { role: 'name' }), 260, 'Name');
  assert.equal(d('formula', { role: 'name' }), 260, 'a computed Name is still the Name');
  assert.equal(d('text'), 180);
  assert.equal(d('document'), 280, 'long text');
  assert.equal(d('document', { role: 'description' }), 280);
  assert.equal(d('document', { role: 'description', empty: true }), 180, 'an empty description opens at the text width (Issue #575)');
  assert.equal(d('select'), 124);
  assert.equal(d('relation'), 136, 'a person is a relation to a row');
  assert.equal(d('date'), 112);
  assert.equal(d('number'), 88);
  assert.equal(d('number', { currency: 'USD' }), 104, 'currency');
  assert.equal(d('checkbox'), 56);
  assert.equal(d('url'), 180);
  const types = ['text', 'number', 'rating', 'date', 'daterange', 'checkbox', 'toggle', 'url', 'email', 'select', 'multiselect',
    'workflow', 'relation', 'field', 'key', 'attachments', 'lookup', 'rollup', 'formula', 'view', 'document'];
  const mockup = [260, 180, 280, 124, 136, 112, 88, 104, 56];
  for (const t of types) {
    const w = d(t);
    assert.ok(mockup.includes(w), `${t} maps to one of the mockup widths, got ${w}`);
    assert.ok(CR.maxWidth({ type: t }) > w, `${t}: the fit cap sits above the default`);
  }
  assert.equal(d('nonsense'), 136, 'an unknown type still gets a width');
});

/* A rating column opens at the width its own icons need (Issue #404,
   Feature #235's column-width rule): max icons at the cell's icon box plus
   the gaps between them and the cell's padding. Before this, every rating
   opened at the type default of 104 whatever its max, so the showcase's
   Love (max 7) and Brightness (max 12) opened with
   their last hearts and suns cut at the cell edge — a 7 of 7 read like a 5
   of 7 and the right-most icons could not be clicked. The geometry
   constants mirror public/style.css and are held to the rendered cell by
   test/rating-browser.test.mjs. */
test('a rating opens wide enough for its own icons (Issue #404)', () => {
  const d = (extra) => CR.defaultWidth({ type: 'rating', ...extra });
  assert.equal(d({}), 104, 'no max declared: the type default, which is what five icons need');
  assert.equal(d({ max: 5 }), 104, 'five star icons, the engine default max');
  assert.equal(d({ max: 3 }), 104, 'a short rating keeps the type default rather than shrinking below it');
  assert.equal(d({ max: 7 }), 112, "the showcase's Love: 7 hearts at 14px (Feature #235's redrawn cell), 6 gaps, 8px of cell padding");
  assert.equal(d({ max: 12 }), 187, "the showcase's Brightness: 12 suns need 179px of icons");
  assert.ok(d({ max: 12 }) >= 179 + 8, 'never under what the icons measure in the cell');
  assert.equal(d({ max: 100 }), CR.maxWidth({ type: 'rating' }),
    'past the fit ceiling a rating stops there: a hundred icons do not take the screen');
  // The cell's own padding is measured off the rendered cell, because
  // Tabler gives the row's last cell 20px on the right where every other
  // cell gets 4. Without a measurement the ordinary cell's 8 stands.
  assert.equal(d({ max: 12, pad: 24 }), 203, "the row's last cell carries 16px more padding");
  assert.equal(d({ max: 12, pad: 8 }), 187, 'an ordinary cell, said out loud');
  assert.equal(d({ max: 12, pad: null }), 187, 'nothing measured yet: the ordinary cell');
  assert.equal(CR.RATING_METRICS.icon * 12 + CR.RATING_METRICS.gap * 11 + CR.RATING_METRICS.pad, 187,
    'the width is those three numbers and nothing else');
  // Only the rating field type. A rollup or a lookup that reads a rating
  // draws its icons inside the computed chip, at the chip's own icon size,
  // and clips for its own reason (Issue #564).
  assert.equal(CR.defaultWidth({ type: 'rollup' }), 88, 'a rollup keeps the number width');
  assert.equal(CR.defaultWidth({ type: 'lookup' }), 136, 'a lookup keeps its own width');
  // Only the DEFAULT moves (Kyle, Feature #235: a width the user dragged
  // wins), so a reader who narrows a rating column keeps it narrow.
  assert.deepEqual(CR.layout([{ name: 'Love', type: 'rating', max: 7 }, { name: 'Hand', type: 'rating', max: 12, stored: 120 }]),
    { Love: 112, Hand: 120 }, 'the untouched column fits its icons; the dragged one stands where it was put');
});

test('a longer label raises only that field\'s own width', () => {
  const widths = CR.layout([
    { name: 'Done', type: 'checkbox', floor: 90 },
    { name: 'Due', type: 'date', floor: 70 },
    { name: 'Owner', type: 'relation', stored: 150, floor: 80 },
    { name: 'Tiny', type: 'text', stored: 40, floor: 70 },
  ]);
  assert.deepEqual(widths, { Done: 90, Due: 112, Owner: 150, Tiny: 70 },
    'the checkbox grows to its label, the date keeps its default, a stored width stands, a stored width under the label is floored');
});

test('the fit is the longest value, between the label floor and the type cap', () => {
  assert.equal(CR.fit({ content: 143.2, floor: 90, max: 480 }), 144);
  assert.equal(CR.fit({ content: 20, floor: 90, max: 480 }), 90, 'never under the label');
  assert.equal(CR.fit({ content: 2000, floor: 90, max: 480 }), 480, 'a paragraph does not take the screen');
  assert.equal(CR.fit({ content: 2000, floor: 600, max: 480 }), 600, 'the label outranks the cap');
});

test('a keyboard nudge moves 8px and stops at the floor', () => {
  assert.equal(CR.nudge({ width: 120, delta: 8, floor: 90 }), 128);
  assert.equal(CR.nudge({ width: 120, delta: -8, floor: 90 }), 112);
  assert.equal(CR.nudge({ width: 94, delta: -8, floor: 90 }), 90);
  assert.equal(CR.nudge({ width: 90, delta: -8, floor: 90 }), 90);
});

test('the frozen zone is capped at 60% of the visible grid', () => {
  // lead = checkbox + # columns; widths are the frozen fields in order.
  assert.equal(CR.frozenFit({ lead: 80, widths: [220, 180], frozen: 2, viewport: 1000 }), 2, '480 of 600 fits');
  assert.equal(CR.frozenFit({ lead: 80, widths: [220, 180, 180], frozen: 3, viewport: 1000 }), 2, '660 is past 600: the third scrolls');
  assert.equal(CR.frozenFit({ lead: 80, widths: [600], frozen: 1, viewport: 1000 }), 0);
  assert.equal(CR.frozenFit({ lead: 80, widths: [220], frozen: 0, viewport: 1000 }), 0);
  assert.equal(CR.canFreeze({ lead: 80, widths: [220], add: 180, viewport: 1000 }), true);
  assert.equal(CR.canFreeze({ lead: 80, widths: [220], add: 400, viewport: 1000 }), false);
});

const ORDER = ['Name', 'Status', 'Owner', 'Due', 'Points'];

test('a drop plan moves only the dragged field and says when it changes the zone', () => {
  // Drag Due (index 3) to the gap before Status (rest index 1), scrolling side.
  assert.deepEqual(CR.plan({ order: ORDER, frozen: 0, dragged: 'Due', gap: 1, side: 'scroll' }),
    { order: ['Name', 'Due', 'Status', 'Owner', 'Points'], frozen: 0, noop: false, tag: null });
  // Drag Owner across the seam with only # frozen: it freezes, lands first.
  assert.deepEqual(CR.plan({ order: ORDER, frozen: 0, dragged: 'Owner', gap: 0, side: 'frozen' }),
    { order: ['Owner', 'Name', 'Status', 'Due', 'Points'], frozen: 1, noop: false, tag: 'Freeze here' });
  // Drag a frozen field back across: it unfreezes at the first scrolling place.
  assert.deepEqual(CR.plan({ order: ['Owner', 'Name', 'Status'], frozen: 2, dragged: 'Owner', gap: 1, side: 'scroll' }),
    { order: ['Name', 'Owner', 'Status'], frozen: 1, noop: false, tag: 'Unfreeze' });
  // Dropped where it already was: nothing to do, no line.
  assert.equal(CR.plan({ order: ORDER, frozen: 0, dragged: 'Owner', gap: 2, side: 'scroll' }).noop, true);
  // The seam gap on the frozen side of the last frozen field freezes it in place.
  const inPlace = CR.plan({ order: ORDER, frozen: 1, dragged: 'Status', gap: 1, side: 'frozen' });
  assert.deepEqual(inPlace, { order: ORDER, frozen: 2, noop: false, tag: 'Freeze here' });
  // A frozen-side gap past the zone is clamped into it; a scroll-side gap inside it is pushed out.
  assert.deepEqual(CR.plan({ order: ORDER, frozen: 1, dragged: 'Points', gap: 3, side: 'frozen' }).order,
    ['Name', 'Points', 'Status', 'Owner', 'Due']);
  assert.deepEqual(CR.plan({ order: ORDER, frozen: 2, dragged: 'Points', gap: 0, side: 'scroll' }).order,
    ['Name', 'Status', 'Points', 'Owner', 'Due']);
  assert.throws(() => CR.plan({ order: ORDER, frozen: 0, dragged: 'Nope', gap: 0, side: 'scroll' }), /Nope/);
});

test('the pointer picks the gap by the half of the column it is over; # and the checkbox mean the frozen side', () => {
  // # ends at 100; five 100px columns from 100 to 600. Only # frozen.
  const cols = ORDER.map((name, i) => ({ name, left: 100 + i * 100, right: 200 + i * 100 }));
  const at = (x, extra = {}) => CR.target({ cols, frozen: 0, lead: 100, seam: 100, x, dragged: 'Due', ...extra });
  assert.deepEqual(at(230), { gap: 1, side: 'scroll', x: 200 }, 'left half of Status: before it');
  assert.deepEqual(at(280), { gap: 2, side: 'scroll', x: 300 }, 'right half of Status: after it');
  assert.equal(at(430).gap, 3, 'over the dragged column itself: its own place (a no-op)');
  assert.deepEqual(at(900), { gap: 4, side: 'scroll', x: 600 }, 'past the last column: the end');
  assert.deepEqual(at(40), { gap: 0, side: 'frozen', x: 100 }, 'over # or the checkbox: freeze, right after #');
  assert.deepEqual(at(40, { capOk: false }), { gap: 0, side: 'scroll', x: 100 }, 'past the cap the drop lands on the scrolling side');
  // Name frozen (seam at 200): over Name is the frozen side, over Status the scrolling side.
  const f = (x) => CR.target({ cols, frozen: 1, lead: 100, seam: 200, x, dragged: 'Due' });
  assert.deepEqual(f(170), { gap: 1, side: 'frozen', x: 200 });
  assert.deepEqual(f(130), { gap: 0, side: 'frozen', x: 100 });
  assert.deepEqual(f(210), { gap: 1, side: 'scroll', x: 200 });
  // Scrolled: Status (200..300) has slid under the frozen zone that ends at 260.
  const scrolled = ORDER.map((name, i) => ({ name, left: 40 + i * 100, right: 140 + i * 100 }));
  scrolled[0] = { name: 'Name', left: 160, right: 260 };
  const s = CR.target({ cols: scrolled, frozen: 1, lead: 160, seam: 260, x: 262, dragged: 'Due' });
  assert.equal(s.side, 'scroll');
  assert.equal(s.x, 260, 'a gap hidden under the zone draws at the seam');
});

test('a dead-centre drop falls on the side the column travelled from', () => {
  const cols = ORDER.map((name, i) => ({ name, left: 100 + i * 100, right: 200 + i * 100 }));
  assert.equal(CR.target({ cols, frozen: 0, lead: 100, seam: 100, x: 150, dragged: 'Due' }).gap, 0, 'travelling left: before');
  assert.equal(CR.target({ cols, frozen: 0, lead: 100, seam: 100, x: 450, dragged: 'Status' }).gap, 3, 'travelling right: after');
});

test('the keyboard moves one place; crossing the seam freezes or unfreezes in place', () => {
  const step = (name, dir, frozen = 1, canFreeze = true) => CR.step({ order: ORDER, frozen, name, dir, canFreeze });
  assert.deepEqual(step('Owner', -1), { order: ['Name', 'Owner', 'Status', 'Due', 'Points'], frozen: 1 });
  assert.deepEqual(step('Status', -1), { order: ORDER, frozen: 2 }, 'the first scrolling field steps into the zone in place');
  assert.deepEqual(step('Name', 1), { order: ORDER, frozen: 0 }, 'the last frozen field steps out in place');
  assert.equal(step('Name', -1), null, 'nothing goes before #');
  assert.equal(step('Points', 1), null, 'the end is the end');
  assert.equal(step('Status', -1, 1, false), null, 'a full zone takes nothing more');
  assert.deepEqual(step('Name', -1, 0), { order: ORDER, frozen: 1 }, 'with only # frozen the first field freezes in place');
});

/* Feature #235: a graphic number column opens at the width its graphic
   needs, and a 10-icon rating never clips (Issue #404; the rating rule is
   the test above). */
test('a rich column fits its graphic: rating icons, bar track, ring, heat, sparkline', () => {
  const pad = CR.RICH.cellPad;
  assert.equal(CR.defaultWidth({ type: 'rating' }), 104, 'a rating with no max named keeps the mockup width');
  assert.equal(CR.defaultWidth({ type: 'rating', max: 10 }), 10 * 14 + 9 + CR.RATING_METRICS.pad, 'ten 14px icons with a 1px gap');
  assert.equal(CR.defaultWidth({ type: 'rollup', rating: { max: 5 } }), 88, 'a rollup reading a rating is sized on its own (Issue #564)');
  assert.equal(CR.defaultWidth({ type: 'number', display: 'bar' }, { widest: 30 }), pad + 80 + 6 + 30, 'track + gap + the widest figure');
  assert.equal(CR.defaultWidth({ type: 'number', display: 'bar' }), pad + 80 + 6 + 24, 'three digits until the page measures');
  assert.equal(CR.defaultWidth({ type: 'number', display: 'ring' }, { widest: 56 }), pad + 16 + 6 + 56);
  assert.equal(CR.defaultWidth({ type: 'formula', display: 'heat' }, { widest: 60 }), pad + 16 + 60);
  assert.equal(CR.defaultWidth({ type: 'number', display: 'heat' }, { widest: 12 }), 88, 'never narrower than a plain number: the empty box wants its width');
  const spark = CR.defaultWidth({ type: 'formula', display: 'sparkline' });
  assert.ok(spark >= 64 + pad && spark <= 96 + pad, `a sparkline is a fixed 64 to 96px graphic (${spark})`);
  assert.equal(CR.defaultWidth({ type: 'number', display: 'bar', currency: 'USD' }, { widest: 60 }), pad + 80 + 6 + 60, 'the graphic outranks the currency default');
  assert.equal(CR.defaultWidth({ type: 'rating', max: 100 }), CR.maxWidth({ type: 'rating' }), 'a huge max stops at the fit cap');
});

test('a dragged width wins over the fitted one, and a narrow rating knows it does not fit', () => {
  const f = { type: 'rating', max: 10, name: 'Love' };
  assert.equal(CR.layout([{ ...f, stored: 90 }]).Love, 90, 'the width a person chose');
  assert.equal(CR.layout([{ ...f }]).Love, CR.defaultWidth(f));
  assert.equal(CR.ratingFits(CR.defaultWidth(f), 10), true, 'the fitted width holds all ten icons');
  assert.equal(CR.ratingFits(90, 10), false, 'a dragged-narrow column draws the compact form');
  assert.equal(CR.ratingFits(CR.defaultWidth({ type: 'rating', max: 100 }), 100), false, 'past the cap too');
  assert.equal(CR.ratingFits(187, 12, 8), true, "Brightness in an ordinary cell");
  assert.equal(CR.ratingFits(187, 12, 24), false, "the same width in the row's last cell, which pads 16px more");
  assert.equal(CR.ratingFits(40, null), true, 'no max: nothing to fit');
});
